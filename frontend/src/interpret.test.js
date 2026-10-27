import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { interpretClass, interpretPrediction, summarizeBatch } from './interpret.js'

const relapseModel = {
  predicts: 'relapse',
  predicts_label: 'Disease relapse',
  label_meanings: {
    0: 'No relapse (False)',
    1: 'Relapse (True)',
  },
}

describe('batch result interpretation', () => {
  it('maps TSV-style prediction rows to clinical labels and a class breakdown', () => {
    const tsvResults = [
      { sample_index: 0, prediction: '1', probability: 0.8, class_probabilities: { 0: 0.2, 1: 0.8 } },
      { sample_index: 1, prediction: '0', probability: 0.9, class_probabilities: { 0: 0.9, 1: 0.1 } },
    ]

    assert.equal(interpretClass(tsvResults[0].prediction, relapseModel), 'Relapse (True)')
    assert.equal(interpretClass(tsvResults[1].prediction, relapseModel), 'No relapse (False)')
    assert.deepEqual(summarizeBatch(tsvResults, relapseModel), {
      'Relapse (True)': 1,
      'No relapse (False)': 1,
    })

    const interpreted = interpretPrediction(tsvResults[0].prediction, relapseModel)
    assert.equal(interpreted.target, 'Disease relapse')
    assert.equal(interpreted.classLabel, 'Relapse (True)')
    assert.match(interpreted.summary, /not an independent clinical diagnosis/)
  })
})
