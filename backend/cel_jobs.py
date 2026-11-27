"""In-memory CEL analysis jobs with live, replayable processing-stage events.

The API runs as one uvicorn process per instance, so a process-local store is enough:
no broker or external queue. Each job has an unguessable id, an append-only event log
(sequence numbers start at 1) and at most one result. The event log lets a client that
lost its connection reconnect with Last-Event-ID and resume without re-running the job.

Lifecycle: running -> exactly one terminal event ("result_ready", "error" or "cancelled").
A running job nobody is listening to (the tab was closed) is cancelled after
ORPHAN_SECONDS; finished jobs are purged RETENTION_SECONDS after they end.
"""
import asyncio
import json
import os
import secrets
import threading
import time
from typing import Dict, List, Optional


def _positive_number(name: str, default: float) -> float:
    raw = os.getenv(name)
    try:
        value = float(raw) if raw is not None else float(default)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive number") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive number")
    return value


MAX_ACTIVE_JOBS = int(_positive_number("MICROAI_MAX_CEL_JOBS", 8))
ORPHAN_SECONDS = _positive_number("MICROAI_CEL_JOB_ORPHAN_SECONDS", 60)
RETENTION_SECONDS = _positive_number("MICROAI_CEL_JOB_RETENTION_SECONDS", 300)
HEARTBEAT_SECONDS = 15.0
REAPER_INTERVAL_SECONDS = 5.0
TERMINAL_TYPES = frozenset({"result_ready", "error", "cancelled"})


class CelJobCapacityError(RuntimeError):
    pass


class CelJob:
    def __init__(self, model_name: str):
        self.id = secrets.token_urlsafe(24)
        self.model_name = model_name
        self.cancel_event = threading.Event()
        self.result: Optional[dict] = None
        self.error: Optional[dict] = None
        self._events: List[dict] = []
        self._lock = threading.Lock()
        self._waiters: List[tuple] = []
        self._subscribers = 0
        self._last_detached = time.monotonic()
        self._finished_at: Optional[float] = None

    # -- producer side (worker thread) ---------------------------------------------
    def _append(self, event: dict) -> bool:
        with self._lock:
            if self._finished_at is not None:
                return False  # exactly one terminal event; later reports are dropped
            event = {"seq": len(self._events) + 1, **event}
            self._events.append(event)
            if event["type"] in TERMINAL_TYPES:
                self._finished_at = time.monotonic()
            waiters = list(self._waiters)
        for loop, wake in waiters:
            try:
                loop.call_soon_threadsafe(wake.set)
            except RuntimeError:  # loop already closed (client gone)
                pass
        return True

    def stage(self, stage: str) -> None:
        if not self.cancel_event.is_set():
            self._append({"type": "stage", "stage": stage})

    def complete(self, result: dict) -> None:
        with self._lock:
            if self._finished_at is not None:
                return
            self.result = result
        self._append({"type": "result_ready"})

    def fail(self, status: int, detail: str) -> None:
        with self._lock:
            if self._finished_at is not None:
                return
            self.error = {"status": int(status), "detail": str(detail)}
        self._append({"type": "error", "status": int(status), "detail": str(detail)})

    def cancel(self) -> None:
        self.cancel_event.set()
        with self._lock:
            if self._finished_at is not None:
                return
            self.error = {"status": 409, "detail": "The analysis was cancelled."}
        self._append({"type": "cancelled"})

    # -- consumer side ---------------------------------------------------------------
    @property
    def finished(self) -> bool:
        with self._lock:
            return self._finished_at is not None

    def events_after(self, seq: int) -> List[dict]:
        with self._lock:
            return [dict(event) for event in self._events[max(0, seq):]]

    def _attach(self, loop, wake) -> None:
        with self._lock:
            self._waiters.append((loop, wake))
            self._subscribers += 1

    def _detach(self, loop, wake) -> None:
        with self._lock:
            if (loop, wake) in self._waiters:
                self._waiters.remove((loop, wake))
            self._subscribers -= 1
            self._last_detached = time.monotonic()

    def orphaned(self, now: float) -> bool:
        with self._lock:
            return (
                self._finished_at is None
                and self._subscribers == 0
                and now - self._last_detached > ORPHAN_SECONDS
            )

    def expired(self, now: float) -> bool:
        with self._lock:
            return self._finished_at is not None and now - self._finished_at > RETENTION_SECONDS

    async def sse(self, after: int = 0):
        """Server-sent events: replay events after ``after``, then stream until terminal."""
        loop = asyncio.get_running_loop()
        wake = asyncio.Event()
        self._attach(loop, wake)
        sent = max(0, after)
        try:
            yield b"retry: 2000\n\n"
            while True:
                wake.clear()
                pending = self.events_after(sent)
                for event in pending:
                    sent = event["seq"]
                    yield f"id: {sent}\ndata: {json.dumps(event)}\n\n".encode()
                    if event["type"] in TERMINAL_TYPES:
                        return
                if not pending:
                    if self.finished:
                        return  # reconnected after the terminal event was already delivered
                    try:
                        await asyncio.wait_for(wake.wait(), HEARTBEAT_SECONDS)
                    except asyncio.TimeoutError:
                        yield b": keep-alive\n\n"
        finally:
            self._detach(loop, wake)


class CelJobStore:
    def __init__(self):
        self._jobs: Dict[str, CelJob] = {}
        self._lock = threading.Lock()
        self._reaper: Optional[threading.Thread] = None

    def create(self, model_name: str) -> CelJob:
        with self._lock:
            active = sum(1 for job in self._jobs.values() if not job.finished)
            if active >= MAX_ACTIVE_JOBS:
                raise CelJobCapacityError("Too many CEL analyses are running.")
            job = CelJob(model_name)
            self._jobs[job.id] = job
            if self._reaper is None or not self._reaper.is_alive():
                self._reaper = threading.Thread(target=self._reap_forever, name="cel-job-reaper", daemon=True)
                self._reaper.start()
        return job

    def get(self, job_id: str) -> Optional[CelJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def reap(self, now: Optional[float] = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            jobs = list(self._jobs.items())
        for job_id, job in jobs:
            if job.orphaned(now):
                job.cancel()
            elif job.expired(now):
                with self._lock:
                    self._jobs.pop(job_id, None)

    def _reap_forever(self) -> None:
        while True:
            time.sleep(REAPER_INTERVAL_SECONDS)
            self.reap()


CEL_JOBS = CelJobStore()
