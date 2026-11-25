import pytest
from fastapi.testclient import TestClient

import cel_service


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setenv("MICROAI_CEL_SERVICE_TOKEN", "secret")
    # Skip the real R startup check; unit tests stub the MAS5 runner.
    monkeypatch.setattr(cel_service, "check_r_runtime", lambda: {"checked": True, "available": True})
    with TestClient(cel_service.app) as client:
        yield client


def _post(client, token="secret", body=b"fake cel"):
    return client.post(
        "/preprocess",
        files={"file": ("sample.CEL", body, "application/octet-stream")},
        headers={"X-CEL-Service-Token": token},
    )


def test_preprocess_requires_token(service):
    assert _post(service, token="wrong").status_code == 401
    assert _post(service, token="").status_code == 401


def test_preprocess_returns_feature_ids_and_values(service, monkeypatch):
    from pathlib import Path

    seen = []

    def fake_runner(path):
        seen.append(Path(path).read_bytes())
        return {"p1": 1.5, "p2": 2.5}, [1.5, 2.5]

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_local", fake_runner)
    response = _post(service)

    assert response.status_code == 200
    assert response.json() == {"feature_ids": ["p1", "p2"], "values": [1.5, 2.5]}
    assert seen == [b"fake cel"]


def test_preprocess_rejects_concurrent_job(service, monkeypatch):
    monkeypatch.setattr(cel_service, "run_affy_preprocessing_local", lambda _p: ({}, []))
    monkeypatch.setattr(cel_service, "QUEUE_WAIT_SECONDS", 0.05)
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    try:
        response = _post(service)
    finally:
        cel_service._JOB_SLOT.release()

    assert response.status_code == 503


def test_preprocess_reports_r_failure(service, monkeypatch):
    def failing(_path):
        raise RuntimeError("bad CEL")

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_local", failing)
    response = _post(service)

    assert response.status_code == 500
    assert "bad CEL" in response.json()["detail"]


def test_health(service):
    body = service.get("/health").json()
    assert body["status"] == "ok"
    assert body["busy"] is False


def test_preprocess_waits_for_busy_slot_instead_of_failing(service, monkeypatch):
    import threading

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_local", lambda _p: ({"p1": 1.0}, [1.0]))
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    threading.Timer(0.2, cel_service._JOB_SLOT.release).start()

    response = _post(service)

    assert response.status_code == 200
    assert response.json() == {"feature_ids": ["p1"], "values": [1.0]}


def test_preprocess_rejects_when_wait_queue_is_full(service, monkeypatch):
    monkeypatch.setattr(cel_service, "run_affy_preprocessing_local", lambda _p: pytest.fail("R must not run"))
    monkeypatch.setattr(cel_service, "_queued", cel_service.MAX_QUEUED)
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    try:
        response = _post(service)
    finally:
        cel_service._JOB_SLOT.release()

    assert response.status_code == 503


def test_preprocess_passes_gzip_upload_to_r_unchanged(service, monkeypatch):
    import gzip
    from pathlib import Path

    seen = []

    def fake_runner(path):
        seen.append((Path(path).name.endswith(".CEL.gz"), Path(path).read_bytes()))
        return {"p1": 1.5}, [1.5]

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_local", fake_runner)
    body = gzip.compress(b"fake cel")
    response = _post(service, body=body)

    assert response.status_code == 200
    assert seen == [(True, body)]


def test_preprocess_rejects_invalid_or_oversized_gzip(service, monkeypatch):
    import gzip

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_local", lambda _p: pytest.fail("R must not run"))
    assert _post(service, body=gzip.compress(b"fake cel" * 50)[:-6]).status_code == 400
    monkeypatch.setattr(cel_service, "MAX_UPLOAD_BYTES", 4096)
    assert _post(service, body=gzip.compress(b"0" * 10_000)).status_code == 413
