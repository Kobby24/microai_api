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


def test_driver_enrichment_sorts_and_normalizes_only_top_eight(monkeypatch):
    monkeypatch.setattr(main, "GENE_SYMBOLS", {"probe-0": "TP53"})
    features = [
        {
            "feature_id": f"probe-{index}",
            "raw_input_value": float(index),
            "model_input_value": 0.0,
            "shap_value": float(index + 1),
        }
        for index in range(9)
    ]

    enriched, drivers, _summary = main._enrich_explanation_features(features, "Class 1")

    assert [feature["feature_id"] for feature in drivers] == [
        "probe-8", "probe-7", "probe-6", "probe-5",
        "probe-4", "probe-3", "probe-2", "probe-1",
    ]
    assert sum(feature["relative_influence_percent"] for feature in drivers) == pytest.approx(100)
    assert enriched[-1]["relative_influence_percent"] is None
    assert enriched[-1]["expression_level"] == "about typical"
    assert drivers[-1]["gene_symbol"] is None
