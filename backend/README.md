# MICRO-AI API

FastAPI prediction service for the bundled research models.

## Input integrity

Prediction endpoints require each model artifact to provide a unique, ordered `gene_names` list whose length agrees with `training_info.n_genes_original`, and explicit `training_info.training_imputation_applied: false`. The API exposes the verified list as `feature_ids`, plus `ready` and a safe `readiness_reason`. Readiness also checks fitted quantile/scaler state, feature-selection dimensions, class-encoder order, catalogued class meanings, and ensemble class order/weights. Prediction fails with HTTP 503 when the artifact is incomplete or incompatible. Never substitute fabricated identifiers or rely only on vector length.

JSON requests use `{"expression":[...],"feature_ids":[...],"sample_id":"<optional-id>"}`. The optional sample ID is trimmed, limited to 128 characters, and returned with the prediction and explanation when supplied. The API aligns values by identifier; the frontend accepts feature/value entries rather than unlabeled vectors. CSV/TSV accepts sample rows with a feature-ID header and optional sample-ID column, or gene rows with identifiers in the first column and samples in later columns. Positional-only inputs, duplicate/unknown IDs, missing values, NaN, and infinity are rejected.

## Limits

Defaults are 10 MiB per uploaded file, 1,000 batch samples, 1,000,000 expression cells, and 100,000 JSON features. Set `MICROAI_MAX_UPLOAD_BYTES`, `MICROAI_MAX_BATCH_ROWS`, `MICROAI_MAX_BATCH_CELLS`, and `MICROAI_MAX_JSON_FEATURES` to positive integers to adjust these limits.

## Local explanations

`POST /explain/{model_name}` accepts the prediction request fields (`expression`, `feature_ids`, optional `sample_id`) and an optional `target_class`; omitting `target_class` explains the predicted class. The service reuses the permutation SHAP approach in `xai/xai.py`, using the selected standardized features as SHAP's explained space and `ensemble.predict_proba` as the output, including the fitted ensemble weights and isotonic calibration. It applies the full raw-input preprocessing path before feature selection. Existing response fields remain; additive fields include a generated plain-language `summary` and up to eight absolute-SHAP-sorted `drivers`, with standardized-expression bands, SHAP direction, optional unambiguous GPL96 symbols, and relative influence among those displayed drivers. Per-feature `features` continue to include all existing raw/model-space values and SHAP contributions.

Response shape (placeholders only; not model output):

```text
{
	"model_name": "<model-name>",
	"sample_id": "<optional-id>",
	"prediction": "<class-key>",
	"prediction_label": "<catalogued-label>",
	"explained_class": "<class-key>",
	"explained_class_label": "<catalogued-label>",
	"class_probabilities": {"<class-key>": <float>},
	"output": "calibrated_class_probability",
	"base_value": <float>,
	"predicted_output": <float>,
	"summary": "<sample-specific explanation generated from SHAP results>",
	"drivers": [
		{
			"feature_id": "<verified-feature-id>",
			"gene_symbol": "<unambiguous GPL96 symbol, when available>",
			"expression_level": "<standardized-expression band>",
			"direction": "<direction relative to the explained class>",
			"shap_value": <float>,
			"relative_influence_percent": <float>
		}
	],
	"features": [
		{"feature_id": "<verified-feature-id>", "gene_symbol": "<optional>", "raw_input_value": <float>, "model_input_value": <float>, "expression_level": "<band>", "direction": "<direction>", "shap_value": <float>, "relative_influence_percent": <float-or-omitted>}
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

The GPL96 annotation file is used by exact probe ID. Only a single, non-empty symbol is emitted; ambiguous or missing mappings remain probe IDs. `base_value` is the SHAP reference-background baseline for the explained class, not a general population prevalence or clinical baseline.

`GET /models/{model_name}/global-drivers` returns up to eight global features from the model's existing weighted GBM/random-forest feature-importance method when those values are finite and match the selected-feature schema; otherwise it returns HTTP 503. It is a separate model-level metric, not SHAP and not computed from a sample explanation. The bundled model artifacts currently return non-finite values from this method, so no global drivers are available from those artifacts.

Frontend integration requirements: display an Explain action only when model metadata reports `ready: true`; send the same identifier/value input used for prediction, and use the returned `explained_class` rather than inferring it from a probability threshold. Render only returned feature IDs and values, display the preprocessing-scope note and additivity status, and keep the research-only disclaimer. Batch explanations remain unavailable.

Configure a verified, feature-ID-labelled background CSV using `MICROAI_XAI_GSE7390_BACKGROUND` or `MICROAI_XAI_GSE2034_BACKGROUND`; by default, the bundled `xai/backgrounds/GSE7390_background.csv` and `GSE2034_background.csv` are used. Limits: `MICROAI_XAI_BACKGROUND_SAMPLES` (50), `MICROAI_XAI_MAX_EVALS` (1,000), `MICROAI_XAI_MAX_BACKGROUND_BYTES` (64 MiB), `MICROAI_XAI_MAX_BACKGROUND_ROWS` (1,000), and `MICROAI_XAI_MAX_BACKGROUND_CELLS` (2,500,000). Global SHAP rankings and batch explanations are not exposed. Explanation readiness is blocked unless the artifact has verified full feature IDs and preprocessing metadata and the approved reference data exists.

The service does not claim clinical validity. Verify model artifacts, ordered feature identifiers, training/inference preprocessing, and external evaluation before use.
