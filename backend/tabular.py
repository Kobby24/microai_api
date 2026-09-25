import io

import pandas as pd

SUPPORTED_TABLE_EXTENSIONS = (".csv", ".tsv")


def table_extension(filename: str) -> str:
    name = (filename or "").lower()
    for ext in SUPPORTED_TABLE_EXTENSIONS:
        if name.endswith(ext):
            return ext
    return ""


def is_supported_table_filename(filename: str) -> bool:
    return bool(table_extension(filename))


def table_kind(filename: str) -> str:
    return "TSV" if table_extension(filename) == ".tsv" else "CSV"


def table_separator(filename: str) -> str:
    return "\t" if table_extension(filename) == ".tsv" else ","


def read_expression_table(contents: bytes, filename: str) -> pd.DataFrame:
    """Parse a CSV (comma) or TSV (tab) upload the same way: no header, later transposed."""
    kind = table_kind(filename)
    if contents is None or not contents.strip():
        raise ValueError(f"The {kind} file is empty.")

    try:
        df = pd.read_csv(io.BytesIO(contents), header=None, sep=table_separator(filename))
    except Exception as exc:
        raise ValueError(_friendly_read_error(kind, exc)) from exc

    if df.empty:
        raise ValueError(f"The {kind} file is empty.")
    return df


def _friendly_read_error(kind: str, exc: Exception) -> str:
    name = type(exc).__name__
    message = str(exc).strip() or name
    if name in {"EmptyDataError", "ParserError"} or "Error tokenizing data" in message:
        delimiter = "tab" if kind == "TSV" else "comma"
        return (
            f"The {kind} file could not be parsed. "
            f"Check that it is {delimiter}-separated and every row has the same number of values."
        )
    return f"Error reading {kind}: {message}"
