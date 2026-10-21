import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canStartExplanation, explanationReducer, initialExplanationState } from './explanationState.js'

describe('explanation request state', () => {
  it('transitions through loading and success', () => {
    const loading = explanationReducer(initialExplanationState, { type: 'start', requestId: 1 })
    const result = { explained_class: '1' }
    const success = explanationReducer(loading, { type: 'success', requestId: 1, result })

    assert.equal(loading.status, 'loading')
    assert.equal(success.status, 'success')
    assert.equal(success.result, result)
  })

  it('keeps failures separate from the prediction result', () => {
    const failure = explanationReducer(
      { status: 'loading', result: null, error: '', requestId: 1 },
      { type: 'failure', requestId: 1, error: 'Unavailable' },
    )

    assert.deepEqual(failure, { status: 'error', result: null, error: 'Unavailable', requestId: 1 })
  })

  it('resets stale explanation state when the selected model changes', () => {
    const stale = { status: 'error', result: null, error: 'Previous model failure', requestId: 1 }

    assert.deepEqual(explanationReducer(stale, { type: 'reset' }), initialExplanationState)
  })

  it('ignores a previous model response that arrives after reset', () => {
    const started = explanationReducer(initialExplanationState, { type: 'start', requestId: 8 })
    const reset = explanationReducer(started, { type: 'reset' })
    const late = explanationReducer(reset, {
      type: 'success',
      requestId: 8,
      result: { model_name: 'gse7390' },
    })

    assert.equal(late, initialExplanationState)
  })

  it('ignores an old failure while a newer explanation is loading', () => {
    const oldRequest = explanationReducer(initialExplanationState, { type: 'start', requestId: 1 })
    const newRequest = explanationReducer(oldRequest, { type: 'start', requestId: 2 })
    const lateFailure = explanationReducer(newRequest, {
      type: 'failure',
      requestId: 1,
      error: 'Old request failed',
    })

    assert.equal(lateFailure, newRequest)
  })

  it('prevents explanation requests without a prediction or while another is active', () => {
    const ready = {
      hasRequest: true,
      hasPrediction: true,
      modelReady: true,
      status: 'idle',
      inFlight: false,
    }

    assert.equal(canStartExplanation(ready), true)
    assert.equal(canStartExplanation({ ...ready, hasPrediction: false }), false)
    assert.equal(canStartExplanation({ ...ready, hasRequest: false }), false)
    assert.equal(canStartExplanation({ ...ready, status: 'loading', inFlight: true }), false)
    assert.equal(canStartExplanation({ ...ready, modelReady: false }), false)
  })

  it('allows retry after failure and accepts the newer request only', () => {
    const firstAttempt = explanationReducer(initialExplanationState, { type: 'start', requestId: 1 })
    const failed = explanationReducer(firstAttempt, { type: 'failure', requestId: 1, error: 'Network unavailable' })
    assert.equal(canStartExplanation({
      hasRequest: true,
      hasPrediction: true,
      modelReady: true,
      status: failed.status,
      inFlight: false,
    }), true)

    const retry = explanationReducer(failed, { type: 'start', requestId: 2 })
    const retryResult = { model_name: 'gse2034' }
    const success = explanationReducer(retry, { type: 'success', requestId: 2, result: retryResult })
    const lateFailure = explanationReducer(success, { type: 'failure', requestId: 1, error: 'Old failure' })

    assert.equal(success.result, retryResult)
    assert.equal(lateFailure, success)
  })
})