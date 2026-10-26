import { useRef, useState } from 'react'
import { fetchGlobalDrivers, extractApiError } from '../api'
import { contributionWidth, selectContributors } from '../xaiPresentation'

function formatValue(value, digits = 4) {
  if (value === null || value === undefined) return '—'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '—'
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : '—'
}

function expressionLevel(value) {
  if (value === null || value === undefined) return 'Unavailable'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 'Unavailable'
  if (numeric <= -2) return 'Much lower than typical'
  if (numeric <= -1) return 'Lower than typical'
  if (numeric < 1) return 'About typical'
  if (numeric < 2) return 'Higher than typical'
  return 'Much higher than typical'
}

function driverName(feature) {
  return feature.gene_symbol || feature.feature_id
}

function directionLabel(value, explainedClassLabel, otherClassLabel) {
  const numeric = Number(value)
  if (numeric > 0) return `Toward ${explainedClassLabel}`
  if (numeric < 0) return otherClassLabel ? `Toward ${otherClassLabel}` : `Away from ${explainedClassLabel}`
  return 'No directional contribution'
}

function buildSummary(explanation, drivers) {
  if (typeof explanation.summary === 'string' && explanation.summary.trim()) {
    return explanation.summary
  }
  const towardClass = drivers.filter((feature) => Number(feature.shap_value) > 0).slice(0, 2)
  const strongest = towardClass.length ? towardClass : drivers.slice(0, 2)
  if (!strongest.length) {
    return `The model predicts ${explanation.explained_class_label}, but no valid SHAP drivers are available to summarize for this sample.`
  }
  const descriptions = strongest.map((feature) => {
    const direction = Number(feature.shap_value) > 0
      ? `${feature.expression_level || expressionLevel(feature.model_input_value)} expression`
      : Number(feature.shap_value) < 0
        ? `${feature.expression_level || expressionLevel(feature.model_input_value)} expression; SHAP contribution away from ${explanation.explained_class_label}`
        : 'without a directional contribution'
    return `${driverName(feature)} (${direction})`
  })
  return towardClass.length
    ? `The model predicts ${explanation.explained_class_label}. The strongest SHAP contributions toward this class came from ${descriptions.join(' and ')}.`
    : `The model predicts ${explanation.explained_class_label}. The largest returned SHAP contributions were ${descriptions.join(' and ')}.`
}

function DriverRow({ feature, maxAbs, explainedClassLabel, otherClassLabel, positiveSide }) {
  const value = Number(feature.shap_value)
  const towardExplained = value > 0
  const towardClass0 = towardExplained ? positiveSide === 'left' : positiveSide !== 'left'
  const side = towardClass0 ? 'left' : 'right'
  const width = `${contributionWidth(value, maxAbs)}%`
  const level = feature.expression_level || expressionLevel(feature.model_input_value)
  const direction = directionLabel(value, explainedClassLabel, otherClassLabel)

  return (
    <li className="grid gap-3 border-b border-slate-100 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1.2fr)_minmax(8rem,0.8fr)] sm:items-center sm:gap-5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900" title={driverName(feature)}>
          {driverName(feature)}
        </p>
        {feature.gene_symbol && (
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500" title={feature.feature_id}>
            {feature.feature_id}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-600">{level}</p>
      </div>

      <div className="min-w-0">
        <div
          className="grid h-6 grid-cols-[1fr_2px_1fr] items-center"
          role="img"
          aria-label={`${direction}, SHAP contribution ${value > 0 ? '+' : ''}${formatValue(value)}`}
        >
          <div className="flex h-full items-center justify-end border-r border-slate-400">
            {side === 'left' && (
              <div className="h-3 rounded-l-sm bg-indigo-600" style={{ width }} />
            )}
          </div>
          <div className="h-full bg-slate-400" />
          <div className="flex h-full items-center border-l border-slate-400">
            {side === 'right' && (
              <div className="h-3 rounded-r-sm bg-blue-700" style={{ width }} />
            )}
          </div>
        </div>
        <div className="mt-1 flex justify-between gap-2 text-[10px] leading-tight text-slate-500">
          <span className="min-w-0 truncate">Toward {otherClassLabel || 'other class'}</span>
          <span className="min-w-0 truncate text-right">Toward {explainedClassLabel}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs sm:block sm:text-right">
        <span className="font-medium text-slate-700">{direction}</span>
        <span className="block font-mono tabular-nums text-slate-600">
          {formatPercent(feature.relative_influence_percent)} relative influence
        </span>
      </div>
    </li>
  )
}

function TechnicalDetails({ features, explainedClassLabel, otherClassLabel }) {
  if (!features.length) {
    return <p className="mt-3 text-sm text-slate-500">No technical feature values are available.</p>
  }

  return (
    <ul className="mt-2 max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
      {features.map((feature) => (
        <li key={feature.feature_id} className="grid gap-2 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(5rem,0.7fr))] sm:items-center sm:gap-4">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{driverName(feature)}</p>
            {feature.gene_symbol && (
              <p className="truncate font-mono text-slate-500">{feature.feature_id}</p>
            )}
          </div>
          <p className="text-slate-600">
            Expression <span className="font-mono">{formatValue(feature.model_input_value)}</span>
            <span className="block text-slate-500">
              {feature.expression_level || expressionLevel(feature.model_input_value)}
            </span>
          </p>
          <p className="text-slate-600">
            Raw input <span className="font-mono">{formatValue(feature.raw_input_value)}</span>
          </p>
          <p className="text-slate-600">
            SHAP <span className="font-mono">{Number(feature.shap_value) > 0 ? '+' : ''}{formatValue(feature.shap_value)}</span>
          </p>
          <p className="text-slate-600">
            {directionLabel(feature.shap_value, explainedClassLabel, otherClassLabel)}
            <span className="block text-slate-500">
              Top-driver relative influence {formatPercent(feature.relative_influence_percent)}
            </span>
          </p>
        </li>
      ))}
    </ul>
  )
}

function GlobalDriversSection({ model }) {
  const [state, setState] = useState({ status: 'idle', result: null, error: '' })
  const requested = useRef(false)

  async function loadDrivers() {
    if (requested.current) return
    requested.current = true
    setState({ status: 'loading', result: null, error: '' })
    try {
      const result = await fetchGlobalDrivers(model.name)
      setState({ status: 'success', result, error: '' })
    } catch (error) {
      requested.current = false
      setState({ status: 'error', result: null, error: extractApiError(error) })
    }
  }

  return (
    <details
      className="mt-5 border-t border-slate-200 pt-4"
      onToggle={(event) => {
        if (event.currentTarget.open) loadDrivers()
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Global model drivers
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Model-level importance is separate from this sample&apos;s SHAP explanation. It uses the
        model&apos;s existing weighted tree feature-importance values and does not describe this
        individual sample. If the model artifacts do not provide valid finite values, no global
        drivers are shown.
      </p>
      {state.status === 'loading' && (
        <p className="mt-3 text-sm text-slate-500" role="status">Loading global model importance…</p>
      )}
      {state.status === 'error' && (
        <p className="mt-3 text-sm text-amber-800" role="status">
          Global model importance is currently unavailable; no sample-specific SHAP values are
          substituted. {state.error}
        </p>
      )}
      {state.status === 'success' && !state.result.drivers?.length && (
        <p className="mt-3 text-sm text-slate-500">No valid global model drivers are available.</p>
      )}
      {state.status === 'success' && state.result.drivers?.length > 0 && (
        <ul className="mt-3 space-y-3">
          {state.result.drivers.map((driver) => (
            <li key={driver.feature_id} className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,1fr)_3.5rem] items-center gap-3 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-800">
                  {driver.gene_symbol || driver.feature_id}
                </span>
                {driver.gene_symbol && (
                  <span className="block truncate font-mono text-slate-500">{driver.feature_id}</span>
                )}
              </span>
              <span className="h-2 overflow-hidden rounded bg-slate-100">
                <span
                  className="block h-full rounded bg-slate-500"
                  style={{ width: `${Math.max(0, Math.min(100, Number(driver.importance) * 100))}%` }}
                />
              </span>
              <span className="text-right font-mono tabular-nums text-slate-600">
                {formatPercent(Number(driver.importance) * 100)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

export default function ExplanationPanel({ explanation, model }) {
  const selected = selectContributors(explanation.features, 8)
  const returnedDrivers = Array.isArray(explanation.drivers)
    ? explanation.drivers
    : selected.all.slice(0, 8)
  const drivers = returnedDrivers
    .slice()
    .sort((left, right) => Math.abs(Number(right.shap_value)) - Math.abs(Number(left.shap_value)))
  const maxAbs = drivers.reduce(
    (maximum, feature) => Math.max(maximum, Math.abs(Number(feature.shap_value))),
    0,
  )
  const classKeys = Object.keys(explanation.class_probabilities || {})
  const otherClassKey = classKeys.find((classKey) => classKey !== explanation.explained_class)
  const otherClassLabel = model?.label_meanings?.[otherClassKey] || otherClassKey
  const classOrder = model?.classes?.length ? model.classes.map(String) : classKeys
  const explainedIndex = classOrder.indexOf(String(explanation.explained_class))
  const positiveSide = explainedIndex === 0 ? 'left' : 'right'
  const technicalFeatures = selected.all.map((feature) => {
    const enriched = explanation.features.find((item) => item.feature_id === feature.feature_id)
    const driver = drivers.find((item) => item.feature_id === feature.feature_id)
    return {
      ...feature,
      ...enriched,
      ...(driver || {}),
    }
  })
  const hasBaselineValues = explanation.base_value != null && explanation.predicted_output != null
  const baseline = hasBaselineValues ? Number(explanation.base_value) : Number.NaN
  const predictedOutput = hasBaselineValues ? Number(explanation.predicted_output) : Number.NaN
  const hasBaseline = Number.isFinite(baseline) && Number.isFinite(predictedOutput)
  const residualValue = explanation.metadata.additivity_residual
  const toleranceValue = explanation.metadata.additivity_tolerance
  const additivityAvailable = residualValue != null
    && toleranceValue != null
    && Number.isFinite(Number(residualValue))
    && Number.isFinite(Number(toleranceValue))
  const additivityPassed = additivityAvailable
    && explanation.metadata.additivity_verified
    && Math.abs(Number(residualValue)) <= Number(toleranceValue)

  return (
    <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="explanation-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="explanation-heading" className="text-base font-semibold text-slate-900">
          Why did the model make this prediction?
        </h3>
        <p className="text-xs text-slate-500">
          {explanation.model_name.toUpperCase()} · {explanation.metadata.method.replaceAll('_', ' ')}
        </p>
      </div>

      <p className="mt-2 text-sm font-medium text-slate-700">
        Explanation for {explanation.explained_class_label}
      </p>
      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
        {buildSummary(explanation, drivers)}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-slate-600">
        These features show which measurements influenced the model&apos;s prediction for this
        sample. They describe model behavior and do not establish biological causation. Interpret
        this explanation as model evidence, not as an independent clinical diagnosis.
      </p>

      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800">Probability context</h4>
          <p className="text-xs text-slate-500">Model-estimated class probabilities</p>
        </div>
        {classKeys.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {classKeys.map((classKey) => {
              const probabilityValue = explanation.class_probabilities[classKey]
              const probability = probabilityValue == null
                ? Number.NaN
                : Number(probabilityValue)
              const label = model?.label_meanings?.[classKey] || classKey
              const predicted = String(classKey) === String(explanation.prediction)
              return (
                <div key={classKey}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    <span className={predicted ? 'font-semibold text-blue-800' : 'text-slate-600'}>
                      {label}{predicted ? ' · predicted' : ''}
                    </span>
                    <span className="font-mono tabular-nums text-slate-700">
                      {Number.isFinite(probability) ? formatPercent(probability * 100) : '—'}
                    </span>
                  </div>
                  {Number.isFinite(probability) ? (
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${predicted ? 'bg-blue-700' : 'bg-slate-400'}`}
                        style={{ width: `${Math.max(0, Math.min(100, probability * 100))}%` }}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Probability unavailable</p>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Class probabilities are unavailable.</p>
        )}
        {hasBaseline ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-sm">
            <span className="text-slate-600">Reference-background baseline for {explanation.explained_class_label}</span>
            <span className="font-mono tabular-nums text-slate-800">{formatPercent(baseline * 100)}</span>
            <span className="text-slate-400" aria-hidden="true">→</span>
            <span className="text-slate-600">This sample</span>
            <span className="font-mono font-semibold tabular-nums text-slate-900">{formatPercent(predictedOutput * 100)}</span>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            A verified reference-background baseline is not available for this explanation.
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          These probabilities describe model outputs for the displayed classes; they are not
          clinical certainty or an independent diagnosis.
        </p>
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800">Top sample-specific drivers</h4>
          <p className="text-xs text-slate-500">
            {drivers.length} of {selected.all.length} selected model-space features
          </p>
        </div>
        {drivers.length ? (
          <>
            <div className="mt-2 hidden justify-between gap-4 text-xs font-medium text-slate-500 sm:flex">
              <span>Toward {classOrder[0] ? model?.label_meanings?.[classOrder[0]] || classOrder[0] : otherClassLabel}</span>
              <span>Toward {classOrder[1] ? model?.label_meanings?.[classOrder[1]] || classOrder[1] : explanation.explained_class_label}</span>
            </div>
            <ul className="mt-1 divide-y divide-slate-100">
              {drivers.map((feature) => (
                <DriverRow
                  key={feature.feature_id}
                  feature={feature}
                  maxAbs={maxAbs}
                  explainedClassLabel={explanation.explained_class_label}
                  otherClassLabel={otherClassLabel}
                  positiveSide={positiveSide}
                />
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Bar direction and size come from each feature&apos;s SHAP contribution to the explained
              class probability. Relative influence is the share among the displayed drivers only.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            No valid sample-specific SHAP drivers were returned for this explanation.
          </p>
        )}
      </div>

      <details className="mt-5 border-t border-slate-200 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          Show technical details
        </summary>
        <div className="mt-3 grid gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600 sm:grid-cols-3">
          <p>Reference samples <span className="font-mono">{explanation.metadata.background_samples}</span></p>
          <p>SHAP evaluations <span className="font-mono">{explanation.metadata.max_evals}</span></p>
          <p className={additivityPassed ? 'text-emerald-800' : 'text-amber-800'}>
            Additivity {additivityAvailable ? (additivityPassed ? 'verified' : 'outside tolerance') : 'unavailable'}
            <span className="ml-1 font-mono">
              Δ {additivityAvailable ? Number(residualValue).toExponential(2) : '—'}
            </span>
          </p>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          {explanation.metadata.preprocessing_scope_note}
        </p>
        <TechnicalDetails
          features={technicalFeatures}
          explainedClassLabel={explanation.explained_class_label}
          otherClassLabel={otherClassLabel}
        />
      </details>

      {model?.name && <GlobalDriversSection key={model.name} model={model} />}
    </section>
  )
}
