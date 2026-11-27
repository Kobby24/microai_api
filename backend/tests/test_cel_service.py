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


# --------------------------------------------------------------------------- /preprocess/stream
import json as _json


def _stream(client, token="secret", body=b"fake cel"):
    response = client.post(
        "/preprocess/stream",
        files={"file": ("sample.CEL", body, "application/octet-stream")},
        headers={"X-CEL-Service-Token": token},
    )
    if response.status_code != 200:
        return response, []
    events = [_json.loads(line) for line in response.text.splitlines() if line.strip()]
    return response, [event for event in events if event["type"] != "heartbeat"]


def _fake_streaming_runner(stages=("loading_affy", "reading_cel", "mas5_background", "mas5_summaries", "extracting", "exporting")):
    def run(path, on_stage=None, cancel=None):
        for stage in stages:
            on_stage(stage)
        return {"p1": 1.5, "p2": 2.5}, [1.5, 2.5]
    return run


def test_stream_requires_token(service):
    response, _ = _stream(service, token="wrong")
    assert response.status_code == 401


def test_stream_reports_real_stages_in_order_then_result(service, monkeypatch):
    monkeypatch.setattr(cel_service, "run_affy_preprocessing_streaming", _fake_streaming_runner())
    response, events = _stream(service)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert [event.get("stage") for event in events[:-1]] == [
        "preprocessing_started",
        "loading_affy",
        "reading_cel",
        "mas5_background",
        "mas5_summaries",
        "extracting",
        "exporting",
    ]
    assert events[-1] == {"type": "result", "feature_ids": ["p1", "p2"], "values": [1.5, 2.5]}
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    cel_service._JOB_SLOT.release()


def test_stream_reports_queue_wait_before_preprocessing_starts(service, monkeypatch):
    import threading

    def run(path, on_stage=None, cancel=None):
        on_stage("reading_cel")
        return {"p1": 1.0}, [1.0]

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_streaming", run)
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    threading.Timer(0.4, cel_service._JOB_SLOT.release).start()

    response, events = _stream(service)

    assert response.status_code == 200
    assert [event.get("stage") or event["type"] for event in events] == [
        "queued",
        "preprocessing_started",
        "reading_cel",
        "result",
    ]
    assert cel_service._queued == 0


def test_stream_rejects_when_queue_is_full(service, monkeypatch):
    monkeypatch.setattr(cel_service, "run_affy_preprocessing_streaming", lambda *a, **k: pytest.fail("R must not run"))
    monkeypatch.setattr(cel_service, "_queued", cel_service.MAX_QUEUED)
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    try:
        response, _ = _stream(service)
    finally:
        cel_service._JOB_SLOT.release()
    assert response.status_code == 503


def test_stream_reports_busy_after_queue_wait_limit(service, monkeypatch):
    monkeypatch.setattr(cel_service, "run_affy_preprocessing_streaming", lambda *a, **k: pytest.fail("R must not run"))
    monkeypatch.setattr(cel_service, "QUEUE_WAIT_SECONDS", 0.3)
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    try:
        response, events = _stream(service)
    finally:
        cel_service._JOB_SLOT.release()
    assert response.status_code == 200
    assert events[0] == {"type": "stage", "stage": "queued"}
    assert events[-1]["type"] == "error" and events[-1]["status"] == 503
    assert cel_service._queued == 0


def test_stream_reports_r_failure_as_error_event(service, monkeypatch):
    def failing(path, on_stage=None, cancel=None):
        on_stage("reading_cel")
        raise RuntimeError("bad CEL")

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_streaming", failing)
    response, events = _stream(service)
    assert events[-1]["type"] == "error"
    assert events[-1]["status"] == 500
    assert "bad CEL" in events[-1]["detail"]
    assert all(event["type"] != "result" for event in events)


def test_stream_rejects_invalid_gzip_before_streaming(service, monkeypatch):
    import gzip

    monkeypatch.setattr(cel_service, "run_affy_preprocessing_streaming", lambda *a, **k: pytest.fail("R must not run"))
    response, _ = _stream(service, body=gzip.compress(b"fake cel" * 50)[:-6])
    assert response.status_code == 400


def _worker_run(tmp_path, admission, runner, cancel, monkeypatch):
    monkeypatch.setattr(cel_service, "run_affy_preprocessing_streaming", runner)
    cel = tmp_path / "job.CEL"
    cel.write_bytes(b"fake")
    events = []
    cel_service._run_stream_job(str(cel), admission, events.append, cancel)
    return cel, events


def test_cancelled_while_queued_leaves_queue_without_running_r(tmp_path, monkeypatch):
    import threading

    cancel = threading.Event()
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    with cel_service._QUEUE_LOCK:
        cel_service._queued += 1  # the reservation _reserve_job_slot makes
    threading.Timer(0.3, cancel.set).start()
    try:
        cel, events = _worker_run(tmp_path, "queued", lambda *a, **k: pytest.fail("R must not run"), cancel, monkeypatch)
    finally:
        cel_service._JOB_SLOT.release()

    assert events == [{"type": "stage", "stage": "queued"}]
    assert cel_service._queued == 0
    assert not cel.exists()


def test_cancelled_while_running_releases_slot_and_temp_file(tmp_path, monkeypatch):
    import threading

    from r_runtime import PreprocessingCancelled

    cancel = threading.Event()

    def runner(path, on_stage=None, cancel=None):
        on_stage("mas5_background")
        cancel.set()  # the caller disconnected while R was running
        raise PreprocessingCancelled("cancelled")

    assert cel_service._JOB_SLOT.acquire(blocking=False)  # admitted as "running"
    cel, events = _worker_run(tmp_path, "running", runner, cancel, monkeypatch)

    assert [event["type"] for event in events] == ["stage", "stage"]
    assert not cel.exists()
    assert cel_service._JOB_SLOT.acquire(blocking=False)
    cel_service._JOB_SLOT.release()
