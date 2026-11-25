"""Standalone Affymetrix CEL preprocessing service (R/affy MAS5).

Runs as its own Render service so the R/Bioconductor memory peak does not share
a 512 MB container with the Python ML API. Deliberately imports no numpy/pandas/sklearn.

    POST /preprocess   multipart "file" = .CEL or .CEL.gz
                       header X-CEL-Service-Token = $MICROAI_CEL_SERVICE_TOKEN
                       -> {"feature_ids": [...], "values": [...]}
    GET  /health
"""
import gzip
import hmac
import io
import logging
import os
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

from r_runtime import R_RUNTIME_STATUS, check_r_runtime, positive_limit, run_affy_preprocessing_local

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


@app.post("/preprocess")
def preprocess(
    file: UploadFile = File(...),
    x_cel_service_token: str = Header(default=""),
):
    expected = _service_token()
    if not expected or not hmac.compare_digest(x_cel_service_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid service token.")

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
