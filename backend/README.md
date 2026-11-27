# MICRO-AI API

FastAPI prediction service for the bundled research models.

## Input integrity

Prediction endpoints require each model artifact to provide a unique, ordered `gene_names` list whose length agrees with `training_info.n_genes_original`, and explicit `training_info.training_imputation_applied: false`. The API exposes the verified list as `feature_ids`, plus `ready` and a safe `readiness_reason`. Readiness also checks fitted quantile/scaler state, feature-selection dimensions, class-encoder order, catalogued class meanings, and ensemble class order/weights. Prediction fails with HTTP 503 when the artifact is incomplete or incompatible. Never substitute fabricated identifiers or rely only on vector length.

JSON requests use `{"expression":[...],"feature_ids":[...],"sample_id":"<optional-id>"}`. The optional sample ID is trimmed, limited to 128 characters, and returned with the prediction and explanation when supplied. The API aligns values by identifier; the frontend accepts feature/value entries rather than unlabeled vectors. CSV/TSV accepts sample rows with a feature-ID header and optional sample-ID column, or gene rows with identifiers in the first column and samples in later columns. Positional-only inputs, duplicate/unknown IDs, missing values, NaN, and infinity are rejected.

## Limits

Defaults are 50 MiB per uploaded file, 1,000 batch samples, 1,000,000 expression cells, and 100,000 JSON features. Set `MICROAI_MAX_UPLOAD_BYTES`, `MICROAI_MAX_BATCH_ROWS`, `MICROAI_MAX_BATCH_CELLS`, and `MICROAI_MAX_JSON_FEATURES` to positive integers to adjust these limits.

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

Performance settings: `MICROAI_XAI_WARMUP` (`startup` by default) prepares every model's SHAP explainers before the server accepts traffic, so the first explanation takes ~1 s instead of ~8 s (boot is ~10 s longer); `background` warms in a thread after boot instead (requests arriving meanwhile are slowed by GIL contention), and `0` warms lazily on the first explanation. `MICROAI_XAI_EXPLAINER_CACHE_SIZE` (8) bounds cached model-level explainers (one per model and explained class). Only model-level objects are cached; each patient's explanation is always computed from that request's expression vector.

The service does not claim clinical validity. Verify model artifacts, ordered feature identifiers, training/inference preprocessing, and external evaluation before use.

## Deployment (Docker / Render) and CEL preprocessing

Single-patient `.CEL`/`.CEL.gz` uploads are preprocessed by `affy_mas5.R` (affy `ReadAffy` → `mas5(normalize = TRUE, sc = 600)` → `log2(exprs())`), which needs R plus the Bioconductor `affy` and `hgu133acdf` (GPL96 CDF) packages. The backend deploys as two Docker web services defined in `backend/render.yaml`:

| Service | Dockerfile | Instance | Notes |
|---|---|---|---|
| `microai-backend` (API) | `backend/Dockerfile` (no R) | `1c-2g` (Render Standard: 1 CPU / 2 GB) | Measured: ~340 MiB after the SHAP warm-up, 650 MiB+ while parsing a large CSV/TSV batch; 512 MB instances were OOM-killed. CSV/TSV batches are parsed one at a time. |
| `microai-cel-preprocessor` | `backend/Dockerfile.cel` (R, affy, `install_r_packages.R`; any failure aborts the build) | `0.5c-512mb` (Render Starter: 0.5 CPU / 512 MB) | One uvicorn process, one MAS5 job at a time. Do not add `--workers`. |

The Blueprint file is not at the repository root: set **Blueprint Path** to `backend/render.yaml` when creating or syncing the Blueprint. It omits `rootDir` and gives repository-root paths (`./backend/Dockerfile`, context `./backend`), plus `buildFilter` paths so only backend changes trigger deploys. If the services already exist in the dashboard, check the Blueprint sync preview before applying: Render overwrites dashboard settings (instance type, root directory, Dockerfile path) with the Blueprint's values.

Environment variables to configure in Render:

| Service | Variable | How to set it |
|---|---|---|
| API | `MICROAI_CEL_SERVICE_URL` | **Required, manual.** The CEL service's base URL with no path (open the `microai-cel-preprocessor` service in the dashboard; its `https://….onrender.com` URL is shown under the service name). `sync: false` values are only prompted when a Blueprint is first created, so on an existing service set it under **Environment**. Without it, CEL uploads fail (the API image has no R). |
| API | `MICROAI_CEL_SERVICE_TOKEN` | Linked by the Blueprint to the CEL service's generated value. If the services were created by hand, copy the CEL service's value (its **Environment** tab) into the API service; the two must match. Never commit it. |
| Both | `MICROAI_RSCRIPT_TIMEOUT_SECONDS` | Set to `300` by the Blueprint. |
| API | `MICROAI_XAI_WARMUP` | Leave unset (defaults to `startup`). |
| Frontend (Vercel or other host) | `VITE_API_BASE_URL` | **Required at build time.** The API service's `https://….onrender.com` URL from its dashboard page. Vite embeds it when the frontend is built, so redeploy the frontend after changing it. |

- `RSCRIPT_PATH` (optional): explicit Rscript path; otherwise `Rscript` is resolved from `PATH`.
- `MICROAI_RSCRIPT_TIMEOUT_SECONDS` (default 300): per-file R time limit.
- `MICROAI_CEL_QUEUE_WAIT_SECONDS` (default 45) and `MICROAI_CEL_MAX_QUEUED` (default 4), CEL preprocessing service: MAS5 runs one job at a time (memory); a request that finds it busy waits up to this long for the slot, with at most this many waiting, before returning HTTP 503.
- Live CEL processing status: the frontend uploads to `POST /predict_cel_jobs/{model}` (returns a job id), follows `GET /predict_cel_jobs/{id}/events` (server-sent events of the real processing stages, resumable with `Last-Event-ID`), then fetches `GET /predict_cel_jobs/{id}/result` (same body as `/predict_cel`); `DELETE /predict_cel_jobs/{id}` cancels and stops R. The API relays the CEL service's `POST /preprocess/stream` events; `/predict_cel` and `/preprocess` are unchanged. Settings (API): `MICROAI_MAX_CEL_JOBS` (default 8 running jobs), `MICROAI_CEL_JOB_ORPHAN_SECONDS` (default 60: a running job with no listener is cancelled), `MICROAI_CEL_JOB_RETENTION_SECONDS` (default 300: finished jobs and results are kept this long for reconnects). Jobs live in the API process, so keep one uvicorn worker per instance.
- `MICROAI_REQUIRE_R` (set to `1` in the image): startup fails if Rscript, the R packages, or the MAS5 script are missing. Startup logs print the R version and package versions; `/health` reports `cel_preprocessing_available`.

Local check: `docker build -t microai-backend backend` then `docker run --rm -v /path/to/cel:/data -e MICROAI_TEST_CEL=/data/<GPL96 sample>.CEL.gz microai-backend python -m pytest`.
