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
  const side = towardExplained
    ? positiveSide === 'left' ? 'left' : 'right'
    : positiveSide === 'left' ? 'right' : 'left'
  const width = `${contributionWidth(value, maxAbs)}%`
  const level = feature.expression_level || expressionLevel(feature.model_input_value)
  const direction = directionLabel(value, explainedClassLabel, otherClassLabel)

  return (
    <li className="grid grid-cols-[minmax(7rem,0.9fr)_minmax(8rem,1.7fr)_minmax(7rem,0.9fr)] items-center gap-2 border-b border-slate-100 py-3 last:border-b-0 sm:gap-4">
      <div className={`min-w-0 ${side === 'left' ? 'order-1 text-right' : 'order-3 text-left'}`}>
        <p className="truncate text-sm font-semibold text-slate-900" title={driverName(feature)}>
          {driverName(feature)}
        </p>
        {feature.gene_symbol && (
          <p className="truncate font-mono text-[11px] text-slate-500" title={feature.feature_id}>
            {feature.feature_id}
          </p>
        )}
        <p className="mt-1 text-[11px] text-slate-600">{level}</p>
      </div>

      <div className="order-2 min-w-0">
        <div
          className="grid h-5 grid-cols-[1fr_2px_1fr] items-center"
          role="img"
          aria-label={`${direction}, SHAP contribution ${value > 0 ? '+' : ''}${formatValue(value)}`}
        >
          <div className="flex h-full items-center justify-end border-r border-slate-400">
            {side === 'left' && (
              <div className="h-3 rounded-l-sm bg-[#2f7b78]" style={{ width }} />
            )}
          </div>
          <div className="h-full bg-slate-400" />
          <div className="flex h-full items-center border-l border-slate-400">
            {side === 'right' && (
              <div className="h-3 rounded-r-sm bg-[#c56b36]" style={{ width }} />
            )}
          </div>
        </div>
        <p className="mt-1 text-center text-[10px] text-slate-500">
          {formatPercent(feature.relative_influence_percent)} relative influence
        </p>
      </div>

      <p className={`order-4 col-span-3 text-center text-[11px] text-slate-500 sm:col-span-1 ${side === 'left' ? 'sm:text-left' : 'sm:text-right'}`}>
        {direction}
      </p>
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
  const [showAllDrivers, setShowAllDrivers] = useState(false)
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
  const visibleDrivers = showAllDrivers ? drivers : drivers.slice(0, 5)
  const hiddenDriverCount = Math.max(0, drivers.length - visibleDrivers.length)
  const explainedLabel = explanation.explained_class_label
  const otherLabel = otherClassLabel || 'other class'
  const leftLabel = positiveSide === 'left' ? explainedLabel : otherLabel
  const rightLabel = positiveSide === 'right' ? explainedLabel : otherLabel

  return (
    <section className="mt-7 border-t border-slate-200 pt-7" aria-labelledby="explanation-heading">
      <div className="max-w-2xl">
        <p className="eyebrow">Why this prediction?</p>
        <h3 id="explanation-heading" className="mt-2 font-display text-2xl font-semibold text-slate-950">
          Why did the model make this prediction?
        </h3>
        <p className="mt-2 text-xs text-slate-500">
          {explanation.model_name.toUpperCase()} · {explanation.metadata.method.replaceAll('_', ' ')}
        </p>
        <p className="mt-3 text-base leading-7 text-slate-700">{buildSummary(explanation, drivers)}</p>
      </div>

      <div className="mt-6 border-y border-slate-200 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Reference context</h4>
          <p className="text-xs text-slate-500">Secondary model-output context</p>
        </div>
        {hasBaseline ? (
          <p className="mt-2 text-sm text-slate-600">
            Reference-background baseline for {explainedLabel}: <span className="font-mono tabular-nums">{formatPercent(baseline * 100)}</span>
            <span className="mx-2 text-slate-400" aria-hidden="true">→</span>
            this sample <span className="font-mono font-semibold tabular-nums text-slate-900">{formatPercent(predictedOutput * 100)}</span>
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-500">A verified reference-background baseline is not available for this explanation.</p>
        )}
        {!classKeys.some((classKey) => explanation.class_probabilities[classKey] != null && Number.isFinite(Number(explanation.class_probabilities[classKey]))) && (
          <p className="mt-2 text-xs text-slate-500">Probability unavailable in the explanation response; the prediction page remains the source for model probabilities.</p>
        )}
      </div>

      <div className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Main evidence</p>
            <h4 className="mt-2 text-xl font-semibold text-slate-950">What influenced this prediction?</h4>
          </div>
          <p className="text-xs text-slate-500">Sample-specific SHAP drivers</p>
        </div>
        {drivers.length ? (
          <>
            <div className="mt-5 grid grid-cols-3 items-center gap-2 text-[11px] font-semibold text-slate-500 sm:gap-4">
              <span className="text-right">Toward {leftLabel}</span>
              <span className="text-center text-slate-400">Zero contribution</span>
              <span>Toward {rightLabel}</span>
            </div>
            <ul className="mt-1 divide-y divide-slate-100" aria-label="Feature influences">
              {visibleDrivers.map((feature) => (
                <DriverRow
                  key={feature.feature_id}
                  feature={feature}
                  maxAbs={maxAbs}
                  explainedClassLabel={explainedLabel}
                  otherClassLabel={otherLabel}
                  positiveSide={positiveSide}
                />
              ))}
            </ul>
            {hiddenDriverCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllDrivers((visible) => !visible)}
                className="mt-4 text-sm font-semibold text-[#1f5f5c] hover:underline"
              >
                {showAllDrivers ? 'Show fewer drivers' : `View all ${drivers.length} influencing features`}
              </button>
            )}
            <div className="mt-5 rounded-md border border-[#dce5e7] bg-[#f7faf9] p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-800">How to read this</p>
              <p className="mt-1">Each bar shows how strongly a feature influenced this sample&apos;s prediction. Direction comes from the feature&apos;s SHAP contribution to the explained class. This describes model behavior; it does not establish biological causation.</p>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No valid sample-specific SHAP drivers were returned for this explanation.</p>
        )}
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
        <span className="mt-0.5 text-base text-[#2f7b78]" aria-hidden="true">ⓘ</span>
        <p><span className="font-semibold text-slate-800">Important.</span> These features influenced the model&apos;s prediction. They do not establish biological causation or represent an independent clinical diagnosis. Interpret this explanation as model evidence, not as an independent clinical diagnosis.</p>
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
