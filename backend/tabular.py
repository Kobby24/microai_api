import io

import numpy as np
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


def _validate_feature_ids(values, expected_feature_ids):
    identifiers = _labels(values)
    expected = list(expected_feature_ids)
    if (
        not identifiers
        or any(not value for value in identifiers)
        or len(set(identifiers)) != len(identifiers)
        or len(identifiers) != len(expected)
        or set(identifiers) != set(expected)
    ):
        raise ValueError("Feature identifiers do not match this model's required gene/probe set.")
    positions = {identifier: index for index, identifier in enumerate(identifiers)}
    return [positions[identifier] for identifier in expected]


def _numeric_values(values):
    numeric = values.apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    if not np.isfinite(numeric).all():
        raise ValueError(
            "Expression values must be numeric and finite; missing, NaN, and infinite values are not supported."
        )
    return numeric


def gene_count_error(model_name: str, expected: int, n_rows: int, n_cols: int) -> str:
    return (
        f"Expected {expected} genes for {model_name}, but the file has "
        f"{n_rows} rows × {n_cols} expression columns. "
        "A single-patient file is one column of gene values (one row per gene). "
        "A multi-patient file is one row per patient and one column per gene, "
        "with an optional sample-ID column."
    )


def prepare_expression_matrix(
    df: pd.DataFrame,
    expected_genes,
    model_name: str,
    expected_feature_ids=None,
):
    """Parse identifier-labelled sample rows or gene rows and align to model order."""
    if not expected_feature_ids:
        raise ValueError("A verified ordered gene/probe schema is unavailable for this model.")

    expected = list(expected_feature_ids)
    if len(set(expected)) != len(expected) or any(not item for item in expected):
        raise ValueError("The model's gene/probe schema is invalid.")
    expected_count = int(expected_genes) if expected_genes is not None else len(expected)
    if expected_count != len(expected):
        raise ValueError("The model's gene/probe schema is invalid.")
    if df.empty:
        raise ValueError("The expression table is empty.")

    work = df.copy()
    header = _labels(work.iloc[0])

    # Sample rows require a header containing every feature identifier.
    sample_id_column = None
    header_feature_ids = header
    if len(header) == len(expected) + 1 and header[0] not in expected:
        sample_id_column = 0
        header_feature_ids = header[1:]
    if len(header_feature_ids) == len(expected) and set(header_feature_ids) == set(expected):
        order = _validate_feature_ids(header_feature_ids, expected)
        values = work.iloc[1:, 1:] if sample_id_column is not None else work.iloc[1:, :]
        sample_ids = _labels(work.iloc[1:, sample_id_column]) if sample_id_column is not None else None
        if values.empty:
            raise ValueError("The expression table contains no samples.")
        X = _numeric_values(values.iloc[:, order])
        return X, sample_ids

    # Gene rows require identifiers in the first column; the remaining columns are samples.
    gene_rows = work
    if header and header[0].lower() in {
        "gene", "gene_id", "geneid", "probe", "probe_id", "probeid",
        "feature", "feature_id", "featureid", "id_ref",
    }:
        gene_rows = work.iloc[1:, :]
    if gene_rows.shape[1] >= 2 and len(gene_rows) == len(expected):
        row_ids = _labels(gene_rows.iloc[:, 0])
        order = _validate_feature_ids(row_ids, expected)
        sample_values = gene_rows.iloc[:, 1:]
        X = _numeric_values(sample_values.iloc[order, :]).T
        return X, None

    n_rows, n_cols = work.shape
    raise ValueError(
        f"Expected {expected_count} identified genes for {model_name}. "
        f"The table has {n_rows} rows and {n_cols} columns but no unambiguous matching feature header or gene-ID column."
    )


def _friendly_read_error(kind: str, exc: Exception) -> str:
    name = type(exc).__name__
    if name in {"EmptyDataError", "ParserError"} or "Error tokenizing data" in str(exc):
        delimiter = "tab" if kind == "TSV" else "comma"
        return (
            f"The {kind} file could not be parsed. "
            f"Check that it is {delimiter}-separated and every row has the same number of values."
        )
    return f"The {kind} file could not be parsed."
