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
    """Parse a CSV (comma) or TSV (tab) upload with no assumed header."""
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


def _labels(values) -> list:
    return ["" if pd.isna(v) else str(v).strip() for v in list(values)]


def _mostly_non_numeric(values, threshold: float = 0.5) -> bool:
    converted = pd.to_numeric(pd.Series(list(values)), errors="coerce")
    if converted.empty:
        return True
    return float(converted.isna().mean()) >= threshold


def _aligned_ids(labels, count: int):
    if not labels or len(labels) != count:
        return None
    return labels


def gene_count_error(model_name: str, expected: int, n_rows: int, n_cols: int) -> str:
    return (
        f"Expected {expected} genes for {model_name}, but the file has "
        f"{n_rows} rows × {n_cols} expression columns. "
        "A single-patient file is one column of gene values (one row per gene). "
        "A multi-patient file is one row per patient and one column per gene, "
        "with an optional sample-ID column."
    )


def prepare_expression_matrix(df: pd.DataFrame, expected_genes, model_name: str):
    """Return (X, sample_ids) using the single-patient or multi-patient layout."""
    work = df.copy()
    col_labels = None
    row_labels = None

    if len(work) > 1 and _mostly_non_numeric(work.iloc[0]):
        col_labels = _labels(work.iloc[0])
        work = work.iloc[1:].reset_index(drop=True)

    if work.shape[1] > 1 and len(work) > 0 and _mostly_non_numeric(work.iloc[:, 0]):
        row_labels = _labels(work.iloc[:, 0])
        work = work.iloc[:, 1:]
        if col_labels is not None:
            col_labels = col_labels[1:]

    numeric = work.apply(pd.to_numeric, errors="coerce")
    n_rows, n_cols = numeric.shape
    expected = int(expected_genes) if expected_genes else None

    if expected:
        # Single patient: original layout — genes as rows, one value column, then transpose.
        if n_cols == 1 and n_rows == expected:
            X = numeric.to_numpy().T
            return X, _aligned_ids(col_labels, 1)

        # Single patient written as one row of gene values.
        if n_rows == 1 and n_cols == expected:
            X = numeric.to_numpy()
            return X, _aligned_ids(row_labels, 1)

        # Multiple patients: one row per patient, one column per gene.
        if n_rows > 1 and n_cols == expected:
            X = numeric.to_numpy()
            return X, _aligned_ids(row_labels, n_rows)

        if n_rows > 1 and n_cols == expected + 1:
            sample_ids = _labels(numeric.iloc[:, 0])
            X = numeric.iloc[:, 1:].to_numpy()
            return X, sample_ids

        if n_rows == expected and n_cols > 1:
            raise ValueError(
                f"This file has {n_cols} sample columns and {n_rows} gene rows. "
                "That original layout is only used for a single patient "
                "(one column of gene values). "
                "For multiple patients, use one row per patient and one column per gene, "
                "with an optional sample-ID column."
            )

        raise ValueError(gene_count_error(model_name, expected, n_rows, n_cols))

    if n_cols == 1:
        X = numeric.to_numpy().T
        return X, _aligned_ids(col_labels, 1)

    X = numeric.to_numpy()
    return X, _aligned_ids(row_labels, X.shape[0])


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
