import joblib
import numpy as np
import pandas as pd
import io
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
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

app = FastAPI(title="MICRO-AI Prediction API")

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
    n = info.get("n_genes_original")
    return int(n) if n is not None else None


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
    return {
        "name": name,
        "display_name": catalog.get("display_name", name.upper()),
        "predicts": catalog.get("predicts", "unknown"),
        "predicts_label": catalog.get("predicts_label", catalog.get("predicts", "Unknown target")),
        "description": catalog.get("description", ""),
        "expected_genes": _expected_genes(model),
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
    classes: List[str] = Field(default_factory=list)
    label_meanings: Dict[str, str] = Field(default_factory=dict)


class ModelsResponse(BaseModel):
    models: List[ModelInfo]


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
    expression: List[float] = Field(...)

class PredictionResponse(BaseModel):
    prediction: str
    probability: float
    class_probabilities: dict

@app.post("/predict/{model_name}", response_model=PredictionResponse)
def predict_json(model_name: str, request: PredictionRequest):
    model_name = model_name.lower()
    if model_name not in MODELS:
        raise HTTPException(status_code=404, detail="Model not found")
    
    model = MODELS[model_name]
    X = np.array(request.expression, dtype=float).reshape(1, -1)

    expected_genes = model.training_info.get("n_genes_original")
    if expected_genes and X.shape[1] != expected_genes:
        raise HTTPException(status_code=400, detail=f"Expected {expected_genes} genes, got {X.shape[1]}")

    pred = model.predict(X)[0]
    proba = model.predict_proba(X)[0]
    class_probs = {str(cls): float(p) for cls, p in zip(model.classes_, proba)}

    return PredictionResponse(prediction=str(pred), probability=float(max(proba)), class_probabilities=class_probs)


# --- NEW CSV BATCH ENDPOINT ---
@app.post("/predict_csv/{model_name}")
async def predict_csv(model_name: str, file: UploadFile = File(...)):
    model_name = model_name.lower()
    if model_name not in MODELS:
        raise HTTPException(status_code=404, detail="Model not found")
    
    # 1. Validate file type
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    model = MODELS[model_name]
    
    try:
        # 2. Read the uploaded file directly into memory using Pandas
        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents),header=None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading CSV: {str(e)}")

    # 3. Validate dimensions
    df = df.T
    X = df.values
    expected_genes = model.training_info.get("n_genes_original")
    if expected_genes and X.shape[1] != expected_genes:
        raise HTTPException(
            status_code=400, 
            detail=f"Expected {expected_genes} columns (genes) for {model_name}, got {X.shape[1]}"
        )

    # 4. Generate predictions for all rows (patients) in the CSV
    try:
        preds = model.predict(X)
        probas = model.predict_proba(X)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

    # 5. Format the results
    results = []
    for i in range(len(preds)):
        row_probs = {str(cls): float(p) for cls, p in zip(model.classes_, probas[i])}
        results.append({
            "sample_index": i,
            "prediction": str(preds[i]),
            "probability": float(max(probas[i])),
            "class_probabilities": row_probs
        })

    return {"filename": file.filename, "samples_processed": len(results), "results": results}