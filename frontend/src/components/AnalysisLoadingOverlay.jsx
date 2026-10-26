import { Check, Circle, LoaderCircle } from 'lucide-react'

export default function AnalysisLoadingOverlay({ mode }) {
  const steps = [
    { label: 'Input validation', state: 'complete' },
    { label: 'Feature schema matching', state: 'complete' },
    { label: mode === 'csv' ? 'Running batch prediction' : 'Running model prediction', state: 'active' },
    { label: 'Preparing results', state: 'pending' },
  ]

  return (
    <div className="dialog-backdrop" role="status" aria-live="polite">
      <section className="loading-panel" aria-labelledby="analysis-loading-title">
        <div className="loading-orbit"><LoaderCircle className="h-8 w-8 animate-spin text-[#2f7b78]" /></div>
        <p className="eyebrow">Analysis in progress</p>
        <h2 id="analysis-loading-title" className="mt-2 text-2xl font-semibold text-slate-950">Analyzing your data</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">MicroAI is validating your input and running the selected model.</p>
        <div className="indeterminate-bar mt-6" aria-hidden="true"><span /></div>
        <ul className="mt-6 space-y-3 text-left">
          {steps.map((step) => (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              {step.state === 'complete' && <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />}
              {step.state === 'active' && <LoaderCircle className="h-4 w-4 animate-spin text-[#2f7b78]" aria-hidden="true" />}
              {step.state === 'pending' && <Circle className="h-4 w-4 text-slate-300" aria-hidden="true" />}
              <span className={step.state === 'active' ? 'font-semibold text-slate-900' : 'text-slate-600'}>{step.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-slate-500">Please wait while the model completes this request.</p>
      </section>
    </div>
  )
}
