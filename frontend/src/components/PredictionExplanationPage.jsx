import { ArrowLeft, AlertCircle } from 'lucide-react'
import { interpretClass } from '../interpret'
import ExplanationPanel from './ExplanationPanel'
import DnaLoader from './ui/DnaLoader'

function formatPercent(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : 'N/A'
}

function ProbabilityList({ prediction, model }) {
  const entries = Object.entries(prediction?.class_probabilities || {})
  if (!entries.length) return <p className="text-sm text-slate-500">Class probabilities unavailable.</p>

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
              <span className="font-mono tabular-nums text-slate-800">{valid ? formatPercent(numeric) : 'N/A'}</span>
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
        <h2 className="text-xl font-semibold text-slate-950">No prediction available</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">Select a sample from the results page.</p>
        <button type="button" onClick={onBack} className="primary-button mt-6">Back to analysis</button>
      </section>
    )
  }

  const sampleLabel = prediction.sample_id || `Sample ${prediction.sample_index ?? ''}`.trim()
  const predictionLabel = interpretClass(prediction.prediction, model)
  const questionText = model?.predicts === 'relapse'
    ? 'Is this breast cancer sample associated with relapse?'
    : model?.predicts === 'estrogen_receptor_status'
      ? 'Is this breast cancer sample ER positive or ER negative?'
      : 'What question is this result answering?'
  const resultHeading = predictionLabel.includes('ER')
    ? `${predictionLabel} predicted`
    : predictionLabel.includes('No relapse')
      ? 'No relapse predicted'
      : 'Relapse predicted'
  const summaryText = predictionLabel.includes('ER')
    ? `The model classified this sample as ${predictionLabel.toLowerCase()}. This model-generated estimate should be confirmed with appropriate clinical testing.`
    : `The model classified this sample as ${predictionLabel.toLowerCase()}. This result reflects the model's estimate and is not an independent clinical diagnosis.`

  return (
    <div className="space-y-7">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f5f5c] hover:underline"><ArrowLeft className="h-4 w-4" />Back to analysis results</button>
      <div>
        <p className="eyebrow">Understanding this sample&apos;s result</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">{sampleLabel}</h2>
        <p className="mt-3 text-sm text-slate-700"><span className="font-semibold text-slate-900">Question:</span> {questionText}</p>
      </div>

      <section className="surface-panel p-6" aria-labelledby="prediction-summary-heading">
        <p className="eyebrow">Result</p>
        <h3 id="prediction-summary-heading" className="mt-2 text-3xl font-semibold text-slate-950">{resultHeading}</h3>
        <p className="mt-3 text-sm leading-6 text-slate-700">{summaryText}</p>
        <dl className="mt-6 grid gap-5 border-t border-slate-200 pt-5 sm:grid-cols-2">
          <div>
            <dt className="meta-label">Sample</dt>
            <dd className="mt-1 text-sm font-medium text-slate-800">{sampleLabel}</dd>
          </div>
          <div>
            <dt className="meta-label">Model confidence</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-950">{formatPercent(prediction.probability)}</dd>
          </div>
        </dl>
      </section>

      <section className="surface-panel p-6" aria-labelledby="probability-heading">
        <h3 id="probability-heading" className="text-lg font-semibold text-slate-950">How strongly does the model support this result?</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">These scores describe the model&apos;s confidence, not a confirmed medical outcome.</p>
        <div className="mt-5"><ProbabilityList prediction={prediction} model={model} /></div>
      </section>

      <p className="text-xs text-slate-500">Research use only. These results are generated from gene expression data and are not an independent clinical diagnosis.</p>

      {loading && <section className="surface-panel p-6" aria-live="polite"><div className="flex items-center gap-3"><DnaLoader size="small" label="Loading explanation" /><div><h3 className="font-semibold text-slate-950">Loading explanation</h3><p className="mt-1 text-sm text-slate-600">Reviewing the gene activity patterns that influenced this result.</p></div></div></section>}
      {error && <section className="rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">We couldn&apos;t load this explanation.</p><p className="mt-1">{error}</p><button type="button" onClick={onRetry} className="mt-3 font-semibold underline">Try again</button></div></div></section>}
      {explanation && <ExplanationPanel explanation={explanation} model={model} />}
    </div>
  )
}
