export function selectContributors(features, perDirection = 5) {
  const valid = (features || []).filter(
    (feature) => typeof feature?.feature_id === 'string' && Number.isFinite(Number(feature.shap_value)),
  )
  const positive = valid
    .filter((feature) => Number(feature.shap_value) > 0)
    .sort((left, right) => Number(right.shap_value) - Number(left.shap_value))
  const negative = valid
    .filter((feature) => Number(feature.shap_value) < 0)
    .sort((left, right) => Number(left.shap_value) - Number(right.shap_value))

  return {
    positive: positive.slice(0, perDirection),
    negative: negative.slice(0, perDirection),
    maxAbs: valid.reduce((maximum, feature) => Math.max(maximum, Math.abs(Number(feature.shap_value))), 0),
  }
}

export function contributionDirection(value, explainedClassLabel) {
  const contribution = Number(value)
  if (contribution > 0) return `Toward ${explainedClassLabel}`
  if (contribution < 0) return `Away from ${explainedClassLabel}`
  return 'No directional contribution'
}

export function contributionWidth(value, maxAbs) {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(maxAbs)) || maxAbs <= 0) return 0
  return Math.min(100, (Math.abs(Number(value)) / maxAbs) * 100)
}