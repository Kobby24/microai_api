function humanize(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function lookupMeaning(prediction, model) {
  const raw = String(prediction ?? '')
  const meanings = model?.label_meanings || {}
  return meanings[raw] || meanings[raw.toLowerCase()] || meanings[raw.toUpperCase()] || null
}

function normalizeOutcomeLabel(label) {
  return String(label ?? '').replace(/\s*\((True|False)\)/gi, '').trim()
}

export function formatOutcomeLabel(prediction, model, options = {}) {
  const raw = String(prediction ?? '')
  const includePredicted = Boolean(options.includePredicted)
  const lower = raw.toLowerCase()

  if (model?.predicts === 'relapse') {
    const isPositive = lower === '1' || lower === 'true' || lower === 'relapse' || lower === 'relapse (true)' || lower === 'positive'
    const label = isPositive ? 'Relapse' : 'No relapse'
    return includePredicted ? `${label} predicted` : label
  }

  if (model?.predicts === 'estrogen_receptor_status') {
    const isPositive = lower === '1' || lower === 'true' || lower === 'er+' || lower === 'positive' || lower === 'er-positive'
    const label = isPositive ? 'ER-positive' : 'ER-negative'
    return includePredicted ? `${label} predicted` : label
  }

  const meaning = lookupMeaning(raw, model)
  const label = normalizeOutcomeLabel(meaning || humanize(raw) || 'Unknown')
  return includePredicted ? `${label} predicted` : label
}

export function formatGeneCount(count) {
  if (!Number.isFinite(Number(count))) return null
  return Number(count).toLocaleString()
}

export function interpretClass(prediction, model) {
  return formatOutcomeLabel(prediction, model)
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
  const outcomeOrder = []

  if (model?.predicts === 'relapse') {
    outcomeOrder.push('No relapse predicted', 'Relapse predicted')
  } else if (model?.predicts === 'estrogen_receptor_status') {
    outcomeOrder.push('ER-negative predicted', 'ER-positive predicted')
  } else {
    for (const row of results || []) {
      const label = interpretClass(row.prediction, model)
      if (!outcomeOrder.includes(label)) outcomeOrder.push(label)
    }
  }

  for (const label of outcomeOrder) counts[label] = 0

  for (const row of results || []) {
    const label = formatOutcomeLabel(row.prediction, model, { includePredicted: true })
    counts[label] = (counts[label] || 0) + 1
  }

  return counts
}
