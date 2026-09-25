import pandas as pd
import pytest

from tabular import (
    is_supported_table_filename,
    prepare_expression_matrix,
    read_expression_table,
    table_kind,
    table_separator,
)


def test_accepts_csv_and_tsv_extensions_case_insensitively():
    assert is_supported_table_filename("patients.csv")
    assert is_supported_table_filename("patients.TSV")
    assert is_supported_table_filename("patients.tsv")
    assert not is_supported_table_filename("patients.txt")
    assert not is_supported_table_filename("patients.json")
    assert not is_supported_table_filename("")


def test_tsv_uses_tab_delimiter_and_csv_keeps_comma():
    assert table_separator("batch.tsv") == "\t"
    assert table_separator("batch.TSV") == "\t"
    assert table_separator("batch.csv") == ","
    assert table_kind("batch.tsv") == "TSV"
    assert table_kind("batch.csv") == "CSV"


def test_reads_tsv_without_header_same_shape_as_csv():
    csv_bytes = b"1.0,2.0\n3.0,4.0\n5.0,6.0\n"
    tsv_bytes = b"1.0\t2.0\n3.0\t4.0\n5.0\t6.0\n"

    csv_df = read_expression_table(csv_bytes, "samples.csv")
    tsv_df = read_expression_table(tsv_bytes, "samples.tsv")

    assert csv_df.shape == (3, 2)
    assert tsv_df.shape == (3, 2)
    pd.testing.assert_frame_equal(csv_df, tsv_df)


def test_empty_tsv_raises_user_friendly_error():
    with pytest.raises(ValueError, match="The TSV file is empty"):
        read_expression_table(b"", "empty.tsv")


def test_malformed_tsv_raises_user_friendly_error():
    malformed = b"1.0\t2.0\n3.0\t4.0\t5.0\n"
    with pytest.raises(ValueError, match="could not be parsed"):
        read_expression_table(malformed, "broken.tsv")


def test_prepare_keeps_four_patient_rows_from_being_read_as_four_genes():
    df = pd.DataFrame([
        ["sample_id", "g1", "g2", "g3"],
        ["P001", 1.5, 2.0, 3.0],
        ["P002", -0.5, 1.0, 4.0],
        ["P003", 2.0, 1.0, 1.0],
        ["P004", -1.0, 0.5, 0.2],
    ])
    X, sample_ids = prepare_expression_matrix(df, expected_genes=3, model_name="gse7390")

    assert X.shape == (4, 3)
    assert sample_ids == ["P001", "P002", "P003", "P004"]


def test_prepare_single_patient_uses_original_gene_column():
    df = pd.DataFrame([[1.5], [2.0], [3.0]])
    X, sample_ids = prepare_expression_matrix(df, expected_genes=3, model_name="gse7390")

    assert X.shape == (1, 3)
    assert sample_ids is None
    assert list(X[0]) == [1.5, 2.0, 3.0]


def test_prepare_rejects_multi_patient_gene_columns():
    df = pd.DataFrame([
        [1.5, -0.5],
        [2.0, 1.0],
        [3.0, 4.0],
    ])
    with pytest.raises(ValueError, match="one row per patient"):
        prepare_expression_matrix(df, expected_genes=3, model_name="gse7390")
