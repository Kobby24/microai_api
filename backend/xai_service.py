import contextlib
import io
import os
from pathlib import Path
from threading import RLock

import numpy as np
import pandas as pd


class XAIServiceError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _positive_setting(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


class XAIService:
    def __init__(self, background_paths=None, shap_module=None):
        self.background_paths = dict(background_paths or {})
        self.shap_module = shap_module
        self.background_samples = _positive_setting("MICROAI_XAI_BACKGROUND_SAMPLES", 50)
        self.max_evals = _positive_setting("MICROAI_XAI_MAX_EVALS", 1000)
        self.max_background_bytes = _positive_setting("MICROAI_XAI_MAX_BACKGROUND_BYTES", 64 * 1024 * 1024)
        self.max_background_rows = _positive_setting("MICROAI_XAI_MAX_BACKGROUND_ROWS", 1000)
        self.max_background_cells = _positive_setting("MICROAI_XAI_MAX_BACKGROUND_CELLS", 1_500_000)
        self.additivity_tolerance = 0.01
        self._cache = {}
        self._cache_lock = RLock()

    def _background_path(self, model_name):
        configured = self.background_paths.get(model_name)
        if configured is None:
            env_name = f"MICROAI_XAI_{model_name.upper()}_BACKGROUND"
            configured = os.getenv(env_name)
        if configured is None and model_name == "gse7390":
            configured = "/content/GSE7390_demo_x_real.csv"
        if not configured:
            raise XAIServiceError(503, "No approved SHAP background dataset is configured for this model.")
        path = Path(configured)
        if not path.is_file():
            raise XAIServiceError(503, "The configured SHAP background dataset is unavailable.")
        try:
            stat = path.stat()
        except OSError as exc:
            raise XAIServiceError(503, "The configured SHAP background dataset is unavailable.") from exc
        if stat.st_size > self.max_background_bytes:
            raise XAIServiceError(413, "The configured SHAP background dataset exceeds the size limit.")
        return path, stat

    def _load_background(self, path, expected_feature_ids):
        try:
            frame = pd.read_csv(path, index_col=0)
            source_ids = [str(value).strip() for value in frame.columns]
            if (
                len(source_ids) != len(expected_feature_ids)
                or any(not value for value in source_ids)
                or len(set(source_ids)) != len(source_ids)
                or set(source_ids) != set(expected_feature_ids)
            ):
                raise ValueError("feature identifiers do not match")
            if len(frame) < 2:
                raise ValueError("background dataset must contain at least two samples")
            if len(frame) > self.max_background_rows:
                raise XAIServiceError(413, "The configured SHAP background dataset exceeds the row limit.")
            if len(frame) * len(expected_feature_ids) > self.max_background_cells:
                raise XAIServiceError(413, "The configured SHAP background dataset exceeds the cell limit.")
            background = frame.loc[:, expected_feature_ids].to_numpy(dtype=float)
        except XAIServiceError:
            raise
        except Exception as exc:
            raise XAIServiceError(
                503,
                "The configured SHAP background dataset is invalid or does not match the model feature schema.",
            ) from exc
        if not np.isfinite(background).all():
            raise XAIServiceError(503, "The configured SHAP background dataset contains invalid expression values.")
        return background

    @staticmethod
    def _model_space(model, expression):
        with contextlib.redirect_stdout(io.StringIO()):
            preprocessed = model.preprocess(expression, batch_labels=None, fit=False)
        selected = preprocessed[:, model.selected_genes]
        return model.scaler.transform(selected)

    def _get_shap(self):
        if self.shap_module is not None:
            return self.shap_module
        try:
            import shap
        except ImportError as exc:
            raise XAIServiceError(503, "SHAP is not installed on this API instance.") from exc
        return shap

    def _get_explainer(self, model_name, model, feature_ids, target_index, path, stat):
        selected = np.asarray(model.selected_genes, dtype=int)
        selected_ids = [feature_ids[index] for index in selected]
        cache_key = (
            model_name,
            id(model),
            str(path.resolve()),
            stat.st_mtime_ns,
            stat.st_size,
            tuple(selected_ids),
            int(target_index),
        )
        with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached[0], selected_ids, cached[1]

        background_raw = self._load_background(path, feature_ids)
        background_model_space = self._model_space(model, background_raw)
        rng = np.random.default_rng(0)
        sample_indices = rng.choice(
            len(background_model_space),
            size=min(self.background_samples, len(background_model_space)),
            replace=False,
        )
        masker_data = background_model_space[sample_indices]
        shap = self._get_shap()

        def calibrated_probability(model_space):
            probabilities = np.asarray(model.ensemble.predict_proba(model_space), dtype=float)
            if (
                probabilities.ndim != 2
                or probabilities.shape[1] != len(model.classes_)
                or not np.isfinite(probabilities).all()
            ):
                raise ValueError("The calibrated model returned invalid probabilities.")
            return probabilities[:, int(target_index)]

        masker = shap.maskers.Independent(masker_data, max_samples=len(masker_data))
        explainer = shap.Explainer(
            calibrated_probability,
            masker,
            algorithm="permutation",
            feature_names=selected_ids,
            seed=0,
        )
        with self._cache_lock:
            if len(self._cache) >= 2:
                self._cache.pop(next(iter(self._cache)))
            self._cache[cache_key] = (explainer, len(masker_data))
        return explainer, selected_ids, len(masker_data)

    def explain_local(
        self,
        model_name,
        model,
        expression,
        feature_ids,
        target_index,
        expected_probability,
    ):
        path, stat = self._background_path(model_name)
        expected_feature_ids = list(feature_ids)
        raw_expression = np.asarray(expression, dtype=float)
        if raw_expression.shape != (1, len(expected_feature_ids)) or not np.isfinite(raw_expression).all():
            raise XAIServiceError(400, "The expression input is invalid for local explanation.")

        selected = np.asarray(model.selected_genes, dtype=int)
        if selected.ndim != 1 or selected.size == 0 or np.any(selected < 0) or np.any(selected >= len(feature_ids)):
            raise XAIServiceError(503, "The model's selected-feature metadata is invalid.")
        minimum_evals = max(1000, 2 * selected.size + 1)
        if minimum_evals > self.max_evals:
            raise XAIServiceError(413, "The explanation exceeds the configured SHAP evaluation limit.")

        target_index = int(target_index)
        model_space = self._model_space(model, raw_expression)
        probabilities = np.asarray(model.ensemble.predict_proba(model_space), dtype=float)
        if probabilities.ndim != 2 or target_index < 0 or target_index >= probabilities.shape[1]:
            raise XAIServiceError(400, "The requested explanation class is not supported by this model.")
        predicted_output = float(probabilities[0, target_index])
        if not np.isclose(predicted_output, expected_probability, atol=1e-8, rtol=1e-8):
            raise XAIServiceError(500, "The explanation output does not match the prediction response.")

        explainer, selected_ids, background_count = self._get_explainer(
            model_name,
            model,
            expected_feature_ids,
            target_index,
            path,
            stat,
        )
        try:
            explanation = explainer(model_space, max_evals=minimum_evals, silent=True)
        except Exception as exc:
            raise XAIServiceError(500, "SHAP could not calculate this local explanation.") from exc

        shap_values = np.asarray(explanation.values, dtype=float).reshape(-1, selected.size)
        base_values = np.asarray(explanation.base_values, dtype=float).reshape(-1)
        if shap_values.shape[0] != 1 or base_values.size != 1 or not np.isfinite(shap_values).all() or not np.isfinite(base_values).all():
            raise XAIServiceError(500, "SHAP returned an invalid local explanation.")

        residual = float(base_values[0] + shap_values[0].sum() - predicted_output)
        selected_raw = raw_expression[0, selected]
        selected_model_values = np.asarray(model_space[0], dtype=float)
        features = [
            {
                "feature_id": feature_id,
                "raw_input_value": float(raw_value),
                "model_input_value": float(model_value),
                "shap_value": float(shap_value),
            }
            for feature_id, raw_value, model_value, shap_value in zip(
                selected_ids,
                selected_raw,
                selected_model_values,
                shap_values[0],
            )
        ]
        features.sort(key=lambda feature: abs(feature["shap_value"]), reverse=True)

        return {
            "output": "calibrated_class_probability",
            "base_value": float(base_values[0]),
            "predicted_output": predicted_output,
            "features": features,
            "metadata": {
                "method": "shap_permutation",
                "explained_feature_space": "selected_standardized_features",
                "background_samples": background_count,
                "max_evals": minimum_evals,
                "additivity_residual": residual,
                "additivity_tolerance": self.additivity_tolerance,
                "additivity_verified": abs(residual) <= self.additivity_tolerance,
                "preprocessing_scope_note": (
                    "All raw features enter quantile normalization before selection. These SHAP values "
                    "explain the calibrated ensemble conditional on selected standardized features; "
                    "they are not a decomposition over every raw input feature."
                ),
            },
        }