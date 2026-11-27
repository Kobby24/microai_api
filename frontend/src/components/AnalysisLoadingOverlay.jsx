import { Check, Circle } from 'lucide-react'
import DnaLoader from './ui/DnaLoader'
import { activeStep, analysisSteps } from '../analysisProgress'

export default function AnalysisLoadingOverlay({ mode, progress, onCancel }) {
  const steps = analysisSteps(mode, progress)
  const liveStages = mode === 'cel' && Boolean(progress?.celJob)
  const current = liveStages ? activeStep(steps) : null
  const reconnecting = liveStages && progress?.connection === 'reconnecting'

  return (
    <div className="dialog-backdrop" aria-live="polite">
      <section className="loading-panel" aria-labelledby="analysis-loading-title">
        <div className="analysis-loading-loader"><DnaLoader size="large" label="Running analysis" /></div>
        <h2 id="analysis-loading-title" className="text-2xl font-semibold text-slate-950">Analyzing patient data</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">We’re reviewing the patient’s gene expression data and analyzing it with the selected model. This may take a few moments while we prepare the results and explanations.</p>
        {current && (
          <p className="analysis-current-stage mt-4 text-base font-semibold text-[#1f5f5c]" role="status">
            {current.label}…
            {current.detail && <span className="block text-xs font-normal text-slate-500">{current.detail}</span>}
          </p>
        )}
        {reconnecting && (
          <p className="mt-2 text-xs text-slate-600" role="status">
            Connection interrupted. Reconnecting; your analysis continues on the server.
          </p>
        )}
        <div className="indeterminate-bar mt-6" aria-hidden="true"><span /></div>
        <ul className="mt-6 space-y-3 text-left">
          {steps.map((step) => (
            <li key={step.id || step.label} className="flex items-start gap-3 text-sm">
              {step.state === 'complete' && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />}
              {step.state === 'active' && <Circle className="stage-active-dot mt-0.5 h-4 w-4 shrink-0 fill-[#2f7b78] text-[#2f7b78]" aria-hidden="true" />}
              {step.state === 'pending' && <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />}
              <span>
                <span className={step.state === 'active' ? 'font-semibold text-slate-900' : 'text-slate-600'}>{step.label}</span>
                {step.detail && <span className="block text-xs text-slate-500">{step.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
        {liveStages && onCancel && (
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onCancel} className="text-sm font-semibold text-slate-600 hover:text-slate-900 hover:underline">
              Cancel analysis
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
