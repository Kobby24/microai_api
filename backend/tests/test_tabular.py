import pandas as pd
import pytest

from tabular import (
    is_supported_table_filename,
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
