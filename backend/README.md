# MICRO-AI API

FastAPI prediction service for the bundled research models.

## Input integrity

Prediction endpoints require each model artifact to provide a unique, ordered `gene_names` list whose length agrees with `training_info.n_genes_original`, and explicit `training_info.training_imputation_applied: false`. The API exposes the verified list as `feature_ids`, plus `ready` and a safe `readiness_reason`. Readiness also checks fitted quantile/scaler state, feature-selection dimensions, class-encoder order, catalogued class meanings, and ensemble class order/weights. Prediction fails with HTTP 503 when the artifact is incomplete or incompatible. Never substitute fabricated identifiers or rely only on vector length.

JSON requests use `{"expression":[...],"feature_ids":[...]}`. The API aligns values by identifier; the frontend accepts feature/value entries rather than unlabeled vectors. CSV/TSV accepts sample rows with a feature-ID header and optional sample-ID column, or gene rows with identifiers in the first column and samples in later columns. Positional-only inputs, duplicate/unknown IDs, missing values, NaN, and infinity are rejected.

## Limits

Defaults are 10 MiB per uploaded file, 1,000 batch samples, 1,000,000 expression cells, and 100,000 JSON features. Set `MICROAI_MAX_UPLOAD_BYTES`, `MICROAI_MAX_BATCH_ROWS`, `MICROAI_MAX_BATCH_CELLS`, and `MICROAI_MAX_JSON_FEATURES` to positive integers to adjust these limits.

## Local explanations

`POST /explain/{model_name}` accepts the prediction request fields (`expression`, `feature_ids`) and an optional `target_class`; omitting `target_class` explains the predicted class. The service reuses the permutation SHAP approach in `xai/xai.py`, using the selected standardized features as SHAP's explained space and `ensemble.predict_proba` as the output, including the fitted ensemble weights and isotonic calibration. It applies the full raw-input preprocessing path before feature selection. The response contains the prediction/class probabilities, explained class, base and predicted outputs, and per-feature raw values, model-space values, and SHAP contributions.

Response shape (placeholders only; not model output):

```text
{
	"model_name": "<model-name>",
	"prediction": "<class-key>",
	"prediction_label": "<catalogued-label>",
	"explained_class": "<class-key>",
	"explained_class_label": "<catalogued-label>",
	"class_probabilities": {"<class-key>": <float>},
	"output": "calibrated_class_probability",
	"base_value": <float>,
	"predicted_output": <float>,
	"features": [
		{"feature_id": "<verified-feature-id>", "raw_input_value": <float>, "model_input_value": <float>, "shap_value": <float>}
	],
	"metadata": {
		"method": "shap_permutation",
		"explained_feature_space": "selected_standardized_features",
		"background_samples": <integer>,
		"max_evals": <integer>,
		"additivity_residual": <float>,
		"additivity_tolerance": <float>,
		"additivity_verified": <boolean>,
		"preprocessing_scope_note": "..."
	}
}
```

Frontend integration requirements: display an Explain action only when model metadata reports `ready: true`; send the same identifier/value input used for prediction, and use the returned `explained_class` rather than inferring it from a probability threshold. Render only returned feature IDs and values, display the preprocessing-scope note and additivity status, and keep the research-only disclaimer. Do not offer batch explanations or global rankings in this phase.

Configure a verified, feature-ID-labelled background CSV using `MICROAI_XAI_GSE7390_BACKGROUND` or `MICROAI_XAI_GSE2034_BACKGROUND`. The former defaults to the path referenced in the supplied notebook export (`/content/GSE7390_demo_x_real.csv`); that file is not included in this repository. Limits: `MICROAI_XAI_BACKGROUND_SAMPLES` (50), `MICROAI_XAI_MAX_EVALS` (1,000), `MICROAI_XAI_MAX_BACKGROUND_BYTES` (64 MiB), `MICROAI_XAI_MAX_BACKGROUND_ROWS` (1,000), and `MICROAI_XAI_MAX_BACKGROUND_CELLS` (2,500,000). Global SHAP rankings and batch explanations are not exposed. Explanation readiness is blocked unless the artifact has verified full feature IDs and preprocessing metadata and the approved reference data exists.

The service does not claim clinical validity. Verify model artifacts, ordered feature identifiers, training/inference preprocessing, and external evaluation before use.
