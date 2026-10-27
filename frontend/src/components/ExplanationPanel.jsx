import { useRef, useState } from 'react'
import { fetchGlobalDrivers, extractApiError } from '../api'
import { buildWaterfall, selectContributors } from '../xaiPresentation'
import DnaLoader from './ui/DnaLoader'

function formatValue(value, digits = 4) {
  if (value === null || value === undefined) return 'N/A'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : 'N/A'
}

function formatPercent(value) {
  if (value === null || value === undefined) return 'N/A'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : 'N/A'
}

function formatContribution(value) {
  const numeric = Number(value) * 100
  if (!Number.isFinite(numeric)) return 'N/A'
  const rounded = Number(numeric.toFixed(2))
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)} pp`
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

function directionLabel(value, explainedClassLabel) {
  const numeric = Number(value)
  if (numeric > 0) return `Toward ${explainedClassLabel}`
  if (numeric < 0) return `Away from ${explainedClassLabel}`
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

function TechnicalDetails({ features, explainedClassLabel }) {
  if (!features.length) {
    return <p className="mt-3 text-sm text-slate-500">No feature values available.</p>
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
            {directionLabel(feature.shap_value, explainedClassLabel)}
            <span className="block text-slate-500">
              Top-driver relative influence {formatPercent(feature.relative_influence_percent)}
            </span>
          </p>
        </li>
      ))}
    </ul>
  )
}

function ExpressionIndicator({ feature }) {
  const value = Number(feature.model_input_value)
  const position = Number.isFinite(value) ? Math.max(0, Math.min(100, ((value + 3) / 6) * 100)) : 50

  return (
    <div className="mt-3" aria-label={`Standardized expression ${formatValue(feature.model_input_value)} relative to the model reference`}>
      <p className="text-[10px] font-medium text-slate-600">Expression relative to model reference</p>
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-[#c8dfd8] via-[#e8ece8] to-[#e9cbb9]">
        <span className="absolute -top-1 h-4 w-1 rounded bg-slate-900" style={{ left: `${position}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-slate-500">
        <span>Lower</span><span>Reference center</span><span>Higher</span>
      </div>
    </div>
  )
}

function WaterfallChart({ waterfall, explainedClassLabel, selectedFeatureId, hoveredFeatureId, onSelectFeature, onHoverFeature }) {
  const chart = waterfall.steps
  const values = chart.flatMap((step) => [step.start, step.end])
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const padding = Math.max((rawMax - rawMin) * 0.18, 0.003)
  const domainMin = Math.max(0, rawMin - padding)
  const domainMax = Math.min(1, rawMax + padding)
  const plotTop = 26
  const plotBottom = 218
  const plotHeight = plotBottom - plotTop
  const marginLeft = 58
  const slotWidth = 112
  const chartWidth = Math.max(720, marginLeft + 26 + chart.length * slotWidth)
  const chartHeight = 326
  const y = (value) => plotBottom - ((value - domainMin) / (domainMax - domainMin)) * plotHeight
  const ticks = [domainMin, (domainMin + domainMax) / 2, domainMax]
  const x = (index) => marginLeft + index * slotWidth + slotWidth / 2
  const activeFeatureId = hoveredFeatureId || selectedFeatureId
  const selectedDetails = chart.find((step) => step.type === 'feature' && step.feature.feature_id === activeFeatureId)

  return (
    <>
      <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain rounded-md border border-slate-200 bg-white" tabIndex={0} aria-label="Scrollable waterfall chart">
        <svg
          className="block"
          width={chartWidth}
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="group"
          aria-label={`Cumulative SHAP waterfall from reference probability ${formatPercent(waterfall.baseline * 100)} to final prediction ${formatPercent(waterfall.finalOutput * 100)}`}
        >
          {ticks.map((tick, index) => {
            const tickY = y(tick)
            return (
              <g key={index} aria-hidden="true">
                <line x1={marginLeft - 7} x2={chartWidth - 14} y1={tickY} y2={tickY} stroke="#e2e8f0" strokeDasharray={index === 0 ? undefined : '3 5'} />
                <text x={marginLeft - 11} y={tickY + 3} textAnchor="end" fill="#64748b" fontSize="9">{formatPercent(tick * 100)}</text>
              </g>
            )
          })}
          {chart.map((step, index) => {
            const centerX = x(index)
            const isTotal = step.type === 'reference' || step.type === 'final'
            const isPositive = step.value >= 0
            const fill = step.type === 'final'
              ? '#174b48'
              : step.type === 'reference'
                ? '#64748b'
                : step.type === 'remainder'
                  ? '#a1aab2'
                  : isPositive ? '#2f7b78' : '#c56b36'
            const top = isTotal ? y(step.value) : Math.min(y(step.start), y(step.end))
            const rawHeight = isTotal ? plotBottom - top : Math.abs(y(step.start) - y(step.end))
            const barHeight = Math.max(rawHeight, 2)
            const barY = rawHeight < 2 && !isTotal ? top - 1 : top
            const previous = chart[index - 1]
            const isInteractive = step.type === 'feature'
            const ariaLabel = step.type === 'feature'
              ? `${driverName(step.feature)}, probe ${step.feature.feature_id}, ${step.feature.expression_level || expressionLevel(step.feature.model_input_value)}, ${formatContribution(step.value)}, ${directionLabel(step.value, explainedClassLabel)}`
              : `${step.label}, ${formatPercent(step.value * 100)}`

            return (
              <g
                key={`${step.type}-${step.feature?.feature_id || index}`}
                role={isInteractive ? 'button' : undefined}
                tabIndex={isInteractive ? 0 : undefined}
                aria-label={isInteractive ? ariaLabel : undefined}
                onClick={isInteractive ? () => onSelectFeature(step.feature.feature_id) : undefined}
                onMouseEnter={isInteractive ? () => onHoverFeature(step.feature.feature_id) : undefined}
                onMouseLeave={isInteractive ? () => onHoverFeature(null) : undefined}
                onFocus={isInteractive ? () => onHoverFeature(step.feature.feature_id) : undefined}
                onBlur={isInteractive ? () => onHoverFeature(null) : undefined}
                onKeyDown={isInteractive ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectFeature(step.feature.feature_id)
                  }
                } : undefined}
                className={isInteractive ? 'cursor-pointer' : undefined}
              >
                {previous && (
                  <line x1={x(index - 1) + 20} x2={centerX - 20} y1={y(previous.end)} y2={y(previous.end)} stroke="#94a3b8" strokeDasharray="3 3" />
                )}
                <rect
                  x={centerX - (step.type === 'final' ? 23 : 17)}
                  y={barY}
                  width={step.type === 'final' ? 46 : 34}
                  height={barHeight}
                  rx="2"
                  fill={fill}
                  stroke={isInteractive && selectedFeatureId === step.feature.feature_id ? '#0f172a' : 'none'}
                  strokeWidth="2"
                >
                  <title>{ariaLabel}</title>
                </rect>
                {step.type === 'feature' && (
                  <text x={centerX} y={Math.max(plotTop + 12, Math.min(y(step.start), y(step.end)) - 7)} textAnchor="middle" fill={isPositive ? '#1f5f5c' : '#9a4528'} fontSize="10" fontWeight="700">
                    {formatContribution(step.value)}
                  </text>
                )}
                <text x={centerX} y="239" textAnchor="middle" fill={step.type === 'final' ? '#174b48' : '#334155'} fontSize="10" fontWeight={step.type === 'final' ? '700' : '600'}>
                  {step.type === 'feature' ? driverName(step.feature) : step.type === 'remainder' ? step.label : step.type === 'reference' ? 'Reference' : 'Final output'}
                </text>
                <text x={centerX} y="253" textAnchor="middle" fill="#64748b" fontSize="8.5" fontFamily="monospace">
                  {step.type === 'feature' ? step.feature.feature_id : step.type === 'remainder' ? `${step.featureCount} undisplayed` : step.type === 'reference' ? 'background' : explainedClassLabel}
                </text>
                {step.type === 'feature' && (
                  <text x={centerX} y="267" textAnchor="middle" fill="#64748b" fontSize="8">
                    {step.feature.expression_level || expressionLevel(step.feature.model_input_value)}
                  </text>
                )}
                <text x={centerX} y="289" textAnchor="middle" fill={step.type === 'final' ? '#174b48' : '#334155'} fontSize={step.type === 'final' ? '13' : '10'} fontWeight={step.type === 'final' ? '700' : '600'}>
                  {step.type === 'feature' || step.type === 'remainder' ? formatContribution(step.value) : formatPercent(step.value * 100)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600" aria-label="Contribution direction legend">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[#2f7b78]" aria-hidden="true" />Positive · toward {explainedClassLabel}</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[#c56b36]" aria-hidden="true" />Negative · away from {explainedClassLabel}</span>
      </div>
      {selectedDetails && (
        <div className="mt-3 max-w-xl border-l-2 border-[#2f7b78] bg-[#f7faf9] px-4 py-3" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold text-slate-900">{driverName(selectedDetails.feature)}</p>
            <p className="font-mono text-sm font-semibold text-slate-800">{formatContribution(selectedDetails.value)}</p>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">Probe: {selectedDetails.feature.feature_id}</p>
          <p className="mt-2 text-xs text-slate-600">Expression: {selectedDetails.feature.expression_level || expressionLevel(selectedDetails.feature.model_input_value)}</p>
          <p className="mt-1 text-xs text-slate-600">Direction: {directionLabel(selectedDetails.value, explainedClassLabel)}</p>
          <ExpressionIndicator feature={selectedDetails.feature} />
        </div>
      )}
    </>
  )
}

function ContributionFallback({ drivers, features, explainedClassLabel }) {
  const displayedIds = new Set(drivers.map((feature) => feature.feature_id))
  const remainderFeatures = features.filter((feature) => !displayedIds.has(feature.feature_id))
  const remainder = remainderFeatures.reduce((sum, feature) => sum + Number(feature.shap_value), 0)
  const maxAbs = Math.max(0, ...drivers.map((feature) => Math.abs(Number(feature.shap_value))), Math.abs(remainder))
  const rows = [
    ...drivers.map((feature) => ({
      feature,
      label: driverName(feature),
      detail: feature.feature_id,
      value: Number(feature.shap_value),
      expression: feature.expression_level || expressionLevel(feature.model_input_value),
    })),
    ...(remainderFeatures.length ? [{
      label: `Other ${remainderFeatures.length} ${remainderFeatures.length === 1 ? 'feature' : 'features'}`,
      detail: 'Undisplayed selected features',
      value: remainder,
      expression: '',
    }] : []),
  ]

  return (
    <div className="mt-4 max-w-3xl">
      <ul className="divide-y divide-slate-100">
        {rows.map((row, index) => {
          const value = row.value
          const positive = value >= 0
          const width = maxAbs > 0 ? Math.abs(value) / maxAbs * 48 : 0
          return (
            <li key={row.feature?.feature_id || `remainder-${index}`} className="grid grid-cols-[minmax(5rem,1fr)_minmax(7rem,1.4fr)_5.5rem] items-center gap-3 py-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">{row.label}</span>
                <span className="block truncate font-mono text-[10px] text-slate-500">{row.detail}</span>
                {row.expression && <span className="block text-[10px] text-slate-500">{row.expression}</span>}
              </span>
              <span className="grid h-4 grid-cols-2 items-center" aria-hidden="true">
                <span className="flex h-full items-center justify-end border-r border-slate-400">
                  {!positive && <span className="h-2 rounded-l-sm bg-[#c56b36]" style={{ width: `${width}%` }} />}
                </span>
                <span className="flex h-full items-center border-l border-slate-400">
                  {positive && <span className="h-2 rounded-r-sm bg-[#2f7b78]" style={{ width: `${width}%` }} />}
                </span>
              </span>
              <span className="text-right font-mono text-xs font-semibold text-slate-800">
                {formatContribution(value)}
                <span className="block font-sans text-[9px] font-normal text-slate-500">{directionLabel(value, explainedClassLabel)}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
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
        Global importance describes the model overall, not this sample. It uses weighted tree feature importance.
      </p>
      {state.status === 'loading' && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <DnaLoader size="small" label="Loading global model importance" />
          Loading global importance
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-3 text-sm text-amber-800" role="status">
          {state.error}
        </p>
      )}
      {state.status === 'success' && !state.result.drivers?.length && (
        <p className="mt-3 text-sm text-slate-500">No global drivers available.</p>
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
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [hoveredFeatureId, setHoveredFeatureId] = useState(null)
  const selected = selectContributors(explanation.features, 8)
  const returnedDrivers = Array.isArray(explanation.drivers)
    ? explanation.drivers
    : selected.all.slice(0, 8)
  const drivers = returnedDrivers
    .slice()
    .sort((left, right) => Math.abs(Number(right.shap_value)) - Math.abs(Number(left.shap_value)))
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
    && Number.isFinite(Number(explanation.base_value))
    && Number.isFinite(Number(explanation.predicted_output))
  const waterfall = buildWaterfall(explanation, 8)
  const residualValue = explanation.metadata.additivity_residual
  const toleranceValue = explanation.metadata.additivity_tolerance
  const additivityAvailable = residualValue != null
    && toleranceValue != null
    && Number.isFinite(Number(residualValue))
    && Number.isFinite(Number(toleranceValue))
  const additivityPassed = additivityAvailable
    && explanation.metadata.additivity_verified
    && Math.abs(Number(residualValue)) <= Number(toleranceValue)
  const explainedLabel = explanation.explained_class_label

  return (
    <section className="mt-7 border-t border-slate-200 pt-7" aria-labelledby="explanation-heading">
      <div className="max-w-2xl">
        <h3 id="explanation-heading" className="mt-2 font-display text-2xl font-semibold text-slate-950">
          What influenced this prediction?
        </h3>
        <p className="mt-2 text-xs text-slate-500">
          {explanation.model_name.toUpperCase()} sample explanation
        </p>
        <p className="mt-3 text-base leading-7 text-slate-700">{buildSummary(explanation, drivers)}</p>
      </div>

      <div className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-xl font-semibold text-slate-950">Reference to final output</h4>
          </div>
          <p className="text-xs text-slate-500">Contribution to model output · percentage points (pp)</p>
        </div>
        {drivers.length ? (
          <>
            {waterfall ? (
              <WaterfallChart
                waterfall={waterfall}
                explainedClassLabel={explainedLabel}
                selectedFeatureId={selectedFeatureId}
                hoveredFeatureId={hoveredFeatureId}
                onSelectFeature={setSelectedFeatureId}
                onHoverFeature={setHoveredFeatureId}
              />
            ) : (
              <>
                {hasBaselineValues && (
                  <p className="mt-3 text-sm text-amber-800" role="alert">
                    SHAP values do not reconcile with the final output. No cumulative waterfall is shown.
                  </p>
                )}
                {!hasBaselineValues && (
                  <p className="mt-3 text-sm text-slate-600">Reference probability unavailable. Contributions are shown without a cumulative baseline.</p>
                )}
                <ContributionFallback
                  drivers={drivers.slice(0, 8)}
                  features={selected.all}
                  explainedClassLabel={explainedLabel}
                />
              </>
            )}
            <div className="mt-5 border-t border-slate-200 pt-4 text-sm leading-6 text-slate-600">
              <p className="mt-1">
                {waterfall
                  ? `Each step adds one feature's SHAP contribution to the reference probability. Positive values move toward ${explainedLabel}; negative values move away. SHAP describes model contributions, not biological causation.`
                  : hasBaselineValues
                    ? 'SHAP values do not reconcile with the final output, so no cumulative path is shown. Contributions remain in individual rows. SHAP describes model contributions, not biological causation.'
                    : 'No reference probability is available, so contributions are shown without a cumulative baseline. SHAP describes model contributions, not biological causation.'}
              </p>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No valid SHAP drivers returned.</p>
        )}
      </div>

      <details className="mt-5 border-t border-slate-200 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          Technical details
        </summary>
        <div className="mt-3 grid gap-2 border-b border-slate-200 pb-3 text-xs text-slate-600 sm:grid-cols-3">
          <p>Reference samples <span className="font-mono">{explanation.metadata.background_samples}</span></p>
          <p>SHAP evaluations <span className="font-mono">{explanation.metadata.max_evals}</span></p>
          <p className={additivityPassed ? 'text-emerald-800' : 'text-amber-800'}>
            Additivity {additivityAvailable ? (additivityPassed ? 'verified' : 'outside tolerance') : 'unavailable'}
            <span className="ml-1 font-mono">
              Residual {additivityAvailable ? Number(residualValue).toExponential(2) : 'N/A'}
            </span>
          </p>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          {explanation.metadata.preprocessing_scope_note}
        </p>
        <TechnicalDetails
          features={technicalFeatures}
          explainedClassLabel={explanation.explained_class_label}
        />
      </details>

      {model?.name && <GlobalDriversSection key={model.name} model={model} />}
    </section>
  )
}
