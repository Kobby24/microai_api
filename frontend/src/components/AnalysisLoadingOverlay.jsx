import { Check, Circle } from 'lucide-react'
import DnaLoader from './ui/DnaLoader'
import { analysisSteps } from '../analysisProgress'

export default function AnalysisLoadingOverlay({ mode, progress }) {
  const steps = analysisSteps(mode, progress)

  return (
    <div className="dialog-backdrop" aria-live="polite">
      <section className="loading-panel" aria-labelledby="analysis-loading-title">
        <div className="analysis-loading-loader"><DnaLoader size="large" label="Running analysis" /></div>
        <h2 id="analysis-loading-title" className="text-2xl font-semibold text-slate-950">Analyzing patient data</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">We’re reviewing the patient’s gene expression data and analyzing it with the selected model. This may take a few moments while we prepare the results and explanations.</p>
        <div className="indeterminate-bar mt-6" aria-hidden="true"><span /></div>
        <ul className="mt-6 space-y-3 text-left">
          {steps.map((step) => (
            <li key={step.label} className="flex items-start gap-3 text-sm">
              {step.state === 'complete' && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />}
              {step.state === 'active' && <Circle className="mt-0.5 h-4 w-4 shrink-0 fill-[#2f7b78] text-[#2f7b78]" aria-hidden="true" />}
              {step.state === 'pending' && <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />}
              <span>
                <span className={step.state === 'active' ? 'font-semibold text-slate-900' : 'text-slate-600'}>{step.label}</span>
                {step.detail && <span className="block text-xs text-slate-500">{step.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
