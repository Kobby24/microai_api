export function selectContributors(features, perDirection = 5) {
  const valid = (features || [])
    .filter((feature) => typeof feature?.feature_id === 'string' && Number.isFinite(Number(feature.shap_value)))
    .sort((left, right) => Math.abs(Number(right.shap_value)) - Math.abs(Number(left.shap_value)))
  const positive = valid
    .filter((feature) => Number(feature.shap_value) > 0)
    .sort((left, right) => Number(right.shap_value) - Number(left.shap_value))
  const negative = valid
    .filter((feature) => Number(feature.shap_value) < 0)
    .sort((left, right) => Number(left.shap_value) - Number(right.shap_value))

  return {
    all: valid,
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

export function isExplanationForPrediction(explanation, model, prediction) {
  if (
    !explanation
    || explanation.model_name !== model?.name
    || explanation.prediction !== prediction?.prediction
    || explanation.explained_class !== prediction?.prediction
    || typeof explanation.explained_class_label !== 'string'
    || explanation.output !== 'calibrated_class_probability'
    || !Array.isArray(explanation.features)
    || explanation.features.length === 0
    || !explanation.metadata
    || !Array.isArray(model?.feature_ids)
    || explanation.base_value == null
    || explanation.predicted_output == null
  ) {
    return false
  }

  const targetProbabilityValue = prediction.class_probabilities?.[prediction.prediction]
  const targetProbability = targetProbabilityValue == null
    ? Number.NaN
    : Number(targetProbabilityValue)
  const explainedProbability = Number(explanation.predicted_output)
  if (
    !Number.isFinite(targetProbability)
    || !Number.isFinite(explainedProbability)
    || Math.abs(targetProbability - explainedProbability) > 1e-8
    || !Number.isFinite(Number(explanation.base_value))
  ) {
    return false
  }

  const featureIds = new Set()
  for (const feature of explanation.features) {
    if (
      typeof feature?.feature_id !== 'string'
      || !model.feature_ids?.includes(feature.feature_id)
      || featureIds.has(feature.feature_id)
      || feature.raw_input_value == null
      || feature.model_input_value == null
      || feature.shap_value == null
      || !Number.isFinite(Number(feature.raw_input_value))
      || !Number.isFinite(Number(feature.model_input_value))
      || !Number.isFinite(Number(feature.shap_value))
    ) {
      return false
    }
    featureIds.add(feature.feature_id)
  }

  const metadata = explanation.metadata
  const responseProbabilities = explanation.class_probabilities || {}
  const predictionProbabilities = prediction.class_probabilities || {}
  const probabilitiesMatch = Object.entries(predictionProbabilities).every(
    ([classKey, value]) => responseProbabilities[classKey] != null
      && value != null
      && Number.isFinite(Number(responseProbabilities[classKey]))
      && Number.isFinite(Number(value))
      && Math.abs(Number(responseProbabilities[classKey]) - Number(value)) <= 1e-8,
  )
  const reportedResidual = Number(metadata.additivity_residual)
  const calculatedResidual = Number(explanation.base_value)
    + explanation.features.reduce((sum, feature) => sum + Number(feature.shap_value), 0)
    - explainedProbability

  return (
    probabilitiesMatch
    && Math.abs(reportedResidual - calculatedResidual) <= 1e-7
    && typeof metadata.method === 'string'
    && Number.isInteger(metadata.background_samples)
    && metadata.background_samples > 0
    && Number.isInteger(metadata.max_evals)
    && metadata.max_evals > 0
    && metadata.additivity_residual != null
    && Number.isFinite(Number(metadata.additivity_residual))
    && metadata.additivity_tolerance != null
    && Number.isFinite(Number(metadata.additivity_tolerance))
    && typeof metadata.preprocessing_scope_note === 'string'
  )
}