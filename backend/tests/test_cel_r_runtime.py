"""R runtime / CEL preprocessing tests.

Unit tests (Rscript discovery, timeout handling) always run.
Integration tests need a real Rscript with affy + hgu133acdf, and a real GPL96
(HG-U133A) CEL file passed via MICROAI_TEST_CEL (``.CEL`` or ``.CEL.gz``), e.g.:

    docker run --rm -v /path/to/cel:/data -e MICROAI_TEST_CEL=/data/GSM177885.CEL.gz \
        microai-backend python -m pytest tests/test_cel_r_runtime.py -v
"""
import gzip
import math
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
import r_runtime
from main import MODELS, app

GPL96_PROBE_SET_COUNT = 22283
TEST_CEL = os.getenv("MICROAI_TEST_CEL")

requires_r = pytest.mark.skipif(shutil.which("Rscript") is None, reason="Rscript not installed")
requires_cel = pytest.mark.skipif(
    not TEST_CEL or not Path(TEST_CEL).is_file(), reason="MICROAI_TEST_CEL not set to a CEL file"
)


# --------------------------------------------------------------------------- unit


def test_resolve_rscript_prefers_valid_env_path(tmp_path, monkeypatch):
    fake = tmp_path / "Rscript"
    fake.write_text("#!/bin/sh\n")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("RSCRIPT_PATH", str(fake))
    assert main.resolve_rscript() == str(fake)


def test_resolve_rscript_rejects_non_executable_env_path(tmp_path, monkeypatch):
    fake = tmp_path / "Rscript"
    fake.write_text("not executable")
    fake.chmod(0o644)
    monkeypatch.setenv("RSCRIPT_PATH", str(fake))
    with pytest.raises(RuntimeError, match="RSCRIPT_PATH"):
        main.resolve_rscript()


def test_resolve_rscript_reports_missing_executable(monkeypatch):
    monkeypatch.delenv("RSCRIPT_PATH", raising=False)
    monkeypatch.setattr(r_runtime.shutil, "which", lambda _name: None)
    with pytest.raises(RuntimeError, match="not installed or is not available in PATH"):
        main.resolve_rscript()


def test_run_affy_preprocessing_reports_timeout(monkeypatch, tmp_path):
    monkeypatch.setattr(r_runtime, "resolve_rscript", lambda: "/usr/bin/Rscript")

    def fake_run(args, **kwargs):
        assert kwargs["timeout"] == r_runtime.RSCRIPT_TIMEOUT_SECONDS
        assert args[0] == "/usr/bin/Rscript"
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    monkeypatch.setattr(r_runtime.subprocess, "run", fake_run)
    with pytest.raises(RuntimeError, match="time limit"):
        r_runtime.run_affy_preprocessing_local(str(tmp_path / "x.CEL"))


def test_check_r_runtime_reports_missing_rscript(monkeypatch):
    monkeypatch.delenv("RSCRIPT_PATH", raising=False)
    monkeypatch.setattr(r_runtime.shutil, "which", lambda _name: None)
    status = r_runtime.check_r_runtime()
    assert status["available"] is False
    assert "Rscript" in status["error"]


# -------------------------------------------------------------------- integration


@requires_r
def test_rscript_is_discoverable_and_runs():
    rscript = main.resolve_rscript()
    completed = subprocess.run([rscript, "--version"], capture_output=True, text=True, timeout=60)
    assert completed.returncode == 0
    assert "Rscript (R) version" in (completed.stdout + completed.stderr)


@requires_r
def test_affy_and_cdf_packages_load():
    completed = subprocess.run(
        [main.resolve_rscript(), "--vanilla", "-e", "library(affy); library(hgu133acdf); cat('ok')"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip().endswith("ok")


@requires_r
def test_startup_runtime_check_passes():
    status = r_runtime.check_r_runtime()
    assert status == {"checked": True, "available": True}


def _decompressed_cel(tmp_path) -> Path:
    source = Path(TEST_CEL)
    if source.name.lower().endswith(".gz"):
        target = tmp_path / "sample.CEL"
        target.write_bytes(gzip.decompress(source.read_bytes()))
        return target
    return source


@requires_r
@requires_cel
def test_mas5_preprocessing_on_real_cel(tmp_path):
    feature_map, values = main.run_affy_preprocessing(str(_decompressed_cel(tmp_path)))
    assert len(values) == GPL96_PROBE_SET_COUNT
    assert len(feature_map) == GPL96_PROBE_SET_COUNT
    assert "1007_s_at" in feature_map and "AFFX-BioB-5_at" in feature_map
    assert all(math.isfinite(v) for v in values)
    # log2 of MAS5 (sc = 600) signals: the trimmed mean of the raw signal is ~600,
    # so log2 values should sit in a plausible range, not raw intensities.
    assert max(values) < 20  # log2 scale, not raw intensities (values < 0 are valid for signals < 1)
    raw = sorted(2 ** v for v in values)
    trim = int(len(raw) * 0.02)
    trimmed_mean = sum(raw[trim:-trim]) / len(raw[trim:-trim])
    assert trimmed_mean == pytest.approx(600, rel=0.01)


REAL_MODEL_PATHS = {
    "gse7390": Path(main.__file__).resolve().parent / "models" / "GSE7390_model.joblib",
    "gse2034": Path(main.__file__).resolve().parent / "models" / "GSE2034_model.joblib",
}


@pytest.fixture
def real_models():
    # conftest stubs joblib.load so API tests never deserialize production artifacts.
    # This opt-in integration test deliberately uses the real artifacts via joblib's
    # original loader, restoring the stubbed MODELS afterwards.
    from joblib.numpy_pickle import load as real_joblib_load

    original = dict(MODELS)
    MODELS.clear()
    MODELS.update({name: real_joblib_load(path) for name, path in REAL_MODEL_PATHS.items()})
    main._attach_verified_model_metadata()  # same step main.py runs at import
    yield MODELS
    MODELS.clear()
    MODELS.update(original)


@requires_r
@requires_cel
@pytest.mark.parametrize("model_name", sorted(REAL_MODEL_PATHS))
def test_predict_cel_end_to_end_with_real_models(real_models, model_name):
    assert main._model_readiness_issue(model_name, MODELS[model_name]) is None
    assert len(main._feature_ids(MODELS[model_name])) == GPL96_PROBE_SET_COUNT
    payload = Path(TEST_CEL).read_bytes()
    filename = "sample.CEL.gz" if TEST_CEL.lower().endswith(".gz") else "sample.CEL"
    with TestClient(app) as client:
        assert client.get("/health").json()["cel_preprocessing_available"] is True
        response = client.post(
            f"/predict_cel/{model_name}",
            files={"file": (filename, payload, "application/octet-stream")},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["prediction"] in body["class_probabilities"]
    assert sum(body["class_probabilities"].values()) == pytest.approx(1.0, abs=1e-6)
    assert body["feature_ids"] == main._feature_ids(MODELS[model_name])
