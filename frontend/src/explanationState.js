export const initialExplanationState = {
  status: 'idle',
  result: null,
  error: '',
}

export function explanationReducer(_state, action) {
  switch (action.type) {
    case 'start':
      return { status: 'loading', result: null, error: '' }
    case 'success':
      return { status: 'success', result: action.result, error: '' }
    case 'failure':
      return { status: 'error', result: null, error: action.error }
    case 'reset':
    default:
      return initialExplanationState
  }
}