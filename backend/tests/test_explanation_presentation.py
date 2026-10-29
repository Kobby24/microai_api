import pytest

import main


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (-2.1, "much lower than typical"),
        (-2.0, "much lower than typical"),
        (-1.5, "lower than typical"),
        (-1.0, "lower than typical"),
        (-0.5, "about typical"),
        (0.999, "about typical"),
        (1.0, "higher than typical"),
        (1.9, "higher than typical"),
        (2.0, "much higher than typical"),
    ],
)
def test_expression_level_boundaries(value, expected):
    assert main._expression_level(value) == expected


def test_gene_symbol_loader_keeps_only_exact_unambiguous_symbols(tmp_path):
    annotation = tmp_path / "GPL96_annotation.csv"
    annotation.write_text(
        "ID,Gene Symbol\n"
        "probe-a,TP53\n"
        "probe-b,BRCA1 /// BRCA1-AS1\n"
        "probe-c,---\n"
        "probe-d,AKT1\n"
        "probe-d,AKT2\n",
        encoding="utf-8",
    )

    assert main._load_gene_symbols(annotation) == {"probe-a": "TP53"}


def test_gene_metadata_loader_keeps_verified_full_names_and_rejects_ambiguous_matches(tmp_path):
    annotation = tmp_path / "GPL96_annotation.csv"
    annotation.write_text(
        "ID,Gene Symbol,Gene Title\n"
        "probe-a,TP53,tumor protein p53\n"
        "probe-b,BRCA1 /// BRCA1-AS1,breast cancer 1 /// BRCA1 antisense RNA\n"
        "probe-c,---,NA\n"
        "probe-d,AKT1,AKT serine/threonine kinase 1\n"
        "probe-d,AKT2,AKT serine/threonine kinase 2\n",
        encoding="utf-8",
    )

    metadata = main._load_gene_metadata(annotation)

    assert metadata["probe-a"]["gene_symbol"] == "TP53"
    assert metadata["probe-a"]["gene_name"] == "tumor protein p53"
    assert metadata["probe-a"]["gene_name_verified"] is True
    assert metadata["probe-b"]["gene_name_verified"] is False
    assert "probe-c" not in metadata
    assert "probe-d" not in metadata


def test_driver_enrichment_adds_gene_name_metadata_and_contribution_direction(monkeypatch):
    monkeypatch.setattr(main, "GENE_METADATA", {
        "probe-0": {
            "gene_symbol": "TP53",
            "gene_name": "tumor protein p53",
            "gene_name_source": "GPL96 platform annotation",
            "gene_name_verified": True,
        },
        "probe-1": {
            "gene_symbol": "ESR1",
            "gene_name": None,
            "gene_name_source": None,
            "gene_name_verified": False,
        },
    })
    features = [
        {
            "feature_id": "probe-0",
            "raw_input_value": 1.2,
            "model_input_value": 0.5,
            "shap_value": 0.25,
        },
        {
            "feature_id": "probe-1",
            "raw_input_value": 0.4,
            "model_input_value": -0.8,
            "shap_value": -0.18,
        },
    ]

    enriched, drivers, summary = main._enrich_explanation_features(features, "ER-positive")

    assert enriched[0]["gene_name"] == "tumor protein p53"
    assert enriched[0]["gene_name_verified"] is True
    assert enriched[0]["contribution_direction"] == "toward_explained_class"
    assert enriched[1]["gene_name"] is None
    assert enriched[1]["gene_name_verified"] is False
    assert drivers[0]["contribution"] == pytest.approx(0.25)
    assert "tumor protein p53" in summary
