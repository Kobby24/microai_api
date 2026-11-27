"""CEL analysis jobs: live processing stages over server-sent events."""
import gzip
import json
import threading
import time

import pytest

import cel_jobs
import main
from r_runtime import PreprocessingCancelled

R_STAGES = [
    "queued",
    "preprocessing_started",
    "loading_affy",
    "reading_cel",
    "mas5_background",
    "mas5_summaries",
    "extracting",
    "exporting",
]
FEATURE_MAP = {"g3": 3.0, "g1": 1.0, "g2": 2.0}


def _wait(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def _fake_preprocessing(stages=R_STAGES, feature_map=FEATURE_MAP, gate=None, error=None, calls=None):
    def run(path, on_stage=None, cancel=None):
        if calls is not None:
            calls.append(path)
        for stage in stages:
            on_stage(stage)
            if stage == "mas5_background" and gate is not None:
                while not gate.wait(0.05):
                    if cancel is not None and cancel.is_set():
                        raise PreprocessingCancelled("cancelled")
        if error is not None:
            raise error
        return dict(feature_map), list(feature_map.values())
    return run


def _start(client, filename="sample.CEL.gz", body=None, model_name="gse7390"):
    body = gzip.compress(b"fake cel") if body is None else body
    response = client.post(
        f"/predict_cel_jobs/{model_name}",
        files={"file": (filename, body, "application/octet-stream")},
    )
    return response


def _events(client, job_id, headers=None, after=None):
    url = f"/predict_cel_jobs/{job_id}/events" + (f"?after={after}" if after is not None else "")
    response = client.get(url, headers=headers or {})
    assert response.status_code == 200
    events = []
    for block in response.text.split("\n\n"):
        data = [line[6:] for line in block.splitlines() if line.startswith("data: ")]
        if data:
            events.append(json.loads("".join(data)))
    return response, events


def _job(job_id):
    return cel_jobs.CEL_JOBS.get(job_id)


def test_job_reports_every_real_stage_in_order_and_result_matches_predict_cel(client, fake_model, monkeypatch):
    monkeypatch.setattr(main, "run_affy_preprocessing", _fake_preprocessing())
    created = _start(client)
    assert created.status_code == 202
    job_id = created.json()["job_id"]
    assert created.json()["events_url"] == f"/predict_cel_jobs/{job_id}/events"
    assert _wait(lambda: _job(job_id).finished)

    response, events = _events(client, job_id)
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
    assert [event.get("stage") or event["type"] for event in events] == [
        "received",
        "validating_file",
        *R_STAGES,
        "validating_expression",
        "predicting",
        "preparing_results",
        "result_ready",
    ]

    result = client.get(f"/predict_cel_jobs/{job_id}/result")
    monkeypatch.setattr(main, "run_affy_preprocessing", lambda _path: (dict(FEATURE_MAP), list(FEATURE_MAP.values())))
    direct = client.post(
        "/predict_cel/gse7390",
        files={"file": ("sample.CEL.gz", gzip.compress(b"fake cel"), "application/octet-stream")},
    )
    assert result.status_code == 200 and direct.status_code == 200
    assert result.json() == direct.json()
    assert result.json()["feature_ids"] == ["g1", "g2", "g3"]
    assert result.json()["expression"] == [1.0, 2.0, 3.0]


def test_no_later_stage_or_completion_is_reported_while_mas5_runs(client, fake_model, monkeypatch):
    gate = threading.Event()
    monkeypatch.setattr(main, "run_affy_preprocessing", _fake_preprocessing(gate=gate))
    job_id = _start(client).json()["job_id"]
    assert _wait(lambda: any(e.get("stage") == "mas5_background" for e in _job(job_id).events_after(0)))
    time.sleep(0.3)

    stages = [event.get("stage") or event["type"] for event in _job(job_id).events_after(0)]
    assert stages[-1] == "mas5_background"
    assert not {"mas5_summaries", "validating_expression", "predicting", "result_ready"} & set(stages)
    assert client.get(f"/predict_cel_jobs/{job_id}/result").status_code == 409

    gate.set()
    assert _wait(lambda: _job(job_id).finished)
    assert _job(job_id).events_after(0)[-1]["type"] == "result_ready"


@pytest.mark.parametrize(
    ("preprocessing", "body", "status", "detail", "last_stage"),
    [
        (_fake_preprocessing(error=RuntimeError("Error in ReadAffy: internal R trace /tmp/x")), None, 500,
         "CEL preprocessing failed.", "exporting"),
        (_fake_preprocessing(feature_map={"g1": 1.0, "g2": 2.0}), None, 400,
         "Feature identifiers do not match this model's required gene/probe set.", "validating_expression"),
        (_fake_preprocessing(feature_map={"g1": 1.0, "g2": float("nan"), "g3": 3.0}), None, 400,
         "CEL-derived expression values must be numeric and finite.", "validating_expression"),
        (_fake_preprocessing(), b"not a gzip archive", 400,
         "The uploaded file is not a valid gzip-compressed Affymetrix CEL file.", "validating_file"),
    ],
)
def test_failures_end_with_a_user_facing_error_event(client, fake_model, monkeypatch, preprocessing, body, status, detail, last_stage):
    monkeypatch.setattr(main, "run_affy_preprocessing", preprocessing)
    job_id = _start(client, body=body).json()["job_id"]
    assert _wait(lambda: _job(job_id).finished)

    _, events = _events(client, job_id)
    assert events[-1] == {"seq": events[-1]["seq"], "type": "error", "status": status, "detail": detail}
    assert events[-2]["stage"] == last_stage
    assert all(event["type"] != "result_ready" for event in events)
    result = client.get(f"/predict_cel_jobs/{job_id}/result")
    assert result.status_code == status and result.json() == {"detail": detail}


def test_model_failure_is_reported_as_prediction_failure(client, fake_model, monkeypatch):
    def broken(_X):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(main, "run_affy_preprocessing", _fake_preprocessing())
    monkeypatch.setattr(fake_model, "predict_proba", broken)
    job_id = _start(client).json()["job_id"]
    assert _wait(lambda: _job(job_id).finished)
    _, events = _events(client, job_id)
    assert events[-2]["stage"] == "predicting"
    assert events[-1]["type"] == "error" and events[-1]["detail"] == "Prediction failed."


def test_busy_preprocessor_is_reported_as_retryable(client, fake_model, monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setattr(
        main,
        "run_affy_preprocessing",
        _fake_preprocessing(stages=["queued"], error=HTTPException(status_code=503, detail=main._CEL_SERVICE_BUSY_DETAIL)),
    )
    job_id = _start(client).json()["job_id"]
    assert _wait(lambda: _job(job_id).finished)
    event = _job(job_id).events_after(0)[-1]
    assert event["type"] == "error" and event["status"] == 503 and "retry" in event["detail"].lower()


def test_concurrent_jobs_never_mix_events_or_results(client, fake_model, monkeypatch):
    gates = {b"patient-A": threading.Event(), b"patient-B": threading.Event()}
    maps = {b"patient-A": {"g1": 1.0, "g2": 2.0, "g3": 3.0}, b"patient-B": {"g1": -1.0, "g2": -2.0, "g3": -3.0}}

    def run(path, on_stage=None, cancel=None):
        content = gzip.decompress(open(path, "rb").read())
        on_stage("reading_cel")
        gates[content].wait(10)
        on_stage("mas5_background")
        return dict(maps[content]), list(maps[content].values())

    monkeypatch.setattr(main, "run_affy_preprocessing", run)
    job_a = _start(client, body=gzip.compress(b"patient-A")).json()["job_id"]
    job_b = _start(client, body=gzip.compress(b"patient-B")).json()["job_id"]
    assert job_a != job_b
    gates[b"patient-B"].set()
    assert _wait(lambda: _job(job_b).finished)
    assert not _job(job_a).finished
    assert _job(job_a).events_after(0)[-1]["stage"] == "reading_cel"
    gates[b"patient-A"].set()
    assert _wait(lambda: _job(job_a).finished)

    for job_id, content in ((job_a, b"patient-A"), (job_b, b"patient-B")):
        _, events = _events(client, job_id)
        assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
        assert events.count({"seq": events[-1]["seq"], "type": "result_ready"}) == 1
        result = client.get(f"/predict_cel_jobs/{job_id}/result").json()
        assert result["expression"] == [maps[content][key] for key in ("g1", "g2", "g3")]


def test_cancel_stops_the_job_and_records_cancellation(client, fake_model, monkeypatch):
    gate = threading.Event()
    calls = []
    monkeypatch.setattr(main, "run_affy_preprocessing", _fake_preprocessing(gate=gate, calls=calls))
    job_id = _start(client).json()["job_id"]
    assert _wait(lambda: any(e.get("stage") == "mas5_background" for e in _job(job_id).events_after(0)))

    assert client.delete(f"/predict_cel_jobs/{job_id}").status_code == 204
    assert client.delete(f"/predict_cel_jobs/{job_id}").status_code == 204  # idempotent
    assert _wait(lambda: _job(job_id).finished)
    time.sleep(0.3)  # the worker notices the cancel flag and stops

    _, events = _events(client, job_id)
    assert events[-1]["type"] == "cancelled"
    assert [e["type"] for e in events].count("cancelled") == 1
    assert all(event["type"] != "result_ready" for event in events)
    assert client.get(f"/predict_cel_jobs/{job_id}/result").status_code == 409
    # The temporary CEL file handed to preprocessing was removed.
    assert calls and not __import__("pathlib").Path(calls[0]).exists()


def test_reconnect_replays_only_events_after_last_event_id(client, fake_model, monkeypatch):
    monkeypatch.setattr(main, "run_affy_preprocessing", _fake_preprocessing())
    job_id = _start(client).json()["job_id"]
    assert _wait(lambda: _job(job_id).finished)
    _, all_events = _events(client, job_id)

    _, resumed = _events(client, job_id, headers={"Last-Event-ID": "5"})
    assert resumed == all_events[5:]
    _, by_query = _events(client, job_id, after=5)
    assert by_query == all_events[5:]
    # Reconnecting after the terminal event ends the stream immediately, with no new events.
    _, after_end = _events(client, job_id, headers={"Last-Event-ID": str(all_events[-1]["seq"])})
    assert after_end == []


def test_unknown_or_expired_job_is_404(client):
    for response in (
        client.get("/predict_cel_jobs/nope/events"),
        client.get("/predict_cel_jobs/nope/result"),
        client.delete("/predict_cel_jobs/nope"),
    ):
        assert response.status_code == 404


def test_job_requests_are_validated_like_predict_cel(client, fake_model, monkeypatch):
    monkeypatch.setattr(main, "run_affy_preprocessing", lambda *a, **k: pytest.fail("must not run"))
    assert _start(client, filename="sample.txt").status_code == 400
    assert _start(client, model_name="unknown").status_code == 404
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 10)
    assert _start(client, body=b"x" * 11, filename="sample.CEL").status_code == 413


def test_running_job_capacity_is_limited(client, fake_model, monkeypatch):
    gate = threading.Event()
    monkeypatch.setattr(main, "run_affy_preprocessing", _fake_preprocessing(gate=gate))
    monkeypatch.setattr(cel_jobs, "MAX_ACTIVE_JOBS", 1)
    first = _start(client).json()["job_id"]
    try:
        assert _start(client).status_code == 503
    finally:
        gate.set()
    assert _wait(lambda: _job(first).finished)
    assert _start(client).status_code == 202
    gate.set()


def test_orphaned_jobs_are_cancelled_and_finished_jobs_expire(fake_model):
    store = cel_jobs.CelJobStore()
    running = store.create("gse7390")
    finished = store.create("gse7390")
    finished.complete({"prediction": "1"})
    now = time.monotonic()

    store.reap(now + cel_jobs.ORPHAN_SECONDS / 2)
    assert not running.cancel_event.is_set()
    store.reap(now + cel_jobs.ORPHAN_SECONDS + 1)
    assert running.cancel_event.is_set() and running.events_after(0)[-1]["type"] == "cancelled"
    assert store.get(finished.id) is not None
    store.reap(time.monotonic() + cel_jobs.RETENTION_SECONDS + 1)
    assert store.get(finished.id) is None


def test_job_ids_are_unguessable_and_unique(fake_model):
    store = cel_jobs.CelJobStore()
    ids = {store.create("gse7390").id for _ in range(5)}
    assert len(ids) == 5 and all(len(job_id) >= 32 for job_id in ids)


# --------------------------------------------------------------------------- API <-> CEL service stream
class _FakeStreamResponse:
    def __init__(self, status_code, lines=(), text=""):
        self.status_code = status_code
        self._lines = list(lines)
        self.text = text
        self.closed = False

    def read(self):
        return self.text.encode()

    def iter_lines(self):
        for line in self._lines:
            if callable(line):
                line = line()
            yield line

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.closed = True
        return False


class _FakeStreamingClient:
    def __init__(self, response):
        self.response = response
        self.requests = []

    def __call__(self, *args, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def stream(self, method, url, files=None, headers=None):
        self.requests.append((method, url, headers))
        return self.response


def _remote(monkeypatch, tmp_path, response):
    import httpx

    fake = _FakeStreamingClient(response)
    monkeypatch.setattr(main, "CEL_SERVICE_URL", "https://cel.example")
    monkeypatch.setattr(main, "CEL_SERVICE_TOKEN", "secret")
    monkeypatch.setattr(httpx, "Client", fake)
    cel = tmp_path / "x.CEL.gz"
    cel.write_bytes(b"gz")
    return fake, str(cel)


def test_remote_stream_forwards_service_stages_and_returns_expression(monkeypatch, tmp_path):
    lines = [
        '{"type":"heartbeat"}',
        '{"type":"stage","stage":"queued"}',
        '{"type":"stage","stage":"preprocessing_started"}',
        '{"type":"stage","stage":"not_a_known_stage"}',
        '{"type":"stage","stage":"mas5_background"}',
        "",
        '{"type":"result","feature_ids":["g1","g2"],"values":[1.0,2.0]}',
    ]
    fake, cel = _remote(monkeypatch, tmp_path, _FakeStreamResponse(200, lines))
    seen = []

    feature_map, values = main.run_affy_preprocessing(cel, on_stage=seen.append, cancel=threading.Event())

    assert seen == ["sending_to_preprocessor", "queued", "preprocessing_started", "mas5_background"]
    assert feature_map == {"g1": 1.0, "g2": 2.0} and values == [1.0, 2.0]
    assert fake.requests == [("POST", "https://cel.example/preprocess/stream", {"X-CEL-Service-Token": "secret"})]


def test_remote_stream_busy_error_maps_to_retryable_503(monkeypatch, tmp_path):
    from fastapi import HTTPException

    _, cel = _remote(monkeypatch, tmp_path, _FakeStreamResponse(200, ['{"type":"error","status":503,"detail":"busy"}']))
    with pytest.raises(HTTPException) as raised:
        main.run_affy_preprocessing(cel, on_stage=lambda _s: None, cancel=threading.Event())
    assert raised.value.status_code == 503


def test_remote_stream_cancel_closes_the_connection(monkeypatch, tmp_path):
    cancel = threading.Event()
    lines = ['{"type":"stage","stage":"mas5_background"}', lambda: (cancel.set(), '{"type":"heartbeat"}')[1]]
    fake, cel = _remote(monkeypatch, tmp_path, _FakeStreamResponse(200, lines))
    with pytest.raises(PreprocessingCancelled):
        main.run_affy_preprocessing(cel, on_stage=lambda _s: None, cancel=cancel)
    assert fake.response.closed


def test_remote_stream_without_result_is_an_error(monkeypatch, tmp_path):
    _, cel = _remote(monkeypatch, tmp_path, _FakeStreamResponse(200, ['{"type":"stage","stage":"reading_cel"}']))
    with pytest.raises(RuntimeError, match="without a result"):
        main.run_affy_preprocessing(cel, on_stage=lambda _s: None, cancel=threading.Event())


def test_older_cel_service_without_stream_endpoint_still_works(monkeypatch, tmp_path):
    _, cel = _remote(monkeypatch, tmp_path, _FakeStreamResponse(404))
    monkeypatch.setattr(main, "_run_affy_preprocessing_remote", lambda path: ({"g1": 1.0}, [1.0]))
    seen = []
    assert main.run_affy_preprocessing(cel, on_stage=seen.append, cancel=threading.Event()) == ({"g1": 1.0}, [1.0])
    assert seen == ["sending_to_preprocessor", "mas5_unstaged"]
