import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseExpressionInput } from './expressionInput.js'

const featureIds = ['g1', 'g2', 'g3']

describe('identifier-labelled expression input', () => {
  it('aligns feature/value pairs to the model order', () => {
    const parsed = parseExpressionInput(
      '[{"feature_id":"g3","value":3},{"feature_id":"g1","value":1},{"feature_id":"g2","value":2}]',
      featureIds,
    )

    assert.deepEqual(parsed, {
      expression: [1, 2, 3],
      featureIds,
    })
  })

  it('rejects duplicate feature IDs', () => {
    assert.throws(
      () => parseExpressionInput(
        '[{"feature_id":"g1","value":1},{"feature_id":"g1","value":2},{"feature_id":"g3","value":3}]',
        featureIds,
      ),
      /appears more than once/,
    )
  })

  it('rejects missing or unknown feature IDs', () => {
    assert.throws(
      () => parseExpressionInput(
        '[{"feature_id":"g1","value":1},{"feature_id":"g2","value":2},{"feature_id":"other","value":3}]',
        featureIds,
      ),
      /Include every required/,
    )
  })

  it('rejects non-finite or non-numeric values', () => {
    assert.throws(
      () => parseExpressionInput(
        '[{"feature_id":"g1","value":1},{"feature_id":"g2","value":null},{"feature_id":"g3","value":3}]',
        featureIds,
      ),
      /finite numeric value/,
    )
  })

  it('rejects positional arrays and malformed JSON', () => {
    assert.throws(() => parseExpressionInput('[1,2,3]', featureIds), /feature ID\/value objects/)
    assert.throws(() => parseExpressionInput('{', featureIds), /valid JSON/)
  })
})