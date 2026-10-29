import { Info } from 'lucide-react'
import { formatGeneCount } from '../interpret'
import DnaLoader from './ui/DnaLoader'

export default function JsonTab({
  value,
  onChange,
  sampleId,
  onSampleIdChange,
  onSubmit,
  loading,
  disabled,
  model,
}) {
  const geneCount = formatGeneCount(model?.expected_genes)

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="sample-id" className="mb-2 block text-sm font-medium text-slate-800">
          Patient ID <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id="sample-id"
          type="text"
          value={sampleId}
          maxLength={128}
          onChange={(event) => onSampleIdChange(event.target.value)}
          placeholder="Enter a patient identifier"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>
      <div>
        <label htmlFor="expression-json" className="mb-2 block text-sm font-medium text-slate-800">
          Gene/probe expression map
        </label>
        <textarea
          id="expression-json"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          rows={10}
          placeholder={'[{"feature_id":"<gene-or-probe-id>","value":2.45}]'}
          className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 px-3 py-3 font-mono text-sm leading-relaxed text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3.5 py-3 text-sm text-blue-900">
        <p className="font-semibold text-blue-900">Before you upload</p>
        <p className="mt-2 text-sm leading-6 text-blue-800">
          Your patient data should include the gene expression measurements required for this question.
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer list-none font-medium text-blue-900">View file requirements</summary>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-blue-800">
            <li>Required gene IDs</li>
            <li>Number of measurements: {geneCount || 'depends on the selected question'}</li>
            <li>Patient ID requirements</li>
            <li>Missing or invalid values</li>
          </ul>
        </details>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled || loading}
          className="inline-flex min-w-40 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading && <DnaLoader size="small" label="Reviewing patient data" />}
          {loading ? 'Reviewing patient data' : 'Analyze patient data'}
        </button>
      </div>
    </form>
  )
}
