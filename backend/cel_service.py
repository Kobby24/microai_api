"""Standalone Affymetrix CEL preprocessing service (R/affy MAS5).

Runs as its own Render service so the R/Bioconductor memory peak does not share
a 512 MB container with the Python ML API. Deliberately imports no numpy/pandas/sklearn.

    POST /preprocess   multipart "file" = .CEL or .CEL.gz
                       header X-CEL-Service-Token = $MICROAI_CEL_SERVICE_TOKEN
                       -> {"feature_ids": [...], "values": [...]}
    POST /preprocess/stream   same request; newline-delimited JSON events:
                       {"type": "stage", "stage": "queued" | "preprocessing_started" | <R stage>}
                       {"type": "heartbeat"} (about once a second while nothing else happens)
                       then exactly one {"type": "result", "feature_ids": [...], "values": [...]}
                       or {"type": "error", "status": <http status>, "detail": "..."}.
                       Closing the stream cancels the job (leaves the queue or stops R).
    GET  /health
"""
import asyncio
import gzip
import hmac
import io
import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from r_runtime import (
    PreprocessingCancelled,
    R_RUNTIME_STATUS,
    check_r_runtime,
    positive_limit,
    run_affy_preprocessing_local,
    run_affy_preprocessing_streaming,
)

logger = logging.getLogger(__name__)
app = FastAPI(title="MICRO-AI CEL Preprocessor")

MAX_UPLOAD_BYTES = positive_limit("MICROAI_MAX_UPLOAD_BYTES", 50 * 1024 * 1024)
# One R/MAS5 job at a time: two concurrent jobs would blow the 512 MB budget.
_JOB_SLOT = threading.Semaphore(1)
# A request that finds the slot busy waits briefly for it (one MAS5 job takes ~8 s)
# instead of failing straight away. At most MAX_QUEUED requests wait; uploads stay
# spooled by the multipart parser, so waiting costs no extra R memory.
QUEUE_WAIT_SECONDS = float(positive_limit("MICROAI_CEL_QUEUE_WAIT_SECONDS", 45))
MAX_QUEUED = positive_limit("MICROAI_CEL_MAX_QUEUED", 4)
_QUEUE_LOCK = threading.Lock()
_queued = 0
_GZIP_MAGIC = b"\x1f\x8b"


def _acquire_job_slot() -> bool:
    global _queued
    if _JOB_SLOT.acquire(blocking=False):
        return True
    with _QUEUE_LOCK:
        if _queued >= MAX_QUEUED:
            return False
        _queued += 1
    try:
        return _JOB_SLOT.acquire(timeout=QUEUE_WAIT_SECONDS)
    finally:
        with _QUEUE_LOCK:
            _queued -= 1


def _gzip_within_limit(contents: bytes) -> bool:
    """Stream-check gzip integrity and decompressed size without keeping the output."""
    total = 0
    with gzip.GzipFile(fileobj=io.BytesIO(contents), mode="rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                return True
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                return False


def _reserve_job_slot():
    """Admission for /preprocess/stream, with the same capacity rule as /preprocess.

    Returns "running" (slot held), "queued" (a waiting place is reserved; the worker
    decrements the count when it stops waiting) or None (queue full).
    """
    global _queued
    if _JOB_SLOT.acquire(blocking=False):
        return "running"
    with _QUEUE_LOCK:
        if _queued >= MAX_QUEUED:
            return None
        _queued += 1
    return "queued"


def _store_upload(contents: bytes) -> str:
    """Validate an uploaded CEL / CEL.gz body and write it to a temporary file."""
    if not contents:
        raise HTTPException(status_code=400, detail="Empty CEL file.")
    is_gzip = contents[:2] == _GZIP_MAGIC
    if is_gzip:
        try:
            within_limit = _gzip_within_limit(contents)
        except (OSError, EOFError) as exc:
            raise HTTPException(status_code=400, detail="Invalid gzip-compressed CEL file.") from exc
        if not within_limit:
            raise HTTPException(status_code=413, detail="The decompressed CEL file exceeds the configured size limit.")
    with tempfile.NamedTemporaryFile(suffix=".CEL.gz" if is_gzip else ".CEL", delete=False) as tmp:
        tmp.write(contents)
        return tmp.name


def _service_token() -> str:
    return os.getenv("MICROAI_CEL_SERVICE_TOKEN") or ""


@app.on_event("startup")
def _startup():
    if not _service_token():
        raise RuntimeError("MICROAI_CEL_SERVICE_TOKEN must be set for the CEL preprocessing service.")
    status = check_r_runtime()
    if not status["available"]:
        raise RuntimeError(f"R runtime check failed: {status.get('error')}")


@app.get("/health")
def health():
    return {"status": "ok", "r_runtime": dict(R_RUNTIME_STATUS), "busy": _JOB_SLOT._value == 0}


def _require_token(x_cel_service_token: str) -> None:
    expected = _service_token()
    if not expected or not hmac.compare_digest(x_cel_service_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid service token.")


@app.post("/preprocess")
def preprocess(
    file: UploadFile = File(...),
    x_cel_service_token: str = Header(default=""),
):
    _require_token(x_cel_service_token)

    if not _acquire_job_slot():
        raise HTTPException(status_code=503, detail="CEL preprocessor busy, retry shortly.")
    tmp_path = None
    try:
        contents = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="The uploaded file exceeds the configured size limit.")
        if not contents:
            raise HTTPException(status_code=400, detail="Empty CEL file.")
        # The API forwards .CEL.gz uploads unchanged; affy's ReadAffy(compress = TRUE)
        # reads gzip and plain CEL files alike, with byte-identical MAS5 output.
        is_gzip = contents[:2] == _GZIP_MAGIC
        if is_gzip:
            try:
                within_limit = _gzip_within_limit(contents)
            except (OSError, EOFError) as exc:
                raise HTTPException(status_code=400, detail="Invalid gzip-compressed CEL file.") from exc
            if not within_limit:
                raise HTTPException(status_code=413, detail="The decompressed CEL file exceeds the configured size limit.")
        with tempfile.NamedTemporaryFile(suffix=".CEL.gz" if is_gzip else ".CEL", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
        del contents
        try:
            feature_map, _ordered = run_affy_preprocessing_local(tmp_path)
        except Exception as exc:  # noqa: BLE001
            logger.exception("MAS5 preprocessing failed")
            raise HTTPException(status_code=500, detail=f"CEL preprocessing failed: {exc}") from exc
        return {"feature_ids": list(feature_map.keys()), "values": list(feature_map.values())}
    finally:
        _JOB_SLOT.release()
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


STREAM_HEARTBEAT_SECONDS = 1.0
_STAGE_QUEUED = "queued"
_STAGE_STARTED = "preprocessing_started"


def _run_stream_job(tmp_path: str, admission: str, emit, cancel: threading.Event) -> None:
    """Worker thread for one /preprocess/stream request: wait for the slot, run R, report."""
    global _queued
    acquired = admission == "running"
    try:
        if not acquired:
            emit({"type": "stage", "stage": _STAGE_QUEUED})
            deadline = time.monotonic() + QUEUE_WAIT_SECONDS
            try:
                while not cancel.is_set():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    if _JOB_SLOT.acquire(timeout=min(0.25, remaining)):
                        acquired = True
                        break
            finally:
                with _QUEUE_LOCK:
                    _queued -= 1
            if cancel.is_set():
                return
            if not acquired:
                emit({"type": "error", "status": 503, "detail": "CEL preprocessor busy, retry shortly."})
                return
        if cancel.is_set():
            return
        emit({"type": "stage", "stage": _STAGE_STARTED})
        feature_map, _ordered = run_affy_preprocessing_streaming(
            tmp_path,
            on_stage=lambda stage: emit({"type": "stage", "stage": stage}),
            cancel=cancel,
        )
        emit({"type": "result", "feature_ids": list(feature_map.keys()), "values": list(feature_map.values())})
    except PreprocessingCancelled:
        logger.info("MAS5 preprocessing cancelled by the caller")
    except Exception as exc:  # noqa: BLE001
        logger.exception("MAS5 preprocessing failed")
        emit({"type": "error", "status": 500, "detail": f"CEL preprocessing failed: {exc}"})
    finally:
        if acquired:
            _JOB_SLOT.release()
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/preprocess/stream")
async def preprocess_stream(
    file: UploadFile = File(...),
    x_cel_service_token: str = Header(default=""),
):
    _require_token(x_cel_service_token)
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The uploaded file exceeds the configured size limit.")
    tmp_path = await run_in_threadpool(_store_upload, contents)
    del contents
    admission = _reserve_job_slot()
    if admission is None:
        Path(tmp_path).unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail="CEL preprocessor busy, retry shortly.")

    loop = asyncio.get_running_loop()
    events: asyncio.Queue = asyncio.Queue()
    cancel = threading.Event()

    def emit(event) -> None:
        loop.call_soon_threadsafe(events.put_nowait, event)

    threading.Thread(
        target=_run_stream_job, args=(tmp_path, admission, emit, cancel), name="mas5-stream-job", daemon=True
    ).start()

    async def body():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(events.get(), STREAM_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield b'{"type":"heartbeat"}\n'
                    continue
                yield (json.dumps(event) + "\n").encode()
                if event["type"] in {"result", "error"}:
                    return
        finally:
            # Caller finished or disconnected: a still-running job leaves the queue or
            # has its R process stopped; temp file and slot are released by the worker.
            cancel.set()

    return StreamingResponse(
        body(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
