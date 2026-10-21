# MICRO-AI API

FastAPI prediction service for the bundled research models.

## Input integrity

Prediction endpoints require each model artifact to provide a unique, ordered `gene_names` list whose length agrees with `training_info.n_genes_original`, and explicit `training_info.training_imputation_applied: false`. The API exposes the verified list as `feature_ids`, plus `ready` and a safe `readiness_reason`. Readiness also checks fitted quantile/scaler state, feature-selection dimensions, class-encoder order, catalogued class meanings, and ensemble class order/weights. Prediction fails with HTTP 503 when the artifact is incomplete or incompatible. Never substitute fabricated identifiers or rely only on vector length.

JSON requests use `{"expression":[...],"feature_ids":[...]}`. The API aligns values by identifier; the frontend accepts feature/value entries rather than unlabeled vectors. CSV/TSV accepts sample rows with a feature-ID header and optional sample-ID column, or gene rows with identifiers in the first column and samples in later columns. Positional-only inputs, duplicate/unknown IDs, missing values, NaN, and infinity are rejected.

## Limits

Defaults are 10 MiB per uploaded file, 1,000 batch samples, 1,000,000 expression cells, and 100,000 JSON features. Set `MICROAI_MAX_UPLOAD_BYTES`, `MICROAI_MAX_BATCH_ROWS`, `MICROAI_MAX_BATCH_CELLS`, and `MICROAI_MAX_JSON_FEATURES` to positive integers to adjust these limits.

The service does not claim clinical validity. Verify model artifacts, ordered feature identifiers, training/inference preprocessing, and external evaluation before use.
