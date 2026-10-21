from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from xai_service import XAIService, XAIServiceError


FEATURE_IDS = ["probe1", "probe2", "probe3"]


class IdentityScaler:
    def transform(self, values):
        return np.asarray(values, dtype=float)


class ExplainableFakeModel:
    def __init__(self):
        self.selected_genes = np.array([0, 2])
        self.classes_ = np.array([0, 1])
        self.scaler = IdentityScaler()
        self.ensemble = SimpleNamespace(predict_proba=self.predict_proba)

    def preprocess(self, values, batch_labels=None, fit=False):
        assert batch_labels is None
        assert fit is False
        return np.asarray(values, dtype=float)

    def predict_proba(self, values):
        positive = 0.5 + 0.1 * np.asarray(values)[:, 0]
        return np.column_stack((1 - positive, positive))


class FakeMasker:
    def __init__(self, data):
        self.data = np.asarray(data)


class FakeExplanation:
    def __init__(self, values, base_values, data):
        self.values = values
        self.base_values = base_values
        self.data = data


class FakeExplainer:
    def __init__(self, predict, masker, feature_names, algorithm, seed):
        assert algorithm == "permutation"
        assert seed == 0
        self.predict = predict
        self.masker = masker
        self.feature_names = feature_names

    def __call__(self, values, max_evals, silent):
        assert max_evals == 1000
        assert silent is True
        values = np.asarray(values, dtype=float)
        expected = np.asarray(self.predict(self.masker.data), dtype=float).mean()
        output = np.asarray(self.predict(values), dtype=float)
        contributions = np.zeros_like(values)
        contributions[:, 0] = output - expected
        return FakeExplanation(contributions, np.array([expected]), values)


class FakeShap:
    class maskers:
        @staticmethod
        def Independent(data, max_samples):
            assert max_samples == len(data)
            return FakeMasker(data)
    explainer_builds = 0


    @classmethod
    def Explainer(cls, predict, masker, algorithm, feature_names, seed):
        cls.explainer_builds += 1
        return FakeExplainer(predict, masker, feature_names, algorithm, seed)


def _background_file(tmp_path, columns=None, include_sample_id=False):
    columns = columns or FEATURE_IDS
    values = {
        "probe1": [0.0, 2.0],
        "probe2": [0.0, 0.0],
        "probe3": [3.0, -3.0],
    }
    frame = pd.DataFrame(
        {feature_id: values.get(feature_id, [1.0, 2.0]) for feature_id in columns},
        index=["reference-a", "reference-b"],
    )
    if include_sample_id:
        frame.index.name = "sample_id"
    path = tmp_path / "approved-background.csv"
    frame.to_csv(path, index=include_sample_id)
    return path


def test_local_explanation_uses_calibrated_output_and_preserves_feature_ids(tmp_path):
    path = _background_file(tmp_path)
    service = XAIService(background_paths={"gse7390": path}, shap_module=FakeShap)
    model = ExplainableFakeModel()
    expression = np.array([[2.0, 8.0, 5.0]])

    result = service.explain_local(
        "gse7390",
        model,
        expression,
        FEATURE_IDS,
        target_index=1,
        expected_probability=0.7,
    )

    assert result["output"] == "calibrated_class_probability"
    assert result["predicted_output"] == pytest.approx(0.7)
    assert result["base_value"] + sum(feature["shap_value"] for feature in result["features"]) == pytest.approx(0.7)
    assert result["metadata"]["additivity_verified"] is True
    assert result["metadata"]["background_samples"] == 2
    by_id = {feature["feature_id"]: feature for feature in result["features"]}
    assert set(by_id) == {"probe1", "probe3"}
    assert by_id["probe1"]["raw_input_value"] == 2.0


def test_local_explanation_reuses_cached_explainer(tmp_path):
    service = XAIService(background_paths={"gse7390": _background_file(tmp_path)}, shap_module=FakeShap)
    model = ExplainableFakeModel()
    build_count = FakeShap.explainer_builds

    for _ in range(2):
        service.explain_local(
            "gse7390",
            model,
            np.array([[2.0, 8.0, 5.0]]),
            FEATURE_IDS,
            target_index=1,
            expected_probability=0.7,
        )

    assert FakeShap.explainer_builds == build_count + 1


def test_local_explanation_refuses_background_with_different_feature_ids(tmp_path):
    path = _background_file(tmp_path, columns=["probe1", "probe2", "unknown"])
    service = XAIService(background_paths={"gse7390": path}, shap_module=FakeShap)

    with pytest.raises(XAIServiceError, match="does not match the model feature schema"):
        service.explain_local(
            "gse7390",
            ExplainableFakeModel(),
            np.array([[2.0, 8.0, 5.0]]),
            FEATURE_IDS,
            target_index=1,
            expected_probability=0.7,
        )


def test_local_explanation_refuses_reordered_background_columns(tmp_path):
    path = _background_file(tmp_path, columns=["probe2", "probe1", "probe3"])
    service = XAIService(background_paths={"gse7390": path}, shap_module=FakeShap)

    with pytest.raises(XAIServiceError, match="does not match the model feature schema"):
        service.explain_local(
            "gse7390",
            ExplainableFakeModel(),
            np.array([[2.0, 8.0, 5.0]]),
            FEATURE_IDS,
            target_index=1,
            expected_probability=0.7,
        )


def test_local_explanation_accepts_explicit_sample_id_column(tmp_path):
    path = _background_file(tmp_path, include_sample_id=True)
    service = XAIService(background_paths={"gse7390": path}, shap_module=FakeShap)

    result = service.explain_local(
        "gse7390",
        ExplainableFakeModel(),
        np.array([[2.0, 8.0, 5.0]]),
        FEATURE_IDS,
        target_index=1,
        expected_probability=0.7,
    )

    assert result["metadata"]["background_samples"] == 2


def test_local_explanation_refuses_missing_background(tmp_path):
    service = XAIService(background_paths={"gse7390": tmp_path / "missing.csv"}, shap_module=FakeShap)

    with pytest.raises(XAIServiceError, match="background dataset is unavailable"):
        service.explain_local(
            "gse7390",
            ExplainableFakeModel(),
            np.array([[2.0, 8.0, 5.0]]),
            FEATURE_IDS,
            target_index=1,
            expected_probability=0.7,
        )


def test_local_explanation_enforces_evaluation_limit(tmp_path):
    service = XAIService(background_paths={"gse7390": _background_file(tmp_path)}, shap_module=FakeShap)
    service.max_evals = 999

    with pytest.raises(XAIServiceError, match="evaluation limit"):
        service.explain_local(
            "gse7390",
            ExplainableFakeModel(),
            np.array([[2.0, 8.0, 5.0]]),
            FEATURE_IDS,
            target_index=1,
            expected_probability=0.7,
        )


def test_local_explanation_enforces_background_cell_limit(tmp_path):
    service = XAIService(background_paths={"gse7390": _background_file(tmp_path)}, shap_module=FakeShap)
    service.max_background_cells = 5

    with pytest.raises(XAIServiceError, match="exceeds the cell limit"):
        service.explain_local(
            "gse7390",
            ExplainableFakeModel(),
            np.array([[2.0, 8.0, 5.0]]),
            FEATURE_IDS,
            target_index=1,
            expected_probability=0.7,
        )


def test_local_explanation_refuses_prediction_output_mismatch(tmp_path):
    service = XAIService(background_paths={"gse7390": _background_file(tmp_path)}, shap_module=FakeShap)

    with pytest.raises(XAIServiceError, match="does not match the prediction response"):
        service.explain_local(
            "gse7390",
            ExplainableFakeModel(),
            np.array([[2.0, 8.0, 5.0]]),
            FEATURE_IDS,
            target_index=1,
            expected_probability=0.6,
        )