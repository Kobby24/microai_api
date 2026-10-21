import numpy as np
import pytest

from microai_model import MICROAI


def test_inference_reuses_training_quantile_reference():
    model = MICROAI()
    training = np.array([[1.0, 3.0], [2.0, 4.0]])
    inference = np.array([[100.0, 200.0]])

    model.preprocess(training, fit=True)
    reference = model.quantile_normalizer.reference_distribution.copy()
    processed = model.preprocess(inference, fit=False)

    assert np.array_equal(model.quantile_normalizer.reference_distribution, reference)
    assert np.array_equal(processed, [[1.5, 3.5]])


def test_inference_requires_batch_labels_when_model_has_fitted_combat():
    model = MICROAI()
    model.quantile_normalizer.fit(np.array([[1.0, 3.0], [2.0, 4.0]]))
    model.combat_corrector = object()

    with pytest.raises(ValueError, match="Batch labels are required"):
        model.preprocess(np.array([[1.0, 2.0]]), fit=False)


@pytest.mark.parametrize(
    ("expression", "message"),
    [
        ([[1.0, np.nan]], "Missing expression values are not supported at inference"),
        ([[1.0, np.inf]], "Infinite expression values are not supported"),
        ([1.0, 2.0], "two-dimensional matrix"),
    ],
)
def test_inference_rejects_incomplete_or_malformed_expression(expression, message):
    model = MICROAI()

    with pytest.raises(ValueError, match=message):
        model.preprocess(expression, fit=False)