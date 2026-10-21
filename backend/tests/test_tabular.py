import pandas as pd
import pytest

from tabular import (
    is_supported_table_filename,
    prepare_expression_matrix,
    read_expression_table,
    table_kind,
    table_separator,
)

FEATURE_IDS = ["g1", "g2", "g3"]


def prepare(df):
    return prepare_expression_matrix(
        df,
        expected_genes=3,
        model_name="gse7390",
        expected_feature_ids=FEATURE_IDS,
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


def test_reads_csv_and_tsv_with_feature_headers():
    csv_df = read_expression_table(b"g1,g2,g3\n1.0,2.0,3.0\n", "samples.csv")
    tsv_df = read_expression_table(b"g1\tg2\tg3\n1.0\t2.0\t3.0\n", "samples.tsv")

    pd.testing.assert_frame_equal(csv_df, tsv_df)
    assert prepare(csv_df)[0].tolist() == [[1.0, 2.0, 3.0]]


def test_empty_tsv_raises_user_friendly_error():
    with pytest.raises(ValueError, match="The TSV file is empty"):
        read_expression_table(b"", "empty.tsv")


def test_malformed_tsv_raises_user_friendly_error():
    malformed = b"g1\tg2\tg3\n1.0\t2.0\t3.0\t4.0\n"
    with pytest.raises(ValueError, match="could not be parsed"):
        read_expression_table(malformed, "broken.tsv")


def test_sample_rows_align_reordered_feature_headers_and_keep_ids():
    df = pd.DataFrame([
        ["sample_id", "g3", "g1", "g2"],
        ["P001", 3.0, 1.5, 2.0],
        ["P002", 4.0, -0.5, 1.0],
    ])
    X, sample_ids = prepare(df)

    assert X.tolist() == [[1.5, 2.0, 3.0], [-0.5, 1.0, 4.0]]
    assert sample_ids == ["P001", "P002"]


def test_gene_rows_align_reordered_ids_for_one_or_more_samples():
    df = pd.DataFrame([
        ["g3", 3.0, 4.0],
        ["g1", 1.5, -0.5],
        ["g2", 2.0, 1.0],
    ])
    X, sample_ids = prepare(df)

    assert X.tolist() == [[1.5, 2.0, 3.0], [-0.5, 1.0, 4.0]]
    assert sample_ids is None


def test_id_ref_header_is_accepted_for_gene_rows():
    df = pd.DataFrame([
        ["ID_REF", "sample1"],
        ["g1", 1.5],
        ["g2", 2.0],
        ["g3", 3.0],
    ])
    X, sample_ids = prepare(df)

    assert X.tolist() == [[1.5, 2.0, 3.0]]
    assert sample_ids is None


@pytest.mark.parametrize(
    "identifiers",
    [
        ["unknown", "g2", "g3"],
        ["", "g2", "g3"],
        ["g1", "g1", "g3"],
    ],
)
def test_gene_rows_reject_unknown_missing_or_duplicate_ids(identifiers):
    df = pd.DataFrame([[feature_id, index + 1] for index, feature_id in enumerate(identifiers)])
    with pytest.raises(ValueError, match="Feature identifiers do not match"):
        prepare(df)


@pytest.mark.parametrize("bad_value", [None, "not-a-number", float("nan"), float("inf")])
def test_rejects_missing_non_numeric_and_infinite_values(bad_value):
    df = pd.DataFrame([["g1", 1.0, 2.0], ["g2", bad_value, 3.0], ["g3", 4.0, 5.0]])
    with pytest.raises(ValueError, match="must be numeric and finite"):
        prepare(df)


def test_rejects_positional_data_without_feature_identifiers():
    df = pd.DataFrame([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    with pytest.raises(ValueError, match="no unambiguous matching feature"):
        prepare(df)


def test_rejects_missing_model_feature_schema():
    with pytest.raises(ValueError, match="schema is unavailable"):
        prepare_expression_matrix(pd.DataFrame([[1, 2, 3]]), 3, "gse7390")
