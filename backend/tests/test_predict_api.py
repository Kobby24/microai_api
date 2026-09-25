SAMPLES = [
    [1.5, 2.0, 3.0],
    [-0.5, 1.0, 4.0],
]


def _genes_by_sample_table(samples):
    n_genes = len(samples[0])
    return [[sample[i] for sample in samples] for i in range(n_genes)]


def encode_csv(samples):
    table = _genes_by_sample_table(samples)
    return "\n".join(",".join(str(value) for value in row) for row in table).encode("utf-8")


def encode_tsv(samples):
    table = _genes_by_sample_table(samples)
    return "\n".join("\t".join(str(value) for value in row) for row in table).encode("utf-8")


def _upload(client, filename, content, content_type, model_name="gse7390"):
    return client.post(
        f"/predict_csv/{model_name}",
        files={"file": (filename, content, content_type)},
    )


def test_valid_tsv_upload_returns_predictions(client):
    response = _upload(
        client,
        "cohort.tsv",
        encode_tsv(SAMPLES),
        "text/tab-separated-values",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "cohort.tsv"
    assert body["samples_processed"] == 2
    assert [row["prediction"] for row in body["results"]] == ["1", "0"]
    assert body["results"][0]["class_probabilities"] == {"0": 0.2, "1": 0.8}
    assert body["results"][1]["class_probabilities"] == {"0": 0.9, "1": 0.1}


def test_valid_csv_upload_matches_tsv_predictions(client):
    csv_response = _upload(client, "cohort.csv", encode_csv(SAMPLES), "text/csv")
    tsv_response = _upload(
        client,
        "cohort.tsv",
        encode_tsv(SAMPLES),
        "text/tab-separated-values",
    )

    assert csv_response.status_code == 200
    assert tsv_response.status_code == 200
    csv_rows = [{k: v for k, v in row.items() if k != "sample_index"} for row in csv_response.json()["results"]]
    tsv_rows = [{k: v for k, v in row.items() if k != "sample_index"} for row in tsv_response.json()["results"]]
    assert csv_rows == tsv_rows


def test_malformed_tsv_returns_clear_validation_error(client):
    response = _upload(
        client,
        "broken.tsv",
        b"1.0\t2.0\n3.0\t4.0\t5.0\n",
        "text/tab-separated-values",
    )

    assert response.status_code == 400
    assert "could not be parsed" in response.json()["detail"]
    assert "TSV" in response.json()["detail"]


def test_empty_tsv_returns_clear_validation_error(client):
    response = _upload(client, "empty.tsv", b"", "text/tab-separated-values")

    assert response.status_code == 400
    assert response.json()["detail"] == "The TSV file is empty."


def test_tsv_incorrect_gene_count_uses_model_expectation(client, fake_model):
    too_few_genes = encode_tsv([[1.0, 2.0]])
    response = _upload(client, "wrong.tsv", too_few_genes, "text/tab-separated-values")

    assert response.status_code == 400
    assert (
        response.json()["detail"]
        == f"Expected {fake_model.training_info['n_genes_original']} columns (genes) for gse7390, got 2"
    )


def test_csv_incorrect_gene_count_matches_tsv_message(client):
    csv_response = _upload(client, "wrong.csv", encode_csv([[1.0, 2.0]]), "text/csv")
    tsv_response = _upload(
        client,
        "wrong.tsv",
        encode_tsv([[1.0, 2.0]]),
        "text/tab-separated-values",
    )

    assert csv_response.status_code == tsv_response.status_code == 400
    assert csv_response.json()["detail"] == tsv_response.json()["detail"]


def test_rejects_unsupported_extension(client):
    response = _upload(client, "data.txt", b"1.0\t2.0\t3.0\n", "text/plain")

    assert response.status_code == 400
    assert response.json()["detail"] == "Only .csv and .tsv files are supported"


def test_uppercase_tsv_extension_is_accepted(client):
    response = _upload(
        client,
        "cohort.TSV",
        encode_tsv(SAMPLES),
        "text/tab-separated-values",
    )
    assert response.status_code == 200
    assert response.json()["samples_processed"] == 2


def test_json_uses_the_same_gene_count_and_prediction_pipeline(client):
    matching = client.post("/predict/gse7390", json={"expression": SAMPLES[0]})
    wrong = client.post("/predict/gse7390", json={"expression": [1.0, 2.0]})

    assert matching.status_code == 200
    body = matching.json()
    assert body["prediction"] == "1"
    assert body["probability"] == 0.8
    assert body["class_probabilities"] == {"0": 0.2, "1": 0.8}

    assert wrong.status_code == 400
    assert wrong.json()["detail"] == "Expected 3 genes, got 2"


def test_json_csv_and_tsv_agree_on_the_same_sample(client):
    sample = SAMPLES[0]
    json_body = client.post("/predict/gse7390", json={"expression": sample}).json()
    csv_body = _upload(client, "one.csv", encode_csv([sample]), "text/csv").json()
    tsv_body = _upload(
        client,
        "one.tsv",
        encode_tsv([sample]),
        "text/tab-separated-values",
    ).json()

    assert json_body["prediction"] == csv_body["results"][0]["prediction"] == tsv_body["results"][0]["prediction"]
    assert json_body["probability"] == csv_body["results"][0]["probability"] == tsv_body["results"][0]["probability"]
    assert (
        json_body["class_probabilities"]
        == csv_body["results"][0]["class_probabilities"]
        == tsv_body["results"][0]["class_probabilities"]
    )
