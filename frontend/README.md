# MICRO-AI Predictor (frontend)

Single-page React client for the MICRO-AI FastAPI prediction service.

## Run

The app calls `https://microai-api.onrender.com` by default. Set `VITE_API_BASE_URL` before building or starting Vite to use another API origin, for example `VITE_API_BASE_URL=http://127.0.0.1:8000`.

Predictions require the selected model to publish a verified ordered `feature_ids` schema. Single-sample JSON must be an array containing one `{"feature_id":"...","value":1.23}` object per required ID; entries may be reordered but IDs must be unique and complete. CSV/TSV files must provide matching feature IDs in a header or gene-ID column. Values must be finite. Models without a complete verified schema and fitted pipeline are intentionally unavailable for prediction.

After a successful single-sample prediction, choose **Explain prediction** to request a local permutation-SHAP explanation. The panel shows the calibrated target-class probability, base value, additivity residual, and the strongest positive and negative contributions, with an expandable list of all selected features. Explanations are limited to the model's selected standardized feature space; they do not claim full attribution across all original probes. Batch results are not explained.

On the verified backend environment, first explanations took about 9–10 seconds and cached explanations about 1.4–2.1 seconds for 250 selected features and 50 reference samples. The measured process RSS high-water increase was about 316–318 MiB on first use; actual deployment costs vary by runtime and concurrent requests. Explanations are computed only when requested, and backend limits should remain in place.

```bash
npm install
npm run dev
```

The app is served at `http://localhost:5173`.
