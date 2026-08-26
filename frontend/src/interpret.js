function humanize(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function lookupMeaning(prediction, model) {
  const raw = String(prediction ?? '')
  const meanings = model?.label_meanings || {}
  return meanings[raw] || meanings[raw.toLowerCase()] || meanings[raw.toUpperCase()] || null
}

function isRelapsePositive(prediction, meaning) {
  const raw = String(prediction ?? '').trim()
  if (raw === '1' || raw.toLowerCase() === 'true') return true
  if (raw === '0' || raw.toLowerCase() === 'false') return false
  const text = String(meaning || raw).toLowerCase()
  if (text.includes('no relapse') || text.includes('false')) return false
  return text.includes('relapse') || text.includes('true')
}

function isErPositive(prediction, meaning) {
  const raw = String(prediction ?? '').trim().toLowerCase()
  if (['1', 'true', 'positive', 'er+', 'er-positive'].includes(raw)) return true
  if (['0', 'false', 'negative', 'er-', 'er-negative'].includes(raw)) return false
  const text = String(meaning || raw).toLowerCase()
  if (text.includes('negative')) return false
  return text.includes('positive')
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
  const predicts = model?.predicts

  if (predicts === 'estrogen_receptor_status') {
    const positive = isErPositive(raw, classLabel)
    return {
      target,
      classLabel,
      raw,
      summary: positive
        ? 'The model estimates this sample as estrogen-receptor positive (ER+). ER-positive tumors typically express the estrogen receptor and may be considered for endocrine therapy, subject to clinical confirmation.'
        : 'The model estimates this sample as estrogen-receptor negative (ER−). ER-negative tumors generally do not rely on estrogen signaling and are less likely to respond to endocrine therapy, subject to clinical confirmation.',
    }
  }

  if (predicts === 'relapse') {
    const relapse = isRelapsePositive(raw, classLabel)
    return {
      target,
      classLabel,
      raw,
      summary: relapse
        ? 'Predicted relapse is True (class 1). The expression profile is more consistent with a relapse outcome. This is a research-model estimate, not a prognosis.'
        : 'Predicted relapse is False (class 0). The expression profile is more consistent with no relapse. This is a research-model estimate, not a prognosis.',
    }
  }

  return {
    target,
    classLabel,
    raw,
    summary: model?.description || 'Class probabilities below show how confident the model is in each label.',
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
