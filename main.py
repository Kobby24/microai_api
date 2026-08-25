import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List

from microai_model import MICROAI  # noqa: F401  (needed for unpickling)

app = FastAPI(title="MICRO-AI Prediction API")

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