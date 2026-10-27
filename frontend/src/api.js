import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://microai-api.onrender.com'

const client = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
})

export function extractApiError(error) {
  const detail = error.response?.data?.detail

  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => item?.msg || item?.detail || JSON.stringify(item))
      .filter(Boolean)
    if (messages.length) return messages.join('; ')
  }

  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail)
  }

  if (error.code === 'ECONNABORTED') {
    return 'The request timed out. Large CSV or TSV files may take longer. Try again or check that the API is running.'
  }

  if (error.request && !error.response) {
    return 'We could not reach the API. Check that the backend is available at https://microai-api.onrender.com.'
  }

  if (error.response?.status) {
    return `Request failed with status ${error.response.status}.`
  }

  return error.message || 'An unexpected error occurred.'
}

export async function fetchHealth() {
  const { data } = await client.get('/health')
  return data
}

export async function fetchModels() {
  const { data } = await client.get('/models')
  return Array.isArray(data?.models) ? data.models : []
}

export async function predictJson(modelName, expression, featureIds, sampleId) {
  const { data } = await client.post(`/predict/${encodeURIComponent(modelName)}`, {
    expression,
    feature_ids: featureIds,
    ...(sampleId?.trim() ? { sample_id: sampleId.trim() } : {}),
  })
  return data
}

export async function explainJson(modelName, expression, featureIds, targetClass, signal, sampleId) {
  const { data } = await client.post(`/explain/${encodeURIComponent(modelName)}`, {
    expression,
    feature_ids: featureIds,
    ...(targetClass ? { target_class: targetClass } : {}),
    ...(sampleId?.trim() ? { sample_id: sampleId.trim() } : {}),
  }, { signal })
  return data
}

export async function fetchGlobalDrivers(modelName) {
  const { data } = await client.get(`/models/${encodeURIComponent(modelName)}/global-drivers`)
  return data
}

export async function predictCsv(modelName, file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post(
    `/predict_csv/${encodeURIComponent(modelName)}`,
    form,
  )
  return data
}
