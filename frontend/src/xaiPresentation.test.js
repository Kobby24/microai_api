import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { contributionDirection, contributionWidth, selectContributors } from './xaiPresentation.js'

describe('SHAP contribution presentation', () => {
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
      positive: [],
      negative: [],
      maxAbs: 0,
    })
  })
})