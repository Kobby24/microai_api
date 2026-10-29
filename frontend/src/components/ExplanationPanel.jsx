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
  if (numeric > 0) return `Supported the model's ${explainedClassLabel} result`
  if (numeric < 0) return `Weighed against the model's ${explainedClassLabel} result`
  return 'No clear directional influence'
}

function buildSummary(explanation, drivers) {
  const explanationText = typeof explanation.summary === 'string' ? explanation.summary.trim() : ''
  if (explanationText) {
    return explanationText
      .replace(/The model predicts /gi, 'The model predicted ')
      .replace(/The strongest SHAP contributions toward this class came from /gi, 'The strongest gene activity patterns supporting this result were ')
      .replace(/The largest returned SHAP contributions were /gi, 'The strongest gene activity patterns influencing this result were ')
      .replace(/This result supports /gi, 'This result supports ')
  }
  const towardClass = drivers.filter((feature) => Number(feature.shap_value) > 0).slice(0, 2)
  const strongest = towardClass.length ? towardClass : drivers.slice(0, 2)
  if (!strongest.length) {
    return `The model predicted ${explanation.explained_class_label}. No clear gene activity patterns were available to explain this result.`
  }
  const descriptions = strongest.map((feature) => {
    const geneLabel = driverName(feature)
    const status = Number(feature.shap_value) > 0 ? 'supported the result' : 'weighed against the result'
    return `${geneLabel} ${status}`
  })
  return `The model predicted ${explanation.explained_class_label}. ${descriptions.join(' and ')}.`
}

function DriverCard({ feature, explainedClassLabel }) {
  const value = Number(feature.shap_value)
  const supportText = value > 0 ? 'Supported the model\'s result' : value < 0 ? 'Weighed against the model\'s result' : 'Had a limited effect on the model\'s result'
  const observedLevel = feature.expression_level || expressionLevel(feature.model_input_value)
  const geneLabel = driverName(feature)

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{geneLabel}</p>
          <p className="mt-1 text-xs text-slate-500">Observed activity: {observedLevel}</p>
        </div>
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${value >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {value >= 0 ? 'Supports' : 'Against'}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{supportText} for {explainedClassLabel}.</p>
      {feature.feature_id && geneLabel !== feature.feature_id && (
        <p className="mt-2 text-[11px] font-mono text-slate-500">Feature ID: {feature.feature_id}</p>
      )}
    </div>
  )
}

function SimpleDriverList({ drivers, explainedClassLabel }) {
  if (!drivers.length) {
    return <p className="mt-3 text-sm text-slate-500">No reliable gene activity patterns are available to summarize for this sample.</p>
  }

  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      {drivers.slice(0, 6).map((feature, index) => (
        <DriverCard key={`${feature.feature_id || 'feature'}-${index}`} feature={feature} explainedClassLabel={explainedClassLabel} />
      ))}
    </div>
  )
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
              Relative influence {formatPercent(feature.relative_influence_percent)}
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
        Technical details for researchers
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Global importance describes the model overall, not this sample.
      </p>
      {state.status === 'loading' && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <DnaLoader size="small" label="Loading global model importance" />
          Loading global importance
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-3 text-sm text-amber-800" role="status">{state.error}</p>
      )}
      {state.status === 'success' && !state.result.drivers?.length && (
        <p className="mt-3 text-sm text-slate-500">No global drivers available.</p>
      )}
      {state.status === 'success' && state.result.drivers?.length > 0 && (
        <ul className="mt-3 space-y-3">
          {state.result.drivers.map((driver) => (
            <li key={driver.feature_id} className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,1fr)_3.5rem] items-center gap-3 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-800">{driver.gene_symbol || driver.feature_id}</span>
                {driver.gene_symbol && <span className="block truncate font-mono text-slate-500">{driver.feature_id}</span>}
              </span>
              <span className="h-2 overflow-hidden rounded bg-slate-100">
                <span className="block h-full rounded bg-slate-500" style={{ width: `${Math.max(0, Math.min(100, Number(driver.importance) * 100))}%` }} />
              </span>
              <span className="text-right font-mono tabular-nums text-slate-600">{formatPercent(Number(driver.importance) * 100)}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

export default function ExplanationPanel({ explanation, model }) {
  const selected = selectContributors(explanation.features, 8)
  const returnedDrivers = Array.isArray(explanation.drivers) ? explanation.drivers : selected.all.slice(0, 8)
  const drivers = returnedDrivers.slice().sort((left, right) => Math.abs(Number(right.shap_value)) - Math.abs(Number(left.shap_value)))
  const technicalFeatures = selected.all.map((feature) => {
    const enriched = explanation.features.find((item) => item.feature_id === feature.feature_id)
    const driver = drivers.find((item) => item.feature_id === feature.feature_id)
    return { ...feature, ...enriched, ...(driver || {}) }
  })
  const explainedLabel = explanation.explained_class_label

  return (
    <section className="mt-7 border-t border-slate-200 pt-7" aria-labelledby="explanation-heading">
      <div className="max-w-2xl">
        <h3 id="explanation-heading" className="mt-2 font-display text-2xl font-semibold text-slate-950">What influenced this result?</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">The following gene activity patterns had the strongest influence on the model&apos;s result for this sample.</p>
        <p className="mt-3 text-base leading-7 text-slate-700">{buildSummary(explanation, drivers)}</p>
      </div>

      <div className="mt-7">
        <h4 className="text-xl font-semibold text-slate-950">Gene activity patterns</h4>
        {drivers.length ? <SimpleDriverList drivers={drivers} explainedClassLabel={explainedLabel} /> : <p className="mt-3 text-sm text-slate-500">No valid gene activity patterns returned.</p>}
      </div>

      <details className="mt-5 border-t border-slate-200 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">Technical explanation for researchers</summary>
        <div className="mt-4">
          {buildWaterfall(explanation, 8) ? (
            <>
              <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">Contribution path</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm text-slate-700">
                  Each step adds one feature&apos;s contribution to the baseline. Positive values move toward {explainedLabel}; negative values move away from it.
                </p>
              </div>
              <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain rounded-md border border-slate-200 bg-white" tabIndex={0} aria-label="Model contribution summary preview">
                <svg className="block" width="720" height="220" viewBox="0 0 720 220" role="group" aria-label="Cumulative SHAP contribution preview">
                  <g aria-hidden="true">
                    <line x1="20" x2="700" y1="170" y2="170" stroke="#e2e8f0" />
                    <line x1="20" x2="700" y1="100" y2="100" stroke="#e2e8f0" strokeDasharray="3 5" />
                    <line x1="20" x2="700" y1="30" y2="30" stroke="#e2e8f0" strokeDasharray="3 5" />
                  </g>
                  {buildWaterfall(explanation, 8).steps.map((step, index) => {
                    const row = 170 - (index % 5) * 28
                    const width = Math.max(16, Math.abs(step.value) * 150)
                    const x = 40 + index * 60
                    const y = step.value >= 0 ? row - width : row
                    return (
                      <g key={`${step.type}-${index}`}>
                        <rect x={x} y={y} width="32" height={Math.max(6, width)} rx="4" fill={step.value >= 0 ? '#2f7b78' : '#c56b36'} />
                        <text x={x + 16} y="200" textAnchor="middle" fill="#475569" fontSize="9">{step.type === 'feature' ? driverName(step.feature) : step.label}</text>
                      </g>
                    )
                  })}
                </svg>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-600">No waterfall is available for this explanation.</p>
          )}
        </div>
      </details>

      <details className="mt-5 border-t border-slate-200 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">Technical details</summary>
        <div className="mt-3 text-xs text-slate-600">
          <p>Background samples: {explanation.metadata.background_samples}</p>
          <p>Max evals: {explanation.metadata.max_evals}</p>
          <p>Additivity verified: {String(explanation.metadata.additivity_verified)}</p>
        </div>
        <TechnicalDetails features={technicalFeatures} explainedClassLabel={explainedLabel} />
      </details>

      {model?.name && <GlobalDriversSection key={model.name} model={model} />}
    </section>
  )
}
