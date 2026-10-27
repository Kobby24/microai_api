import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildWaterfall,
  contributionDirection,
  contributionWidth,
  isExplanationForPrediction,
  selectContributors,
} from './xaiPresentation.js'

describe('SHAP contribution presentation', () => {
  it('builds a cumulative probability waterfall with every undisplayed feature in the remainder', () => {
    const explanation = {
      output: 'calibrated_class_probability',
      base_value: 0.924,
      predicted_output: 0.943,
      drivers: [
        { feature_id: 'p1', shap_value: 0.009 },
        { feature_id: 'p2', shap_value: -0.004 },
      ],
      features: [
        { feature_id: 'p1', gene_symbol: 'TMLHE', shap_value: 0.009 },
        { feature_id: 'p2', gene_symbol: 'PGBD5', shap_value: -0.004 },
        { feature_id: 'p3', shap_value: 0.007 },
        { feature_id: 'p4', shap_value: 0.007 },
      ],
    }

    const waterfall = buildWaterfall(explanation, 2)
    const contributions = waterfall.steps
      .filter((step) => step.type === 'feature' || step.type === 'remainder')
      .reduce((sum, step) => sum + step.value, 0)

    assert.equal(waterfall.steps[0].value, 0.924)
    assert.equal(waterfall.steps.at(-2).label, 'Other 2 features')
    assert.equal(waterfall.steps.at(-2).value, 0.014)
    assert.equal(waterfall.steps.at(-1).value, 0.943)
    assert.ok(Math.abs(waterfall.baseline + contributions - waterfall.finalOutput) < 1e-12)
  })

  it('does not construct a waterfall when actual feature values do not close to the output', () => {
    const explanation = {
      output: 'calibrated_class_probability',
      base_value: 0.5,
      predicted_output: 0.8,
      features: [{ feature_id: 'p1', shap_value: 0.2 }],
    }

    assert.equal(buildWaterfall(explanation), null)
  })

  it('selects the strongest positive and negative contributors separately', () => {
    const features = [
      { feature_id: 'p1', shap_value: 0.2 },
      { feature_id: 'n1', shap_value: -0.7 },
      { feature_id: 'p2', shap_value: 0.4 },
      { feature_id: 'n2', shap_value: -0.3 },
      { feature_id: 'zero', shap_value: 0 },
    ]

    const selected = selectContributors(features, 1)
    assert.deepEqual(selected.positive.map((feature) => feature.feature_id), ['p2'])
    assert.deepEqual(selected.negative.map((feature) => feature.feature_id), ['n1'])
    assert.equal(selected.maxAbs, 0.7)
  })

  it('labels the sign relative to the explained class', () => {
    assert.equal(contributionDirection(0.1, 'ER-positive'), 'Toward ER-positive')
    assert.equal(contributionDirection(-0.1, 'ER-positive'), 'Away from ER-positive')
    assert.equal(contributionDirection(0, 'ER-positive'), 'No directional contribution')
  })

  it('scales contribution bars safely and caps their width', () => {
    assert.equal(contributionWidth(-0.5, 1), 50)
    assert.equal(contributionWidth(2, 1), 100)
    assert.equal(contributionWidth(Number.NaN, 1), 0)
    assert.equal(contributionWidth(1, 0), 0)
  })

  it('ignores malformed features and returns empty groups for an empty response', () => {
    assert.deepEqual(selectContributors([{ feature_id: 'bad', shap_value: 'nan' }]), {
      all: [],
      positive: [],
      negative: [],
      maxAbs: 0,
    })
  })

  it('orders the expanded feature list by absolute contribution', () => {
    const selected = selectContributors([
      { feature_id: 'small', shap_value: 0.01 },
      { feature_id: 'large-negative', shap_value: -0.2 },
      { feature_id: 'large-positive', shap_value: 0.15 },
    ])

    assert.deepEqual(
      selected.all.map((feature) => feature.feature_id),
      ['large-negative', 'large-positive', 'small'],
    )
  })

  it('rejects malformed explanations and model/prediction mismatches', () => {
    const model = { name: 'gse7390', feature_ids: ['g1'] }
    const prediction = { prediction: '1', class_probabilities: { '1': 0.8 } }
    const explanation = {
      model_name: 'gse7390',
      prediction: '1',
      explained_class_label: 'Class 1',
      explained_class: '1',
      class_probabilities: { '1': 0.8 },
      output: 'calibrated_class_probability',
      base_value: 0.5,
      predicted_output: 0.8,
      features: [{ feature_id: 'g1', raw_input_value: 1, model_input_value: 0.2, shap_value: 0.3 }],
      metadata: {
        method: 'shap_permutation',
        background_samples: 50,
        max_evals: 1000,
        additivity_residual: 0,
        additivity_tolerance: 0.01,
        preprocessing_scope_note: 'selected feature space',
      },
    }

    assert.equal(isExplanationForPrediction(explanation, model, prediction), true)
    assert.equal(isExplanationForPrediction({ ...explanation, model_name: 'gse2034' }, model, prediction), false)
    assert.equal(
      isExplanationForPrediction({ ...explanation, predicted_output: 0.7 }, model, prediction),
      false,
    )
    assert.equal(
      isExplanationForPrediction({ ...explanation, features: [{ ...explanation.features[0], feature_id: 'unknown' }] }, model, prediction),
      false,
    )
  })
})