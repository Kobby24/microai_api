function humanize(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function lookupMeaning(prediction, model) {
  const raw = String(prediction ?? '')
  const meanings = model?.label_meanings || {}
  return meanings[raw] || meanings[raw.toLowerCase()] || meanings[raw.toUpperCase()] || null
}

export function formatGeneCount(count) {
  if (!Number.isFinite(Number(count))) return null
  return Number(count).toLocaleString()
}

export function interpretClass(prediction, model) {
  const raw = String(prediction ?? '')
  const meaning = lookupMeaning(raw, model)
  return meaning || humanize(raw) || 'Unknown'
}

export function interpretPrediction(prediction, model) {
  const raw = String(prediction ?? '')
  const classLabel = interpretClass(raw, model)
  const target = model?.predicts_label || humanize(model?.predicts) || 'Predicted class'
  return {
    target,
    classLabel,
    raw,
    summary: `Model prediction: ${classLabel}. This is not an independent clinical diagnosis.`,
  }
}

export function summarizeBatch(results, model) {
  const counts = {}
  for (const row of results || []) {
    const label = interpretClass(row.prediction, model)
    counts[label] = (counts[label] || 0) + 1
  }
  return counts
}
