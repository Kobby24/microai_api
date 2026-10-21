# MICRO-AI Predictor (frontend)

Single-page React client for the MICRO-AI FastAPI prediction service.

## Run

The app calls `https://microai-api.onrender.com` by default. Set `VITE_API_BASE_URL` before building or starting Vite to use another API origin, for example `VITE_API_BASE_URL=http://127.0.0.1:8000`.

Predictions require the selected model to publish a verified ordered `feature_ids` schema. Single-sample JSON must be an array containing one `{"feature_id":"...","value":1.23}` object per required ID; entries may be reordered but IDs must be unique and complete. CSV/TSV files must provide matching feature IDs in a header or gene-ID column. Values must be finite. Models without a complete verified schema and fitted pipeline are intentionally unavailable for prediction.

```bash
npm install
npm run dev
```

The app is served at `http://localhost:5173`.
