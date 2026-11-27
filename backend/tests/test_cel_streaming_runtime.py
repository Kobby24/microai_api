"""Live-stage R runner (r_runtime.run_affy_preprocessing_streaming) with a fake Rscript.

The fake prints the same kinds of lines affy_mas5.R and affy print (stage markers and
affy's "N ids to be processed") with controllable timing, so ordering, cancellation,
timeouts and large outputs are tested without R.
"""
import json
import stat
import sys
import threading
import time
from pathlib import Path

import pytest

import r_runtime
from r_runtime import PreprocessingCancelled, r_stage_from_line, run_affy_preprocessing_streaming

FAKE_RSCRIPT = '''#!{python}
import json, os, sys, time
mode = os.environ.get("FAKE_R_MODE", "ok")
def err(text):
    sys.stderr.write(text + "\\n"); sys.stderr.flush()
err("Loading required package: BiocGenerics")
err("MICROAI_STAGE loading_affy")
err("MICROAI_STAGE reading_cel")
err("MICROAI_STAGE mas5")
err("background correction: mas ")
if mode == "hang_in_mas5":
    time.sleep(60)
time.sleep(float(os.environ.get("FAKE_R_MAS5_SECONDS", "0")))
err("background correcting...done.")
err("22283 ids to be processed")
err("|####################|")
if mode == "fail":
    err("Error in ReadAffy(filenames = cel_path): the file is not a CEL file")
    err("Execution halted")
    sys.exit(1)
err("MICROAI_STAGE extracting")
err("MICROAI_STAGE exporting")
n = int(os.environ.get("FAKE_R_FEATURES", "3"))
ids = ["p%d" % i for i in range(n)]
sys.stdout.write(json.dumps({{"feature_ids": ids, "values": [float(i) / 7 for i in range(n)]}}))
'''


@pytest.fixture
def fake_rscript(tmp_path, monkeypatch):
    script = tmp_path / "Rscript"
    script.write_text(FAKE_RSCRIPT.format(python=sys.executable))
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("RSCRIPT_PATH", str(script))
    cel = tmp_path / "sample.CEL.gz"
    cel.write_bytes(b"not used by the fake")
    return cel


def _recording():
    seen = []
    return seen, lambda stage: seen.append((stage, time.monotonic()))


def test_stage_lines_map_only_real_markers_and_affy_summarization():
    assert r_stage_from_line("MICROAI_STAGE mas5\n") == "mas5_background"
    assert r_stage_from_line("22283 ids to be processed\n") == "mas5_summaries"
    assert r_stage_from_line("MICROAI_STAGE exporting") == "exporting"
    assert r_stage_from_line("MICROAI_STAGE something_new") is None
    assert r_stage_from_line("background correcting...done.") is None
    assert r_stage_from_line("Error: 22283 ids to be processed in total failed") is None


def test_reports_r_stages_in_order_and_returns_expression(fake_rscript, monkeypatch):
    monkeypatch.setenv("FAKE_R_MODE", "ok")
    seen, on_stage = _recording()

    feature_map, values = run_affy_preprocessing_streaming(str(fake_rscript), on_stage=on_stage)

    assert [stage for stage, _ in seen] == [
        "loading_affy",
        "reading_cel",
        "mas5_background",
        "mas5_summaries",
        "extracting",
        "exporting",
    ]
    assert feature_map == {"p0": 0.0, "p1": 1 / 7, "p2": 2 / 7}
    assert values == [0.0, 1 / 7, 2 / 7]


def test_mas5_stage_stays_active_until_r_reports_the_next_step(fake_rscript, monkeypatch):
    monkeypatch.setenv("FAKE_R_MAS5_SECONDS", "0.8")
    seen, on_stage = _recording()

    run_affy_preprocessing_streaming(str(fake_rscript), on_stage=on_stage)

    times = dict(seen)
    assert times["mas5_summaries"] - times["mas5_background"] >= 0.7


def test_large_stdout_does_not_deadlock(fake_rscript, monkeypatch):
    # ~600 KB of JSON (like 22,283 probe sets) must not block on a full pipe.
    monkeypatch.setenv("FAKE_R_FEATURES", "40000")
    started = time.monotonic()
    feature_map, values = run_affy_preprocessing_streaming(str(fake_rscript))
    assert len(values) == 40000 and len(feature_map) == 40000
    assert time.monotonic() - started < 20


def test_cancel_kills_r_promptly(fake_rscript, monkeypatch):
    monkeypatch.setenv("FAKE_R_MODE", "hang_in_mas5")
    cancel = threading.Event()

    def on_stage(stage):
        if stage == "mas5_background":
            cancel.set()

    started = time.monotonic()
    with pytest.raises(PreprocessingCancelled):
        run_affy_preprocessing_streaming(str(fake_rscript), on_stage=on_stage, cancel=cancel)
    assert time.monotonic() - started < 5


def test_time_limit_still_applies(fake_rscript, monkeypatch):
    monkeypatch.setenv("FAKE_R_MODE", "hang_in_mas5")
    monkeypatch.setattr(r_runtime, "RSCRIPT_TIMEOUT_SECONDS", 1)
    with pytest.raises(RuntimeError, match="exceeded the 1s time limit"):
        run_affy_preprocessing_streaming(str(fake_rscript))


def test_r_failure_reports_r_error_without_stage_markers(fake_rscript, monkeypatch):
    monkeypatch.setenv("FAKE_R_MODE", "fail")
    with pytest.raises(RuntimeError) as raised:
        run_affy_preprocessing_streaming(str(fake_rscript))
    message = str(raised.value)
    assert "not a CEL file" in message
    assert "MICROAI_STAGE" not in message
    assert not isinstance(raised.value, PreprocessingCancelled)
