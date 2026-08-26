import joblib
import numpy as np
import pandas as pd
import io
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List
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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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

@app.get("/health")
def health():
    return {"status": "ok", "loaded_models": list(MODELS.keys())}


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