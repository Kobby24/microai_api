import { Info } from 'lucide-react'
import { formatGeneCount } from '../interpret'

export default function JsonTab({ value, onChange, onSubmit, loading, disabled, model }) {
  const geneCount = formatGeneCount(model?.expected_genes)

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="expression-json" className="mb-2 block text-sm font-medium text-slate-800">
          Gene expression vector
        </label>
        <textarea
          id="expression-json"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          rows={10}
          placeholder={'[2.45, 1.02, 5.6]'}
          className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 px-3 py-3 font-mono text-sm leading-relaxed text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-blue-100 bg-blue-50 px-3.5 py-3 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
        <p>
          <span className="font-semibold">Input must be a valid JSON array of floats.</span>{' '}
          The length must exactly match the number of genes the model was trained on
          {geneCount ? ` (${geneCount} for ${model.display_name || model.name})` : ''}.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled || loading}
          className="inline-flex items-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? 'Predicting…' : 'Run prediction'}
        </button>
      </div>
    </form>
  )
}
