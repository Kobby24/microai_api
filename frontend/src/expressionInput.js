export function parseExpressionInput(raw, expectedFeatureIds) {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('Please enter gene/probe IDs and expression values as JSON.')
  }

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('Input must be a valid JSON array of feature ID/value objects.')
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Input must be a non-empty JSON array of feature ID/value objects.')
  }
  if (parsed.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) {
    throw new Error('Input must be a JSON array of feature ID/value objects.')
  }
  if (!Array.isArray(expectedFeatureIds) || expectedFeatureIds.length === 0) {
    throw new Error('This model has no verified gene/probe input schema.')
  }

  const valuesById = new Map()
  for (const entry of parsed) {
    if (
      entry === null
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || typeof entry.feature_id !== 'string'
      || !entry.feature_id.trim()
      || typeof entry.value !== 'number'
      || !Number.isFinite(entry.value)
    ) {
      throw new Error('Each entry must contain a non-empty feature_id and a finite numeric value.')
    }
    const featureId = entry.feature_id.trim()
    if (valuesById.has(featureId)) {
      throw new Error(`Feature ID ${featureId} appears more than once.`)
    }
    valuesById.set(featureId, entry.value)
  }

  if (
    valuesById.size !== expectedFeatureIds.length
    || expectedFeatureIds.some((featureId) => !valuesById.has(featureId))
    || [...valuesById.keys()].some((featureId) => !expectedFeatureIds.includes(featureId))
  ) {
    throw new Error('Include each required gene/probe ID exactly once and no other IDs.')
  }

  return {
    expression: expectedFeatureIds.map((featureId) => valuesById.get(featureId)),
    featureIds: [...expectedFeatureIds],
  }
}