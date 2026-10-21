import { contributionDirection, contributionWidth, selectContributors } from '../xaiPresentation'

function formatValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(4) : '—'
}

function ContributionRow({ feature, explainedClassLabel, maxAbs }) {
  const value = Number(feature.shap_value)
  const magnitude = contributionWidth(value, maxAbs)
  const width = value === 0 ? '0%' : `max(2px, ${magnitude}%)`
  const positive = value > 0
  const negative = value < 0
  const direction = contributionDirection(value, explainedClassLabel)
  const contributionClass = positive
    ? 'font-medium text-blue-800'
    : negative
      ? 'font-medium text-rose-800'
      : 'font-medium text-slate-600'

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
          {negative && (
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
        <span className={contributionClass}>
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
  const { all, positive, negative, maxAbs } = selectContributors(explanation.features)
  const { metadata } = explanation
  const residual = Number(metadata.additivity_residual)
  const tolerance = Number(metadata.additivity_tolerance)
  const additivityPassed = metadata.additivity_verified && Math.abs(residual) <= tolerance

  return (
    <section className="mt-6 border-t border-slate-200 pt-5" aria-labelledby="explanation-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="explanation-heading" className="text-base font-semibold text-slate-900">
          Why did the model make this prediction?
        </h3>
        <p className="text-xs text-slate-500">
          {explanation.model_name.toUpperCase()} · {metadata.method.replaceAll('_', ' ')}
        </p>
      </div>

      <p className="mt-2 text-sm font-medium text-slate-700">
        Explanation for {explanation.explained_class_label}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {metadata.background_samples} reference samples · {explanation.features.length} selected model-space features
      </p>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Each contribution shows how a selected feature moved the model output toward or away from the explained class relative to the reference background. This describes model behavior, not whether a feature is biologically good or bad. It is not a complete attribution across all 22,283 input probes.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600" role="group" aria-label="Contribution chart legend">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-rose-600" />Negative: away from class</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 border-l-2 border-slate-500" />Zero contribution</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-blue-700" />Positive: toward class</span>
      </div>

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
          View all {all.length} selected features
        </summary>
        <ul className="mt-2 max-h-96 overflow-y-auto">
          {all.map((feature) => (
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