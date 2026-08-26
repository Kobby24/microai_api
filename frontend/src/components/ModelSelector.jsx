import { ChevronDown, Database } from 'lucide-react'

export default function ModelSelector({
  models,
  selectedModel,
  onChange,
  loading,
  disabled,
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <label htmlFor="model-select" className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Database className="h-4 w-4 text-blue-700" />
        Model selection
      </label>
      <p className="mb-3 text-sm text-slate-500">
        Choose a trained microarray model before running a prediction. The selected model determines the expected gene dimension.
      </p>
      <div className="relative">
        <select
          id="model-select"
          value={selectedModel}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || loading}
          className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="">
            {loading ? 'Loading available models…' : 'Select a model'}
          </option>
          {models.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </section>
  )
}
