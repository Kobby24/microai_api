import { AlertCircle, CheckCircle2, Eye, LoaderCircle, Sparkles, Table2, X } from 'lucide-react'
import { interpretClass, interpretPrediction, summarizeBatch } from '../interpret'
import ExplanationPanel from './ExplanationPanel'

function formatPercent(value) {
  if (value === null || value === undefined) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return `${(numeric * 100).toFixed(1)}%`
}

function ProbabilityBar({ value }) {
  const numeric = value === null || value === undefined ? Number.NaN : Number(value)
  const percent = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric * 100)) : 0

  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-blue-700 transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function JsonResults({ result, model, onExplain, explaining, explanation, explanationError }) {
  const interpretation = interpretPrediction(result.prediction, model)
  const entries = Object.entries(result.class_probabilities || {})
  const predictedProbabilityValue = result.class_probabilities?.[result.prediction]
  const predictedProbability = predictedProbabilityValue == null
    ? Number.NaN
    : Number(predictedProbabilityValue)
  const otherEntry = entries.find(([label]) => String(label) !== String(result.prediction))
  const predictedProbabilityText = Number.isFinite(predictedProbability)
    ? formatPercent(predictedProbability)
    : result.probability == null || !Number.isFinite(Number(result.probability))
      ? null
      : formatPercent(result.probability)
  const hasOtherProbability = otherEntry
    && otherEntry[1] != null
    && Number.isFinite(Number(otherEntry[1]))

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {interpretation.target}
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
            Predicted {interpretation.classLabel}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Sample ID: <span className="font-medium text-slate-800">{result.sample_id || 'Not provided'}</span>
          </p>
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
            {predictedProbabilityText
              ? `The model assigns a ${predictedProbabilityText} estimated probability to ${interpretation.classLabel}`
              : `The model predicts ${interpretation.classLabel}, but its probability data is unavailable`}
            {predictedProbabilityText && hasOtherProbability
              ? ` and ${formatPercent(otherEntry[1])} to ${interpretClass(otherEntry[0], model)}.`
              : predictedProbabilityText && otherEntry
                ? ' The other class probability is unavailable.'
                : '.'}{' '}
            {predictedProbabilityText && 'These are model outputs, not clinical certainty.'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-800">Class probabilities</p>
          {entries.length > 0 ? (
            <ul className="space-y-3">
              {entries.map(([label, value]) => (
                <li key={label}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span
                      className={
                        String(label) === String(result.prediction)
                          ? 'font-semibold text-blue-800'
                          : 'text-slate-600'
                      }
                    >
                      {interpretClass(label, model)}
                      {String(label) === String(result.prediction) ? ' · predicted' : ''}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-slate-700">
                      {formatPercent(value)}
                    </span>
                  </div>
                  {value !== null && value !== undefined && Number.isFinite(Number(value))
                    ? <ProbabilityBar value={value} />
                    : <p className="text-xs text-slate-500">Probability unavailable</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Class probabilities are unavailable.</p>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Research estimate only. Not a clinical diagnosis or treatment recommendation.
      </p>

      <div className="border-t border-slate-200 pt-4">
        {!explanation && !explanationError && (
          <button
            type="button"
            onClick={onExplain}
            disabled={explaining || !model?.ready}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {explaining ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {explaining ? 'Explaining prediction…' : 'Explain prediction'}
          </button>
        )}

        {explaining && (
          <p className="mt-2 text-sm text-slate-600" role="status" aria-live="polite">
            Calculating a local explanation for this sample.
          </p>
        )}

        {explanationError && (
          <div className="flex items-start gap-2 text-sm text-red-800" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Explanation unavailable</p>
              <p>{explanationError}</p>
              <button
                type="button"
                onClick={onExplain}
                disabled={explaining || !model?.ready}
                className="mt-2 font-medium underline underline-offset-2 disabled:opacity-60"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {explanation && <ExplanationPanel explanation={explanation} model={model} />}
      </div>
    </div>
  )
}

function BatchPredictionDetails({
  row,
  model,
  onExplain,
  onClose,
  explaining,
  explanation,
  explanationError,
}) {
  const sampleLabel = row.sample_id || `Sample ${row.sample_index}`
  const probabilities = Object.entries(row.class_probabilities || {})

  return (
    <section
      className="mb-5 rounded-lg border border-blue-200 bg-blue-50/50 p-4"
      aria-labelledby="batch-detail-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
            Prediction details
          </p>
          <h3 id="batch-detail-heading" className="mt-1 text-lg font-semibold text-slate-900">
            {sampleLabel}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          <X className="h-4 w-4" />
          Back to results
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {model?.predicts_label || 'Prediction'}
          </p>
          <p className="mt-1 font-semibold text-slate-900">
            {interpretClass(row.prediction, model)}
            <span className="ml-2 font-mono text-sm font-normal text-slate-500">
              ({row.prediction})
            </span>
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Model confidence (predicted-class probability):{' '}
            <span className="font-mono font-medium text-slate-800">{formatPercent(row.probability)}</span>
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Class probabilities
          </p>
          {probabilities.length ? (
            <ul className="mt-2 space-y-1.5">
              {probabilities.map(([classKey, value]) => (
                <li key={classKey} className="flex justify-between gap-3 text-sm">
                  <span className="text-slate-600">
                    {interpretClass(classKey, model)}
                    {String(classKey) === String(row.prediction) ? ' · predicted' : ''}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-slate-800">
                    {formatPercent(value)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Class probabilities are unavailable.</p>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        These are model outputs for research and decision support, not a standalone clinical diagnosis.
      </p>

      {explaining && (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-600" role="status" aria-live="polite">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Calculating a local explanation for this sample…
        </p>
      )}

      {explanationError && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Explanation unavailable</p>
            <p>{explanationError}</p>
            <button
              type="button"
              onClick={() => onExplain(row)}
              disabled={explaining}
              className="mt-2 font-medium underline underline-offset-2 disabled:opacity-60"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {explanation && <ExplanationPanel explanation={explanation} model={model} />}
    </section>
  )
}

function CsvResults({
  result,
  model,
  selectedRow,
  onExplain,
  onCloseExplanation,
  explaining,
  explanation,
  explanationError,
}) {
  const rows = result.results || []
  const hasIds = (result.results || []).some((row) => row.sample_id)
  const counts = summarizeBatch(result.results, model)
  const countSummary = Object.entries(counts)
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ')

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
        <div>
          <p className="font-semibold text-slate-900">
            Successfully processed {result.samples_processed}{' '}
            {result.samples_processed === 1 ? 'sample' : 'samples'}
            {model?.predicts_label ? ` for ${model.predicts_label.toLowerCase()}` : ''}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            Source file: <span className="font-medium">{result.filename}</span>
          </p>
          {countSummary && (
            <p className="mt-2 text-sm text-slate-700">Breakdown: {countSummary}</p>
          )}
        </div>
      </div>

      {selectedRow && (
        <BatchPredictionDetails
          row={selectedRow}
          model={model}
          onExplain={onExplain}
          onClose={onCloseExplanation}
          explaining={explaining}
          explanation={explanation}
          explanationError={explanationError}
        />
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-[48rem] divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2.5 font-semibold text-slate-600">
                  {hasIds ? 'Sample ID' : 'Sample index'}
                </th>
                <th className="px-4 py-2.5 font-semibold text-slate-600">
                  {model?.predicts_label || 'Prediction'}
                </th>
                <th className="px-4 py-2.5 font-semibold text-slate-600">Model output</th>
                <th className="px-4 py-2.5 font-semibold text-slate-600">Confidence</th>
                <th className="px-4 py-2.5 font-semibold text-slate-600">Explanation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr key={row.sample_index}>
                  <td className="px-4 py-2.5 text-slate-600">
                    {row.sample_id || `Sample ${row.sample_index}`}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {interpretClass(row.prediction, model)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-500">{row.prediction}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-700">
                    {formatPercent(row.probability)}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => onExplain(row)}
                      aria-label={`View explanation for ${row.sample_id || `Sample ${row.sample_index}`}`}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-800 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View explanation
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function Results({
  jsonResult,
  csvResult,
  model,
  onExplain,
  explaining = false,
  explanation,
  explanationError,
  selectedBatchRow,
  onExplainBatch,
  onCloseBatchExplanation,
}) {
  const hasJson = Boolean(jsonResult)
  const hasCsv = Boolean(csvResult)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Table2 className="h-4 w-4 text-blue-700" />
        <h2 className="text-sm font-semibold text-slate-800">Results</h2>
      </div>

      {!hasJson && !hasCsv && (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Prediction output will appear here after a successful request.
        </p>
      )}

      {hasJson && (
        <JsonResults
          result={jsonResult}
          model={model}
          onExplain={onExplain}
          explaining={explaining}
          explanation={explanation}
          explanationError={explanationError}
        />
      )}
      {hasCsv && (
        <CsvResults
          result={csvResult}
          model={model}
          selectedRow={selectedBatchRow}
          onExplain={onExplainBatch}
          onCloseExplanation={onCloseBatchExplanation}
          explaining={explaining}
          explanation={explanation}
          explanationError={explanationError}
        />
      )}
    </section>
  )
}
