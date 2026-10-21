import { AlertCircle, CheckCircle2, LoaderCircle, Sparkles, Table2 } from 'lucide-react'
import { interpretClass, interpretPrediction, summarizeBatch } from '../interpret'
import ExplanationPanel from './ExplanationPanel'

function formatPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return `${(numeric * 100).toFixed(1)}%`
}

function ProbabilityBar({ value }) {
  const percent = Math.max(0, Math.min(100, Number(value) * 100 || 0))

  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-700 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right text-sm font-medium tabular-nums text-slate-700">
        {formatPercent(value)}
      </span>
    </div>
  )
}

function JsonResults({ result, model, onExplain, explaining, explanation, explanationError }) {
  const interpretation = interpretPrediction(result.prediction, model)
  const entries = Object.entries(result.class_probabilities || {})

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {interpretation.target}
        </p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          {interpretation.classLabel}
        </p>
        {interpretation.raw && interpretation.raw !== interpretation.classLabel && (
          <p className="mt-1 text-sm text-slate-500">
            Model output: <span className="font-medium text-slate-700">{interpretation.raw}</span>
          </p>
        )}
      </div>

      {interpretation.summary && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
          {interpretation.summary}
        </p>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Confidence probability</p>
        <ProbabilityBar value={result.probability} />
      </div>

      {entries.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-700">Class probabilities</p>
          <ul className="space-y-3">
            {entries.map(([label, value]) => (
              <li key={label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span
                    className={
                      String(label) === String(result.prediction)
                        ? 'font-semibold text-blue-800'
                        : 'text-slate-600'
                    }
                  >
                    {interpretClass(label, model)}
                  </span>
                  <span className="tabular-nums text-slate-500">{formatPercent(value)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${
                      String(label) === String(result.prediction) ? 'bg-blue-700' : 'bg-slate-400'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, Number(value) * 100 || 0))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

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

        {explanation && <ExplanationPanel explanation={explanation} />}
      </div>
    </div>
  )
}

function CsvResults({ result, model }) {
  const rows = (result.results || []).slice(0, 10)
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
            {result.results?.length > 10
              ? ` · showing the first 10 of ${result.results.length} results`
              : ''}
          </p>
          {countSummary && (
            <p className="mt-2 text-sm text-slate-700">Breakdown: {countSummary}</p>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr key={row.sample_index}>
                <td className="px-4 py-2.5 text-slate-600">
                  {row.sample_id || row.sample_index}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-900">
                  {interpretClass(row.prediction, model)}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-500">{row.prediction}</td>
                <td className="px-4 py-2.5 tabular-nums text-slate-700">
                  {formatPercent(row.probability)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      {hasCsv && <CsvResults result={csvResult} model={model} />}
    </section>
  )
}
