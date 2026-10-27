import { ArrowLeft, AlertCircle } from 'lucide-react'
import { interpretClass } from '../interpret'
import ExplanationPanel from './ExplanationPanel'
import DnaLoader from './ui/DnaLoader'

function formatPercent(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : '—'
}

function ProbabilityList({ prediction, model }) {
  const entries = Object.entries(prediction?.class_probabilities || {})
  if (!entries.length) return <p className="text-sm text-slate-500">Class probabilities are unavailable.</p>

  return (
    <ul className="space-y-4">
      {entries.map(([key, value]) => {
        const numeric = Number(value)
        const valid = Number.isFinite(numeric)
        const predicted = String(key) === String(prediction.prediction)
        return (
          <li key={key}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span className={predicted ? 'font-semibold text-[#1f5f5c]' : 'text-slate-600'}>{interpretClass(key, model)}{predicted ? ' · predicted' : ''}</span>
              <span className="font-mono tabular-nums text-slate-800">{valid ? formatPercent(numeric) : '—'}</span>
            </div>
            {valid ? <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${predicted ? 'bg-[#2f7b78]' : 'bg-slate-400'}`} style={{ width: `${Math.max(0, Math.min(100, numeric * 100))}%` }} /></div> : <p className="text-xs text-slate-500">Probability unavailable</p>}
          </li>
        )
      })}
    </ul>
  )
}

export default function PredictionExplanationPage({ prediction, model, explanation, loading, error, onRetry, onBack }) {
  if (!prediction) {
    return (
      <section className="surface-panel p-8 text-center">
        <h2 className="text-xl font-semibold text-slate-950">Explanation unavailable</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">This prediction is no longer available in the current analysis session.</p>
        <button type="button" onClick={onBack} className="primary-button mt-6">Return to analysis</button>
      </section>
    )
  }

  const sampleLabel = prediction.sample_id || `Sample ${prediction.sample_index ?? ''}`.trim()
  const predictionLabel = interpretClass(prediction.prediction, model)

  return (
    <div className="space-y-7">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f5f5c] hover:underline"><ArrowLeft className="h-4 w-4" />Back to analysis results</button>
      <div>
        <p className="eyebrow">Prediction explanation</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">{sampleLabel}</h2>
        <p className="mt-2 text-sm text-slate-600">{model?.predicts_label || 'Model prediction'}</p>
      </div>

      <section className="surface-panel p-6" aria-labelledby="prediction-summary-heading">
        <p className="eyebrow">Prediction</p>
        <h3 id="prediction-summary-heading" className="mt-2 text-3xl font-semibold text-slate-950">{predictionLabel}</h3>
        <dl className="mt-6 grid gap-5 border-t border-slate-200 pt-5 sm:grid-cols-2">
          <div><dt className="meta-label">Model output</dt><dd className="mt-1 font-mono text-sm text-slate-800">{prediction.prediction}</dd></div>
          <div><dt className="meta-label">Model confidence</dt><dd className="mt-1 font-mono text-lg font-semibold text-slate-950">{formatPercent(prediction.probability)}</dd></div>
        </dl>
      </section>

      <section className="surface-panel p-6" aria-labelledby="probability-heading">
        <h3 id="probability-heading" className="text-lg font-semibold text-slate-950">Class probabilities</h3>
        <p className="mt-1 text-sm text-slate-600">Model outputs for the available classes, not clinical certainty.</p>
        <div className="mt-5"><ProbabilityList prediction={prediction} model={model} /></div>
      </section>

      {loading && <section className="surface-panel p-6" aria-live="polite"><div className="flex items-center gap-3"><DnaLoader size="small" label="Preparing explanation" /><div><h3 className="font-semibold text-slate-950">Preparing explanation</h3><p className="mt-1 text-sm text-slate-600">Calculating a local explanation for this sample.</p></div></div></section>}
      {error && <section className="rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">We couldn&apos;t generate the explanation</p><p className="mt-1">{error}</p><button type="button" onClick={onRetry} className="mt-3 font-semibold underline">Try again</button></div></div></section>}
      {explanation && <ExplanationPanel explanation={explanation} model={model} />}
    </div>
  )
}
