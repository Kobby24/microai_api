import { contributionDirection, contributionWidth, selectContributors } from '../xaiPresentation'

function formatValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(4) : '—'
}

function ContributionRow({ feature, explainedClassLabel, maxAbs }) {
  const value = Number(feature.shap_value)
  const width = `${contributionWidth(value, maxAbs)}%`
  const positive = value > 0
  const direction = contributionDirection(value, explainedClassLabel)

  return (
    <li className="grid gap-2 border-b border-slate-100 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1.5fr)_minmax(9rem,1fr)] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="truncate font-mono text-xs font-semibold text-slate-800" title={feature.feature_id}>
          {feature.feature_id}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Raw {formatValue(feature.raw_input_value)} · model-space {formatValue(feature.model_input_value)}
        </p>
      </div>

      <div
        className="grid h-5 grid-cols-2"
        role="img"
        aria-label={`${direction}, SHAP contribution ${value > 0 ? '+' : ''}${formatValue(value)}`}
      >
        <div className="flex justify-end border-r border-slate-400">
          {!positive && (
            <div className="h-3 self-center rounded-l-sm bg-rose-600" style={{ width }} />
          )}
        </div>
        <div className="flex border-l border-slate-400">
          {positive && (
            <div className="h-3 self-center rounded-r-sm bg-blue-700" style={{ width }} />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs sm:block sm:text-right">
        <span className={positive ? 'font-medium text-blue-800' : 'font-medium text-rose-800'}>
          {direction}
        </span>
        <span className="font-mono tabular-nums text-slate-700">
          {value > 0 ? '+' : ''}{formatValue(value)}
        </span>
      </div>
    </li>
  )
}

function ContributionGroup({ title, features, explainedClassLabel, maxAbs, emptyText }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-1 text-sm font-semibold text-slate-800">{title}</h4>
      {features.length ? (
        <ul>
          {features.map((feature) => (
            <ContributionRow
              key={feature.feature_id}
              feature={feature}
              explainedClassLabel={explainedClassLabel}
              maxAbs={maxAbs}
            />
          ))}
        </ul>
      ) : (
        <p className="py-3 text-sm text-slate-500">{emptyText}</p>
      )}
    </section>
  )
}

export default function ExplanationPanel({ explanation }) {
  const { positive, negative, maxAbs } = selectContributors(explanation.features)
  const { metadata } = explanation
  const residual = Number(metadata.additivity_residual)
  const tolerance = Number(metadata.additivity_tolerance)
  const additivityPassed = metadata.additivity_verified && Math.abs(residual) <= tolerance

  return (
    <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="explanation-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="explanation-heading" className="text-base font-semibold text-slate-900">
          Explanation for {explanation.explained_class_label}
        </h3>
        <p className="text-xs text-slate-500">
          {explanation.model_name.toUpperCase()} · {metadata.method.replaceAll('_', ' ')}
        </p>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        SHAP values show how selected model-space features contributed to this class probability relative to the reference background. Positive contributions move toward the explained class; negative contributions move away. This is not a complete attribution across all original genes.
      </p>

      <div className="mt-4 grid gap-x-8 gap-y-2 border-y border-slate-200 py-3 text-sm sm:grid-cols-3">
        <p><span className="text-slate-500">Base value</span> <span className="ml-2 font-mono tabular-nums text-slate-900">{formatValue(explanation.base_value)}</span></p>
        <p><span className="text-slate-500">Model output</span> <span className="ml-2 font-mono tabular-nums text-slate-900">{formatValue(explanation.predicted_output)}</span></p>
        <p className={additivityPassed ? 'text-emerald-800' : 'text-amber-800'}>
          Additivity {additivityPassed ? 'passed' : 'outside tolerance'}
          <span className="ml-2 font-mono tabular-nums">Δ {residual.toExponential(2)}</span>
        </p>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-2 lg:gap-8">
        <ContributionGroup
          title="Strongest positive contributions"
          features={positive}
          explainedClassLabel={explanation.explained_class_label}
          maxAbs={maxAbs}
          emptyText="No positive contributions in the selected feature space."
        />
        <ContributionGroup
          title="Strongest negative contributions"
          features={negative}
          explainedClassLabel={explanation.explained_class_label}
          maxAbs={maxAbs}
          emptyText="No negative contributions in the selected feature space."
        />
      </div>

      <details className="mt-4 border-t border-slate-200 pt-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          View all {explanation.features.length} selected features
        </summary>
        <ul className="mt-2 max-h-96 overflow-y-auto">
          {explanation.features.map((feature) => (
            <ContributionRow
              key={feature.feature_id}
              feature={feature}
              explainedClassLabel={explanation.explained_class_label}
              maxAbs={maxAbs}
            />
          ))}
        </ul>
      </details>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">{metadata.preprocessing_scope_note}</p>
    </section>
  )
}