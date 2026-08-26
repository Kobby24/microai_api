import { Dna } from 'lucide-react'

export default function Header({ apiStatus }) {
  const statusLabel =
    apiStatus === 'ok'
      ? 'API connected'
      : apiStatus === 'loading'
        ? 'Checking API…'
        : 'API unreachable'

  const statusColor =
    apiStatus === 'ok'
      ? 'bg-blue-600'
      : apiStatus === 'loading'
        ? 'bg-slate-400'
        : 'bg-red-500'

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-700 text-white">
            <Dna className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              MICRO-AI Predictor
            </h1>
            <p className="text-xs text-slate-500">
              Gene expression disease classification
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
          <span className="text-xs font-medium text-slate-600">{statusLabel}</span>
        </div>
      </div>
    </header>
  )
}
