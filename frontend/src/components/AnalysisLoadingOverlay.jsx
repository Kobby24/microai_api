import { Check, Circle } from 'lucide-react'
import DnaLoader from './ui/DnaLoader'

export default function AnalysisLoadingOverlay({ mode }) {
  const steps = [
    { label: 'Validate data', state: 'complete' },
    { label: 'Match feature IDs', state: 'complete' },
    { label: mode === 'csv' ? 'Run batch prediction' : 'Run model', state: 'active' },
    { label: 'Prepare results', state: 'pending' },
  ]

  return (
    <div className="dialog-backdrop" aria-live="polite">
      <section className="loading-panel" aria-labelledby="analysis-loading-title">
        <div className="analysis-loading-loader"><DnaLoader size="large" label="Running analysis" /></div>
        <h2 id="analysis-loading-title" className="text-2xl font-semibold text-slate-950">Running analysis</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Validating input and running the selected model.</p>
        <div className="indeterminate-bar mt-6" aria-hidden="true"><span /></div>
        <ul className="mt-6 space-y-3 text-left">
          {steps.map((step) => (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              {step.state === 'complete' && <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />}
              {step.state === 'active' && <Circle className="h-4 w-4 fill-[#2f7b78] text-[#2f7b78]" aria-hidden="true" />}
              {step.state === 'pending' && <Circle className="h-4 w-4 text-slate-300" aria-hidden="true" />}
              <span className={step.state === 'active' ? 'font-semibold text-slate-900' : 'text-slate-600'}>{step.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
