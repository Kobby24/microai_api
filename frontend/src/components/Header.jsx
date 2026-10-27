import { Dna } from 'lucide-react'
import DnaLoader from './ui/DnaLoader'

export default function Header({ apiStatus, model, workflowStep }) {
  const statusLabel =
    apiStatus === 'ok'
      ? 'API connected'
      : apiStatus === 'loading'
        ? 'Checking API'
        : 'API unreachable'

  const statusColor = apiStatus === 'ok' ? 'bg-blue-600' : 'bg-red-500'

  return (
    <header className="border-b border-slate-200/90 bg-white/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#123b5d] text-white">
            <Dna className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              MicroAI
            </h1>
            <p className="text-xs text-slate-500">
              Gene expression analysis
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {model && <span className="hidden text-xs text-slate-500 sm:inline">{model.display_name || model.name}</span>}
          <span className="flex items-center gap-2 border-l border-slate-200 pl-4 text-xs font-medium text-slate-600">
            {apiStatus === 'loading'
              ? <DnaLoader size="small" label="Checking API connection" />
              : <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />}
            <span className="hidden sm:inline">{statusLabel}</span>
          </span>
        </div>
      </div>
      {workflowStep && workflowStep !== 'start' && <div className="h-0.5 bg-[#e6eeee]"><div className="h-full bg-[#2f7b78] transition-all" style={{ width: `${({ model: 25, input: 50, analyzing: 82, results: 100 })[workflowStep] || 0}%` }} /></div>}
    </header>
  )
}
