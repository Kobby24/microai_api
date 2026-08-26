import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List
import __main__

# 1. Import ALL custom classes from your model file
from microai_model import (
    MICROAI,
    QuantileNormalizer,
    ComBatCorrection,
    KNNImputer,
    AttentionFeatureSelector,
    AdaptiveEnsembleClassifier
)

app = FastAPI(title="MICRO-AI Prediction API")

# 2. Map ALL of them to the __main__ namespace so joblib can unpickle the full pipeline
setattr(__main__, "MICROAI", MICROAI)
setattr(__main__, "QuantileNormalizer", QuantileNormalizer)
setattr(__main__, "ComBatCorrection", ComBatCorrection)
setattr(__main__, "KNNImputer", KNNImputer)
setattr(__main__, "AttentionFeatureSelector", AttentionFeatureSelector)
setattr(__main__, "AdaptiveEnsembleClassifier", AdaptiveEnsembleClassifier)

# 3. Now it is safe to load the model
MODEL_PATH = "/workspaces/microai_api/models/GSE7390_model.joblib"
model = joblib.load(MODEL_PATH)


class PredictionRequest(BaseModel):
    expression: List[float] = Field(
        ..., description="Gene expression values, same order/length as training data"
    )


class PredictionResponse(BaseModel):
    prediction: str
    probability: float
    class_probabilities: dict


@app.post("/predict", response_model=PredictionResponse)
def predict(request: PredictionRequest):
    X = np.array(request.expression, dtype=float).reshape(1, -1)

    expected_n_genes = model.training_info.get("n_genes_original")
    if expected_n_genes and X.shape[1] != expected_n_genes:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {expected_n_genes} gene values, got {X.shape[1]}",
        )

    try:
        pred = model.predict(X)[0]
        proba = model.predict_proba(X)[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    class_probs = {str(cls): float(p) for cls, p in zip(model.classes_, proba)}

    return PredictionResponse(
        prediction=str(pred),
        probability=float(max(proba)),
        class_probabilities=class_probs,
    )


@app.get("/health")
def health():
    return {"status": "ok"}