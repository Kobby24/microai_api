export const initialExplanationState = {
  status: 'idle',
  result: null,
  error: '',
  requestId: null,
}

export function canStartExplanation({ hasRequest, hasPrediction, modelReady, status, inFlight }) {
  return Boolean(hasRequest && hasPrediction && modelReady && status !== 'loading' && !inFlight)
}

export function explanationReducer(_state, action) {
  switch (action.type) {
    case 'start':
      return { status: 'loading', result: null, error: '', requestId: action.requestId }
    case 'success':
      if (action.requestId !== _state.requestId) return _state
      return { status: 'success', result: action.result, error: '', requestId: action.requestId }
    case 'failure':
      if (action.requestId !== _state.requestId) return _state
      return { status: 'error', result: null, error: action.error, requestId: action.requestId }
    case 'reset':
    default:
      return initialExplanationState
  }
}