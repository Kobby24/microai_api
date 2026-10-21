import main

SAMPLES = [[1.5, 2.0, 3.0], [-0.5, 1.0, 4.0]]
FEATURE_IDS = ["g1", "g2", "g3"]


def encode_samples_as_rows(samples, ids=None, delimiter=",", feature_ids=None):
    feature_ids = feature_ids or FEATURE_IDS
    headers = ["sample_id", *feature_ids] if ids is not None else feature_ids
    lines = [delimiter.join(headers)]
    for index, sample in enumerate(samples):
        values = [str(value) for value in sample]
        if ids is not None:
            values.insert(0, str(ids[index]))
        lines.append(delimiter.join(values))
    return "\n".join(lines).encode("utf-8")


def encode_gene_rows(samples, delimiter=","):
    lines = []
    for gene_index, feature_id in enumerate(FEATURE_IDS):
        values = [str(sample[gene_index]) for sample in samples]
        lines.append(delimiter.join([feature_id, *values]))
    return "\n".join(lines).encode("utf-8")


def _upload(client, filename, content, content_type, model_name="gse7390"):
    return client.post(
        f"/predict_csv/{model_name}",
        files={"file": (filename, content, content_type)},
    )


def _predict_json(client, expression, feature_ids=None):
    return client.post(
        "/predict/gse7390",
        json={"expression": expression, "feature_ids": feature_ids or FEATURE_IDS},
    )


def test_valid_tsv_upload_returns_predictions(client):
    response = _upload(
        client,
        "cohort.tsv",
        encode_samples_as_rows(SAMPLES, delimiter="\t"),
        "text/tab-separated-values",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "cohort.tsv"
    assert body["samples_processed"] == 2
    assert [row["prediction"] for row in body["results"]] == ["1", "0"]
    assert body["results"][0]["class_probabilities"] == {"0": 0.2, "1": 0.8}
    assert body["results"][1]["class_probabilities"] == {"0": 0.9, "1": 0.1}


def test_model_metadata_reports_only_verified_schema_and_readiness(client):
    response = client.get("/models")

    assert response.status_code == 200
    model = next(item for item in response.json()["models"] if item["name"] == "gse7390")
    assert model["feature_ids"] == FEATURE_IDS
    assert model["ready"] is True
    assert model["readiness_reason"] is None


def test_csv_and_tsv_produce_same_results(client):
    csv_response = _upload(client, "cohort.csv", encode_samples_as_rows(SAMPLES), "text/csv")
    tsv_response = _upload(
        client,
        "cohort.tsv",
        encode_samples_as_rows(SAMPLES, delimiter="\t"),
        "text/tab-separated-values",
    )

    assert csv_response.status_code == tsv_response.status_code == 200
    assert csv_response.json()["results"] == tsv_response.json()["results"]


def test_empty_and_malformed_tsv_return_safe_validation_errors(client):
    empty = _upload(client, "empty.tsv", b"", "text/tab-separated-values")
    malformed = _upload(
        client,
        "broken.tsv",
        b"g1\tg2\tg3\n1.0\t2.0\t3.0\t4.0\n",
        "text/tab-separated-values",
    )

    assert empty.status_code == 400
    assert empty.json()["detail"] == "The TSV file is empty."
    assert malformed.status_code == 400
    assert malformed.json()["detail"] == "The TSV file could not be parsed. Check that it is tab-separated and every row has the same number of values."


def test_rejects_unsupported_extension_and_accepts_uppercase_tsv(client):
    unsupported = _upload(client, "data.txt", b"data", "text/plain")
    uppercase = _upload(
        client,
        "cohort.TSV",
        encode_samples_as_rows(SAMPLES, delimiter="\t"),
        "text/tab-separated-values",
    )

    assert unsupported.status_code == 400
    assert unsupported.json()["detail"] == "Only .csv and .tsv files are supported"
    assert uppercase.status_code == 200


def test_json_requires_and_aligns_feature_ids(client):
    reordered_ids = ["g3", "g1", "g2"]
    reordered_values = [3.0, 1.5, 2.0]
    response = _predict_json(client, reordered_values, reordered_ids)

    assert response.status_code == 200
    assert response.json() == {
        "prediction": "1",
        "probability": 0.8,
        "class_probabilities": {"0": 0.2, "1": 0.8},
    }


def test_json_csv_and_tsv_agree_for_same_ordered_sample(client):
    sample = SAMPLES[0]
    json_body = _predict_json(client, sample).json()
    csv_body = _upload(client, "one.csv", encode_samples_as_rows([sample]), "text/csv").json()
    tsv_body = _upload(
        client,
        "one.tsv",
        encode_samples_as_rows([sample], delimiter="\t"),
        "text/tab-separated-values",
    ).json()

    assert json_body["prediction"] == csv_body["results"][0]["prediction"] == tsv_body["results"][0]["prediction"]
    assert json_body["class_probabilities"] == csv_body["results"][0]["class_probabilities"] == tsv_body["results"][0]["class_probabilities"]


def test_batch_aligns_reordered_headers_and_preserves_sample_ids(client):
    ids = ["P001", "P002"]
    content = b"sample_id,g3,g1,g2\nP001,3.0,1.5,2.0\nP002,4.0,-0.5,1.0"
    response = _upload(client, "patients.csv", content, "text/csv")

    assert response.status_code == 200
    assert [row["sample_id"] for row in response.json()["results"]] == ids
    assert [row["prediction"] for row in response.json()["results"]] == ["1", "0"]


def test_batch_gene_rows_and_sample_columns_remain_supported(client):
    response = _upload(client, "gene-rows.csv", encode_gene_rows(SAMPLES), "text/csv")

    assert response.status_code == 200
    assert [row["prediction"] for row in response.json()["results"]] == ["1", "0"]


def test_batch_rejects_positional_and_incompatible_feature_sets(client):
    positional = _upload(client, "positional.csv", b"1,2,3\n4,5,6", "text/csv")
    incompatible = _upload(
        client,
        "wrong.csv",
        b"g1,g2,other\n1,2,3",
        "text/csv",
    )

    assert positional.status_code == 400
    assert incompatible.status_code == 400


def test_json_rejects_missing_nonfinite_and_wrong_feature_ids(client):
    missing = _predict_json(client, [1.0, None, 3.0])
    nonfinite = _predict_json(client, [1.0, float("nan"), 3.0])
    wrong_ids = _predict_json(client, [1.0, 2.0, 3.0], ["g1", "g2", "other"])

    assert missing.status_code == 422
    assert nonfinite.status_code == 422
    assert wrong_ids.status_code == 400


def test_schema_is_required_before_prediction(client, fake_model):
    fake_model.gene_names = None
    response = _predict_json(client, SAMPLES[0])

    assert response.status_code == 503
    assert "no verified ordered gene/probe schema" in response.json()["detail"]


def test_prediction_is_blocked_when_training_preprocessing_contract_is_unknown(client, fake_model):
    del fake_model.training_info["training_imputation_applied"]
    response = _predict_json(client, SAMPLES[0])

    assert response.status_code == 503
    assert "training missing-value behavior is unknown" in response.json()["detail"]


def test_model_readiness_rejects_unmapped_target_classes(client, fake_model):
    fake_model.classes_ = ["control", "case"]
    fake_model.label_encoder.classes_ = ["control", "case"]
    response = client.get("/models/gse7390")

    assert response.status_code == 200
    assert response.json()["ready"] is False
    assert "not mapped to the catalogued target" in response.json()["readiness_reason"]


def test_explanation_requires_same_ready_model_schema(client, fake_model):
    fake_model.gene_names = None
    response = client.post(
        "/explain/gse7390",
        json={"expression": SAMPLES[0], "feature_ids": FEATURE_IDS},
    )

    assert response.status_code == 503
    assert "no verified ordered gene/probe schema" in response.json()["detail"]


def test_explanation_rejects_unknown_target_class_before_loading_background(client):
    response = client.post(
        "/explain/gse7390",
        json={"expression": SAMPLES[0], "feature_ids": FEATURE_IDS, "target_class": "2"},
    )

    assert response.status_code == 400
    assert "requested explanation class is not supported" in response.json()["detail"]


def test_explanation_reports_missing_reference_dataset(client, monkeypatch, tmp_path):
    monkeypatch.setitem(main.XAI_SERVICE.background_paths, "gse7390", tmp_path / "missing.csv")
    response = client.post(
        "/explain/gse7390",
        json={"expression": SAMPLES[0], "feature_ids": FEATURE_IDS},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "The configured SHAP background dataset is unavailable."


def test_batch_size_and_row_limits(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 10)
    too_large = _upload(client, "large.csv", b"g1,g2,g3\n1,2,3", "text/csv")
    assert too_large.status_code == 413

    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 10 * 1024 * 1024)
    monkeypatch.setattr(main, "MAX_BATCH_ROWS", 1)
    too_many = _upload(client, "many.csv", encode_samples_as_rows(SAMPLES), "text/csv")
    assert too_many.status_code == 413

    monkeypatch.setattr(main, "MAX_BATCH_ROWS", 1000)
    monkeypatch.setattr(main, "MAX_BATCH_CELLS", 5)
    too_many_cells = _upload(client, "many-cells.csv", encode_samples_as_rows(SAMPLES), "text/csv")
    assert too_many_cells.status_code == 413


def test_prediction_failure_is_sanitized(client, fake_model):
    fake_model.predict_proba = lambda _X: [[0.9, 0.1]]
    response = _predict_json(client, SAMPLES[0])

    assert response.status_code == 500
    assert response.json() == {"detail": "Prediction failed."}
