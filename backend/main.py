import csv
import joblib
import logging
import numpy as np
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict
import __main__

from microai_model import (
    MICROAI,
    QuantileNormalizer,
    ComBatCorrection,
    KNNImputer,
    AttentionFeatureSelector,
    AdaptiveEnsembleClassifier
)
from tabular import (
    is_supported_table_filename,
    prepare_expression_matrix,
    read_expression_table,
    table_kind,
)
from xai_service import XAIService, XAIServiceError

app = FastAPI(title="MICRO-AI Prediction API")
logger = logging.getLogger(__name__)


def _positive_limit(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


MAX_UPLOAD_BYTES = _positive_limit("MICROAI_MAX_UPLOAD_BYTES", 10 * 1024 * 1024)
MAX_BATCH_ROWS = _positive_limit("MICROAI_MAX_BATCH_ROWS", 1000)
MAX_BATCH_CELLS = _positive_limit("MICROAI_MAX_BATCH_CELLS", 1_000_000)
MAX_JSON_FEATURES = _positive_limit("MICROAI_MAX_JSON_FEATURES", 100_000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "https://microai-api.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

setattr(__main__, "MICROAI", MICROAI)
setattr(__main__, "QuantileNormalizer", QuantileNormalizer)
setattr(__main__, "ComBatCorrection", ComBatCorrection)
setattr(__main__, "KNNImputer", KNNImputer)
setattr(__main__, "AttentionFeatureSelector", AttentionFeatureSelector)
setattr(__main__, "AdaptiveEnsembleClassifier", AdaptiveEnsembleClassifier)

MODELS = {
    "gse7390": joblib.load("./models/GSE7390_model.joblib"),
    "gse2034": joblib.load("./models/GSE2034_model.joblib") 
}
XAI_SERVICE = XAIService()

VERIFIED_TRAINING_IMPUTATION_APPLIED = {
    "gse7390": False,
    "gse2034": False,
}

MODEL_CATALOG = {
    "gse7390": {
        "display_name": "GSE7390",
        "predicts": "estrogen_receptor_status",
        "predicts_label": "Estrogen receptor (ER) status",
        "description": (
            "Classifies breast-cancer microarray samples by estrogen receptor status. "
            "Use this model when the clinical question is ER-positive versus ER-negative."
        ),
        "label_meanings": {
            "0": "ER-negative",
            "1": "ER-positive",
            "negative": "ER-negative",
            "positive": "ER-positive",
            "ER-": "ER-negative",
            "ER+": "ER-positive",
        },
    },
    "gse2034": {
        "display_name": "GSE2034",
        "predicts": "relapse",
        "predicts_label": "Disease relapse",
        "description": (
            "Predicts whether a patient is likely to relapse from gene expression. "
            "A predicted class of 1 means relapse is True; 0 means relapse is False."
        ),
        "label_meanings": {
            "0": "No relapse (False)",
            "1": "Relapse (True)",
            "False": "No relapse (False)",
            "True": "Relapse (True)",
            "No_Relapse": "No relapse (False)",
            "Relapse": "Relapse (True)",
        },
    },
}


def _expected_genes(model) -> Optional[int]:
    info = getattr(model, "training_info", None) or {}
    if not isinstance(info, dict):
        return None
    n = info.get("n_genes_original")
    if isinstance(n, bool) or not isinstance(n, (int, np.integer)) or n <= 0:
        return None
    return int(n)


def _feature_ids(model) -> Optional[List[str]]:
    raw_ids = getattr(model, "gene_names", None)
    if raw_ids is None:
        return None
    try:
        raw_values = list(raw_ids)
    except TypeError:
        return None
    if any(not isinstance(value, str) for value in raw_values):
        return None
    feature_ids = [value.strip() for value in raw_values]
    expected = _expected_genes(model)
    if (
        not feature_ids
        or any(not value for value in feature_ids)
        or len(set(feature_ids)) != len(feature_ids)
        or (expected is not None and len(feature_ids) != expected)
    ):
        return None
    selected = getattr(model, "selected_genes", None)
    if selected is not None:
        try:
            indices = np.asarray(selected, dtype=int)
        except (TypeError, ValueError):
            return None
        if indices.ndim != 1 or np.any(indices < 0) or np.any(indices >= len(feature_ids)):
            return None
    return feature_ids


def _attach_verified_model_metadata() -> None:
    schema_root = Path(__file__).resolve().parent / "xai" / "schemas"
    for name, model in MODELS.items():
        expected = _expected_genes(model)
        if expected is None:
            continue
        schema_path = schema_root / f"{name.upper()}_probe_ids.csv"
        if not schema_path.is_file():
            continue
        try:
            with schema_path.open(newline="", encoding="utf-8-sig") as stream:
                rows = list(csv.reader(stream))
            if not rows or rows[0] != ["probe_id"] or any(len(row) != 1 for row in rows[1:]):
                continue
            feature_ids = [row[0].strip() for row in rows[1:]]
        except OSError:
            continue
        if (
            len(feature_ids) != expected
            or any(not feature_id for feature_id in feature_ids)
            or len(set(feature_ids)) != len(feature_ids)
        ):
            continue
        stored_ids = getattr(model, "gene_names", None)
        if stored_ids is not None and list(stored_ids) != feature_ids:
            continue
        model.gene_names = feature_ids
        training_info = getattr(model, "training_info", None)
        if isinstance(training_info, dict) and "training_imputation_applied" not in training_info:
            attested_value = VERIFIED_TRAINING_IMPUTATION_APPLIED.get(name)
            if attested_value is not None:
                training_info["training_imputation_applied"] = attested_value


def _model_readiness_issue(name: str, model) -> Optional[str]:
    feature_ids = _feature_ids(model)
    if feature_ids is None:
        return "This model has no verified ordered gene/probe schema."
    if _expected_genes(model) is None:
        return "This model has no valid input-dimension metadata."

    info = getattr(model, "training_info", None) or {}
    imputation_applied = info.get("training_imputation_applied")
    if not isinstance(imputation_applied, (bool, np.bool_)) or bool(imputation_applied):
        return "This model's training missing-value behavior is unknown or incompatible with inference."
    try:
        raw_selected = np.asarray(getattr(model, "selected_genes", []))
        selected_numeric = raw_selected.astype(float)
        if not np.isfinite(selected_numeric).all() or not np.equal(selected_numeric, np.floor(selected_numeric)).all():
            return "This model has invalid feature-selection metadata."
        selected = selected_numeric.astype(int)
        selected_count = info.get("n_genes_final")
        if selected_count is not None:
            selected_count = int(selected_count)
    except (TypeError, ValueError, OverflowError):
        return "This model has invalid feature-selection metadata."
    if (
        selected.ndim != 1
        or selected.size == 0
        or len(set(selected.tolist())) != selected.size
        or (selected_count is not None and int(selected_count) != selected.size)
    ):
        return "This model has invalid feature-selection metadata."

    reference = getattr(getattr(model, "quantile_normalizer", None), "reference_distribution", None)
    try:
        reference_array = np.asarray(reference, dtype=float)
    except (TypeError, ValueError):
        reference_array = np.asarray([])
    if reference is None or reference_array.shape != (len(feature_ids),) or not np.isfinite(reference_array).all():
        return "This model has incomplete fitted preprocessing state."

    scaler = getattr(model, "scaler", None)
    scaler_mean = getattr(scaler, "mean_", None)
    scaler_scale = getattr(scaler, "scale_", None)
    try:
        scaler_mean_array = np.asarray(scaler_mean, dtype=float)
        scaler_scale_array = np.asarray(scaler_scale, dtype=float)
    except (TypeError, ValueError):
        scaler_mean_array = scaler_scale_array = np.asarray([])
    if (
        scaler_mean is None
        or scaler_scale is None
        or scaler_mean_array.shape != (selected.size,)
        or scaler_scale_array.shape != (selected.size,)
        or not np.isfinite(scaler_mean_array).all()
        or not np.isfinite(scaler_scale_array).all()
        or np.any(scaler_scale_array <= 0)
    ):
        return "This model has incomplete fitted preprocessing state."

    classes = list(getattr(model, "classes_", []))
    encoder_classes = getattr(getattr(model, "label_encoder", None), "classes_", None)
    if len(classes) < 2 or encoder_classes is None or [_normalize_class_label(v) for v in classes] != [
        _normalize_class_label(v) for v in encoder_classes
    ]:
        return "This model has inconsistent class-label metadata."
    label_meanings = MODEL_CATALOG.get(name, {}).get("label_meanings", {})
    if any(class_key not in label_meanings for class_key in map(_normalize_class_label, classes)):
        return "This model's class labels are not mapped to the catalogued target."

    ensemble = getattr(model, "ensemble", None)
    try:
        weights = np.asarray(getattr(ensemble, "weights", []), dtype=float)
    except (TypeError, ValueError):
        weights = np.asarray([])
    if (
        weights.shape != (3,)
        or not np.isfinite(weights).all()
        or np.any(weights < 0)
        or not np.isclose(weights.sum(), 1.0, atol=1e-6)
    ):
        return "This model has invalid ensemble weights."
    for component_name in ("gbm", "rf", "svm"):
        component_classes = getattr(getattr(ensemble, component_name, None), "classes_", None)
        if component_classes is None or not np.array_equal(component_classes, np.arange(len(classes))):
            return "This model has inconsistent ensemble class ordering."

    if getattr(model, "combat_corrector", None) is not None:
        return "This model requires batch labels that the current prediction API does not accept."
    return None


def _require_model_ready(name: str, model) -> None:
    issue = _model_readiness_issue(name, model)
    if issue is not None:
        raise HTTPException(status_code=503, detail=issue)


_attach_verified_model_metadata()


def _ordered_expression(model, expression, supplied_feature_ids) -> np.ndarray:
    expected_ids = _feature_ids(model)
    if expected_ids is None:
        raise HTTPException(
            status_code=503,
            detail="Predictions are unavailable because this model has no verified gene/probe schema.",
        )
    if supplied_feature_ids is None:
        raise HTTPException(status_code=400, detail="Gene/probe identifiers are required with expression values.")
    identifiers = [str(value).strip() for value in supplied_feature_ids]
    if (
        len(identifiers) != len(expected_ids)
        or any(not value for value in identifiers)
        or len(set(identifiers)) != len(identifiers)
        or set(identifiers) != set(expected_ids)
    ):
        raise HTTPException(
            status_code=400,
            detail="Feature identifiers do not match this model's required gene/probe set.",
        )
    if len(expression) != len(identifiers):
        raise HTTPException(
            status_code=400,
            detail=f"Expected {len(identifiers)} expression values, got {len(expression)}.",
        )
    by_id = dict(zip(identifiers, expression))
    values = np.asarray([by_id[identifier] for identifier in expected_ids], dtype=float)
    if not np.isfinite(values).all():
        raise HTTPException(
            status_code=400,
            detail="Expression values must be numeric and finite; missing, NaN, and infinite values are not supported.",
        )
    return values.reshape(1, -1)


def _checked_predictions(model, X):
    classes = list(getattr(model, "classes_", []))
    class_keys = [_normalize_class_label(value) for value in classes]
    if not classes or len(set(class_keys)) != len(class_keys):
        raise ValueError("Model class metadata is invalid.")

    predictions = np.asarray(model.predict(X))
    if predictions.shape != (X.shape[0],):
        raise ValueError("Model prediction dimensions do not match the input batch.")
    probabilities = np.asarray(model.predict_proba(X), dtype=float)
    if probabilities.shape != (X.shape[0], len(classes)):
        raise ValueError("Model probability dimensions do not match class metadata.")
    if (
        not np.isfinite(probabilities).all()
        or np.any(probabilities < 0)
        or np.any(probabilities > 1)
        or not np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-6)
    ):
        raise ValueError("Model returned invalid class probabilities.")
    for prediction, row in zip(predictions, probabilities):
        if _normalize_class_label(prediction) != class_keys[int(np.argmax(row))]:
            raise ValueError("Model prediction does not match its class probabilities.")
    return predictions, probabilities, class_keys


def _normalize_class_label(cls) -> str:
    if isinstance(cls, (bool, np.bool_)):
        return "True" if bool(cls) else "False"
    if isinstance(cls, (int, np.integer)):
        return str(int(cls))
    if isinstance(cls, (float, np.floating)) and float(cls).is_integer():
        return str(int(cls))
    return str(cls)


def _model_classes(model) -> List[str]:
    classes = getattr(model, "classes_", None)
    if classes is None:
        return []
    return [_normalize_class_label(cls) for cls in classes]


def _label_meanings(name: str, classes: List[str]) -> Dict[str, str]:
    catalog = MODEL_CATALOG.get(name, {})
    meanings = catalog.get("label_meanings", {})
    predicts = catalog.get("predicts", "")
    keys = classes or [k for k in ("0", "1") if k in meanings]
    resolved: Dict[str, str] = {}
    for cls in keys:
        if cls in meanings:
            resolved[cls] = meanings[cls]
        elif predicts == "relapse" and cls in {"1", "True"}:
            resolved[cls] = "Relapse (True)"
        elif predicts == "relapse" and cls in {"0", "False"}:
            resolved[cls] = "No relapse (False)"
        elif predicts == "estrogen_receptor_status" and cls in {"1", "positive"}:
            resolved[cls] = "ER-positive"
        elif predicts == "estrogen_receptor_status" and cls in {"0", "negative"}:
            resolved[cls] = "ER-negative"
        else:
            resolved[cls] = cls
    return resolved


def _model_info(name: str) -> dict:
    model = MODELS[name]
    catalog = MODEL_CATALOG.get(name, {})
    classes = _model_classes(model)
    readiness_issue = _model_readiness_issue(name, model)
    return {
        "name": name,
        "display_name": catalog.get("display_name", name.upper()),
        "predicts": catalog.get("predicts", "unknown"),
        "predicts_label": catalog.get("predicts_label", catalog.get("predicts", "Unknown target")),
        "description": catalog.get("description", ""),
        "expected_genes": _expected_genes(model),
        "feature_ids": _feature_ids(model),
        "ready": readiness_issue is None,
        "readiness_reason": readiness_issue,
        "classes": classes,
        "label_meanings": _label_meanings(name, classes),
    }


class ModelInfo(BaseModel):
    name: str
    display_name: str
    predicts: str
    predicts_label: str
    description: str
    expected_genes: Optional[int] = None
    feature_ids: Optional[List[str]] = None
    ready: bool = False
    readiness_reason: Optional[str] = None
    classes: List[str] = Field(default_factory=list)
    label_meanings: Dict[str, str] = Field(default_factory=dict)


class ModelsResponse(BaseModel):
    models: List[ModelInfo]


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_request, _exc):
    return JSONResponse(status_code=422, content={"detail": "Invalid request data."})


@app.exception_handler(Exception)
async def unexpected_error_handler(_request, exc):
    logger.exception("Unhandled API error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})


@app.get("/health")
def health():
    return {"status": "ok", "loaded_models": list(MODELS.keys())}


@app.get("/models", response_model=ModelsResponse)
def list_models():
    return {"models": [_model_info(name) for name in MODELS]}


@app.get("/models/{model_name}", response_model=ModelInfo)
def get_model(model_name: str):
    model_name = model_name.lower()
    if model_name not in MODELS:
        raise HTTPException(status_code=404, detail="Model not found")
    return _model_info(model_name)


# --- EXISTING JSON ENDPOINT ---
class PredictionRequest(BaseModel):
    expression: List[float] = Field(..., min_length=1, max_length=MAX_JSON_FEATURES)
    feature_ids: List[str] = Field(..., min_length=1, max_length=MAX_JSON_FEATURES)

    @field_validator("expression", mode="before")
    @classmethod
    def validate_expression(cls, values):
        if not isinstance(values, list):
            raise ValueError("Expression values must be finite JSON numbers.")
        for value in values:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("Expression values must be finite JSON numbers.")
            try:
                finite = np.isfinite(float(value))
            except (OverflowError, TypeError, ValueError):
                finite = False
            if not finite:
                raise ValueError("Expression values must be finite JSON numbers.")
        return values

    @field_validator("feature_ids", mode="before")
    @classmethod
    def validate_feature_ids(cls, values):
        if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
            raise ValueError("Feature identifiers must be non-empty strings.")
        return [value.strip() for value in values]

class PredictionResponse(BaseModel):
    prediction: str
    probability: float
    class_probabilities: Dict[str, float]


class ExplanationRequest(PredictionRequest):
    target_class: Optional[str] = Field(default=None, min_length=1)


class ExplanationFeature(BaseModel):
    feature_id: str
    raw_input_value: float
    model_input_value: float
    shap_value: float


class ExplanationMetadata(BaseModel):
    method: str
    explained_feature_space: str
    background_samples: int
    max_evals: int
    additivity_residual: float
    additivity_tolerance: float
    additivity_verified: bool
    preprocessing_scope_note: str


class ExplanationResponse(BaseModel):
    model_name: str
    prediction: str
    prediction_label: str
    explained_class: str
    explained_class_label: str
    class_probabilities: Dict[str, float]
    output: str
    base_value: float
    predicted_output: float
    features: List[ExplanationFeature]
    metadata: ExplanationMetadata

@app.post("/predict/{model_name}", response_model=PredictionResponse)
def predict_json(model_name: str, request: PredictionRequest):
    model_name = model_name.lower()
    if model_name not in MODELS:
        raise HTTPException(status_code=404, detail="Model not found")
    
    model = MODELS[model_name]
    _require_model_ready(model_name, model)
    X = _ordered_expression(model, request.expression, request.feature_ids)
    try:
        predictions, probabilities, class_keys = _checked_predictions(model, X)
    except Exception as exc:
        logger.exception("Model prediction failed for %s", model_name)
        raise HTTPException(status_code=500, detail="Prediction failed.") from exc
    proba = probabilities[0]
    return PredictionResponse(
        prediction=_normalize_class_label(predictions[0]),
        probability=float(np.max(proba)),
        class_probabilities={key: float(value) for key, value in zip(class_keys, proba)},
    )


@app.post("/explain/{model_name}", response_model=ExplanationResponse)
def explain_json(model_name: str, request: ExplanationRequest):
    model_name = model_name.lower()
    if model_name not in MODELS:
        raise HTTPException(status_code=404, detail="Model not found")

    model = MODELS[model_name]
    _require_model_ready(model_name, model)
    X = _ordered_expression(model, request.expression, request.feature_ids)
    try:
        predictions, probabilities, class_keys = _checked_predictions(model, X)
    except Exception as exc:
        logger.exception("Model prediction failed for explanation request %s", model_name)
        raise HTTPException(status_code=500, detail="Prediction failed.") from exc

    predicted_class = _normalize_class_label(predictions[0])
    explained_class = request.target_class or predicted_class
    if explained_class not in class_keys:
        raise HTTPException(status_code=400, detail="The requested explanation class is not supported by this model.")
    target_index = class_keys.index(explained_class)
    try:
        result = XAI_SERVICE.explain_local(
            model_name=model_name,
            model=model,
            expression=X,
            feature_ids=_feature_ids(model),
            target_index=target_index,
            expected_probability=float(probabilities[0, target_index]),
        )
    except XAIServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception as exc:
        logger.exception("Explanation failed for %s", model_name)
        raise HTTPException(status_code=500, detail="Explanation failed.") from exc

    return ExplanationResponse(
        model_name=model_name,
        prediction=predicted_class,
        prediction_label=_label_meanings(model_name, [predicted_class]).get(predicted_class, predicted_class),
        explained_class=explained_class,
        explained_class_label=_label_meanings(model_name, [explained_class]).get(explained_class, explained_class),
        class_probabilities={key: float(value) for key, value in zip(class_keys, probabilities[0])},
        **result,
    )


# --- CSV / TSV BATCH ENDPOINT ---
@app.post("/predict_csv/{model_name}")
async def predict_csv(model_name: str, file: UploadFile = File(...)):
    model_name = model_name.lower()
    if model_name not in MODELS:
        raise HTTPException(status_code=404, detail="Model not found")

    # 1. Validate file type (.csv and .tsv; MIME is not required — browsers vary)
    filename = file.filename or ""
    if not is_supported_table_filename(filename):
        raise HTTPException(status_code=400, detail="Only .csv and .tsv files are supported")

    model = MODELS[model_name]
    kind = table_kind(filename)
    _require_model_ready(model_name, model)

    try:
        contents = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="The uploaded file exceeds the configured size limit.")
        df = read_expression_table(contents, filename)
        expected_feature_ids = _feature_ids(model)
        if expected_feature_ids is None:
            raise HTTPException(
                status_code=503,
                detail="Predictions are unavailable because this model has no verified gene/probe schema.",
            )
        X, sample_ids = prepare_expression_matrix(
            df,
            _expected_genes(model),
            model_name,
            expected_feature_ids=expected_feature_ids,
        )
        if X.shape[0] > MAX_BATCH_ROWS or X.size > MAX_BATCH_CELLS:
            raise HTTPException(status_code=413, detail="The batch exceeds the configured processing limit.")
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unable to parse uploaded %s", kind)
        raise HTTPException(status_code=400, detail=f"Unable to read the uploaded {kind} file.") from exc

    try:
        preds, probas, class_keys = _checked_predictions(model, X)
    except Exception as exc:
        logger.exception("Batch prediction failed for %s", model_name)
        raise HTTPException(status_code=500, detail="Prediction failed.") from exc

    # 5. Format the results
    results = []
    for i in range(len(preds)):
        row_probs = {key: float(p) for key, p in zip(class_keys, probas[i])}
        row = {
            "sample_index": i,
            "prediction": _normalize_class_label(preds[i]),
            "probability": float(max(probas[i])),
            "class_probabilities": row_probs
        }
        if sample_ids:
            row["sample_id"] = sample_ids[i]
        results.append(row)

    return {"filename": file.filename, "samples_processed": len(results), "results": results}