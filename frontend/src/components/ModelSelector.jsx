import { ChevronDown, Database } from 'lucide-react'
import { formatGeneCount } from '../interpret'
import DnaLoader from './ui/DnaLoader'

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
    <section className="surface-panel p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(22rem,1.25fr)] lg:items-start">
        <div>
          <p className="eyebrow">01 / Choose model</p>
          <label htmlFor="model-select" className="mt-2 flex items-center gap-2 text-xl font-semibold text-slate-950">
            <Database className="h-5 w-5 text-[#2f7b78]" />
            Select an analysis model
          </label>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
            Choose the model that matches your supported gene-expression dataset and research target.
          </p>
        </div>
        <div className="relative">
          <select
            id="model-select"
            value={selectedModel}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled || loading}
            className={`w-full appearance-none rounded-md border border-slate-300 bg-white py-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-[#2f7b78] focus:ring-2 focus:ring-[#2f7b78]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${loading ? 'pl-10' : 'pl-3'}`}
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
          {loading && <span className="absolute left-3 top-1/2 -translate-y-1/2"><DnaLoader size="small" label="Loading available models" /></span>}
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
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
          {selected.ready && selected.feature_ids?.length ? (
            <details className="text-sm text-slate-700 sm:col-span-3">
              <summary className="cursor-pointer font-medium">
                Required input order ({selected.feature_ids.length} gene/probe identifiers)
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded border border-slate-200 bg-white p-3 text-xs leading-relaxed">
                {selected.feature_ids.join('\n')}
              </pre>
            </details>
          ) : (
            <p className="text-sm font-medium text-red-800 sm:col-span-3" role="status">
              {selected.readiness_reason || 'Predictions are disabled because this model is not ready.'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
