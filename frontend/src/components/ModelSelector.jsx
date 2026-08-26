import { ChevronDown, Database } from 'lucide-react'
import { formatGeneCount } from '../interpret'

function optionLabel(model) {
  const genes = formatGeneCount(model.expected_genes)
  const target = model.predicts_label || model.predicts
  const parts = [model.display_name || model.name]
  if (target) parts.push(target)
  if (genes) parts.push(`${genes} genes`)
  return parts.join(' — ')
}

export default function ModelSelector({
  models,
  selectedModel,
  onChange,
  loading,
  disabled,
}) {
  const selected = models.find((model) => model.name === selectedModel)
  const geneCount = formatGeneCount(selected?.expected_genes)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <label htmlFor="model-select" className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Database className="h-4 w-4 text-blue-700" />
        Model selection
      </label>
      <p className="mb-3 text-sm text-slate-500">
        Choose a trained microarray model before running a prediction. Each model has a different clinical target and gene dimension.
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
          {models.map((model) => (
            <option key={model.name} value={model.name}>
              {optionLabel(model)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>

      {selected && (
        <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Predicts</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {selected.predicts_label || selected.predicts}
            </p>
            {selected.predicts === 'relapse' && (
              <p className="mt-1 text-xs text-slate-500">Class 1 = True (relapse)</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Expected genes</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {geneCount ? `${geneCount} expression values` : 'Provided by the model at prediction time'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Dataset</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {selected.display_name || selected.name}
            </p>
          </div>
          {selected.description && (
            <p className="text-sm leading-relaxed text-slate-600 sm:col-span-3">
              {selected.description}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
