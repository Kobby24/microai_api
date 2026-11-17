"""R / Bioconductor (affy MAS5) runtime helpers for Affymetrix CEL preprocessing.

Standard library only, so the lightweight CEL preprocessing service
(cel_service.py) can import it without pulling in numpy/pandas/sklearn.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple


def positive_limit(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


AFFY_SCRIPT_PATH = Path(__file__).resolve().parent / "affy_mas5.R"
# R packages the MAS5 script needs at runtime. hgu133acdf is the CDF environment
# for GPL96 (HG-U133A) arrays; without it ReadAffy/mas5 cannot map probes to probe sets.
REQUIRED_R_PACKAGES = ("affy", "hgu133acdf")
RSCRIPT_TIMEOUT_SECONDS = positive_limit("MICROAI_RSCRIPT_TIMEOUT_SECONDS", 300)
R_RUNTIME_STATUS: Dict[str, object] = {"checked": False, "available": False}


def resolve_rscript() -> str:
    """Locate the Rscript executable via RSCRIPT_PATH or PATH, and validate it."""
    configured = os.getenv("RSCRIPT_PATH")
    if configured:
        candidate = configured if os.path.sep in configured else shutil.which(configured)
        if not candidate or not os.path.isfile(candidate) or not os.access(candidate, os.X_OK):
            raise RuntimeError(f"RSCRIPT_PATH is set to '{configured}', but it is not an executable file.")
        return candidate
    candidate = shutil.which("Rscript")
    if not candidate:
        raise RuntimeError(
            "Rscript is not installed or is not available in PATH. "
            "Install R (see backend/Dockerfile.cel) or set RSCRIPT_PATH."
        )
    return candidate


def check_r_runtime() -> Dict[str, object]:
    """Verify Rscript, the required R packages, and the MAS5 script. Logs details; returns a summary."""
    status: Dict[str, object] = {"checked": True, "available": False}
    try:
        if not AFFY_SCRIPT_PATH.is_file():
            raise RuntimeError(f"MAS5 preprocessing script not found at {AFFY_SCRIPT_PATH}.")
        rscript = resolve_rscript()
        version = subprocess.run(
            [rscript, "--version"], check=True, capture_output=True, text=True, timeout=60
        )
        version_line = (version.stdout or version.stderr).strip().splitlines()[0]
        print(f"[startup] R runtime: {version_line} ({rscript})", flush=True)
        check_expr = (
            "pkgs <- c(%s); "
            "missing <- pkgs[!vapply(pkgs, requireNamespace, logical(1), quietly = TRUE)]; "
            "if (length(missing)) { cat(paste(missing, collapse = ',')); quit(status = 1) }; "
            "cat(paste0(pkgs, ' ', vapply(pkgs, function(p) as.character(packageVersion(p)), ''), collapse = '; '))"
        ) % ", ".join(f'"{pkg}"' for pkg in REQUIRED_R_PACKAGES)
        packages = subprocess.run(
            [rscript, "--vanilla", "-e", check_expr], capture_output=True, text=True, timeout=120
        )
        if packages.returncode != 0:
            raise RuntimeError(
                f"Missing R packages: {packages.stdout.strip() or packages.stderr.strip() or 'unknown'}"
            )
        print(f"[startup] R packages available: {packages.stdout.strip()}", flush=True)
        status["available"] = True
    except Exception as exc:  # noqa: BLE001 - diagnostics must never crash the import path
        print(f"[startup] ERROR: CEL preprocessing is unavailable: {exc}", flush=True)
        status["error"] = str(exc)
    R_RUNTIME_STATUS.clear()
    R_RUNTIME_STATUS.update(status)
    return status


def parse_expression_payload(payload) -> Tuple[Dict[str, float], List[float]]:
    """Validate a {"feature_ids": [...], "values": [...]} payload and return (feature_map, values)."""
    if not isinstance(payload, dict):
        raise RuntimeError("Affymetrix CEL preprocessing did not return feature IDs and values.")
    feature_ids = payload.get("feature_ids")
    values = payload.get("values")
    if not isinstance(feature_ids, list) or not isinstance(values, list):
        raise RuntimeError("Affymetrix CEL preprocessing did not return feature IDs and values.")
    if len(feature_ids) != len(values):
        raise RuntimeError("Affymetrix CEL preprocessing returned mismatched feature IDs and values.")
    try:
        ordered = [float(value) for value in values]
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Affymetrix CEL preprocessing returned non-numeric expression values.") from exc
    normalized = {str(feature_id): value for feature_id, value in zip(feature_ids, ordered)}
    return normalized, ordered


def run_affy_preprocessing_local(cel_path: str) -> Tuple[Dict[str, float], List[float]]:
    """Run affy MAS5 on one CEL file with a local Rscript."""
    script_path = AFFY_SCRIPT_PATH
    if not script_path.is_file():
        raise FileNotFoundError("The Affymetrix MAS5 preprocessing script is unavailable.")
    rscript = resolve_rscript()
    try:
        completed = subprocess.run(
            [rscript, "--vanilla", str(script_path), str(cel_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=RSCRIPT_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Rscript is required to preprocess Affymetrix CEL files.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"Affymetrix CEL preprocessing exceeded the {RSCRIPT_TIMEOUT_SECONDS}s time limit."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.strip() or "Affymetrix CEL preprocessing failed in R.") from exc

    output = completed.stdout.strip()
    if not output:
        raise RuntimeError("Affymetrix CEL preprocessing returned no expression data.")

    try:
        payload = json.loads(output)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Affymetrix CEL preprocessing returned malformed expression data.") from exc

    return parse_expression_payload(payload)
