import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explanationReducer, initialExplanationState } from './explanationState.js'

describe('explanation request state', () => {
  it('transitions through loading and success', () => {
    const loading = explanationReducer(initialExplanationState, { type: 'start' })
    const result = { explained_class: '1' }
    const success = explanationReducer(loading, { type: 'success', result })

    assert.equal(loading.status, 'loading')
    assert.equal(success.status, 'success')
    assert.equal(success.result, result)
  })

  it('keeps failures separate from the prediction result', () => {
    const failure = explanationReducer(
      { status: 'loading', result: null, error: '' },
      { type: 'failure', error: 'Unavailable' },
    )

    assert.deepEqual(failure, { status: 'error', result: null, error: 'Unavailable' })
  })

  it('resets stale explanation state when the selected model changes', () => {
    const stale = { status: 'error', result: null, error: 'Previous model failure' }

    assert.deepEqual(explanationReducer(stale, { type: 'reset' }), initialExplanationState)
  })
})