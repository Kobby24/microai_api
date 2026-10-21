import sys
from pathlib import Path
from types import SimpleNamespace

import joblib

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class FakeModel:
    """Stand-in for a loaded MICRO-AI model with a known gene dimension."""

    def __init__(self, n_genes=3, classes=(0, 1)):
        self.training_info = {
            "n_genes_original": n_genes,
            "n_genes_final": n_genes,
            "training_imputation_applied": False,
        }
        self.classes_ = list(classes)
        self.gene_names = [f"g{index + 1}" for index in range(n_genes)]
        self.selected_genes = list(range(n_genes))
        self.quantile_normalizer = SimpleNamespace(reference_distribution=[0.0] * n_genes)
        self.scaler = SimpleNamespace(mean_=[0.0] * n_genes, scale_=[1.0] * n_genes)
        self.label_encoder = SimpleNamespace(classes_=list(classes))
        component = lambda: SimpleNamespace(classes_=list(range(len(classes))))
        self.ensemble = SimpleNamespace(
            weights=[1 / 3] * 3,
            gbm=component(),
            rf=component(),
            svm=component(),
        )
        self.combat_corrector = None

    def predict(self, X):
        return [1 if row[0] > 0 else 0 for row in X]

    def predict_proba(self, X):
        rows = []
        for row in X:
            rows.append([0.2, 0.8] if row[0] > 0 else [0.9, 0.1])
        return rows


def _stub_joblib_load(_path):
    return FakeModel()


# Use the real model implementation, but never deserialize production artifacts in API tests.
joblib.load = _stub_joblib_load

from fastapi.testclient import TestClient  # noqa: E402

from main import MODELS, app  # noqa: E402


@pytest.fixture
def fake_model():
    model = FakeModel(n_genes=3)
    original = dict(MODELS)
    MODELS.clear()
    MODELS["gse7390"] = model
    MODELS["gse2034"] = model
    yield model
    MODELS.clear()
    MODELS.update(original)


@pytest.fixture
def client(fake_model):
    return TestClient(app)
