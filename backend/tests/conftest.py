import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class FakeModel:
    """Stand-in for a loaded MICRO-AI model with a known gene dimension."""

    def __init__(self, n_genes=3, classes=(0, 1)):
        self.training_info = {"n_genes_original": n_genes}
        self.classes_ = list(classes)

    def predict(self, X):
        return [1 if row[0] > 0 else 0 for row in X]

    def predict_proba(self, X):
        rows = []
        for row in X:
            rows.append([0.2, 0.8] if row[0] > 0 else [0.9, 0.1])
        return rows


def _stub_joblib_load(_path):
    return FakeModel()


# Avoid importing sklearn / real joblib artifacts when the API module loads.
sys.modules.setdefault("microai_model", MagicMock())
_fake_joblib = MagicMock()
_fake_joblib.load.side_effect = _stub_joblib_load
sys.modules.setdefault("joblib", _fake_joblib)

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
