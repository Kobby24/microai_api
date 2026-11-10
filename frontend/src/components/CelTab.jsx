import { useRef } from 'react'
import { FileText, Upload, X } from 'lucide-react'
import { formatGeneCount } from '../interpret'
import DnaLoader from './ui/DnaLoader'

const ACCEPT = '.CEL,.CEL.gz,.cel,.cel.gz,application/gzip'

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export default function CelTab({
  file,
  onFileChange,
  sampleId,
  onSampleIdChange,
  onSubmit,
  loading,
  disabled,
  model,
}) {
  const inputRef = useRef(null)

  function acceptFile(nextFile) {
    if (!nextFile) return
    const name = (nextFile.name || '').toLowerCase()
    if (!name.endsWith('.cel.gz') && !name.endsWith('.cel')) {
      onFileChange(null, 'Accepts .CEL or .CEL.gz files only.')
      return
    }
    onFileChange(nextFile)
  }

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

      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center transition hover:border-blue-400 hover:bg-blue-50/50"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm ring-1 ring-slate-200">
          <Upload className="h-5 w-5" />
        </div>
        <p className="text-lg font-semibold text-slate-900">Upload Affymetrix CEL file</p>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
          Upload a single patient CEL file. The platform will preprocess it with the same GPL96 MAS5 workflow used for model compatibility checks.
        </p>
        <p className="mt-2 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
          Supported files: .CEL or .CEL.gz
        </p>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            inputRef.current?.click()
          }}
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
        >
          Choose a CEL file
        </button>
      </div>

      {file && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText className="h-4 w-4 shrink-0 text-blue-700" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
              <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onFileChange(null)
              if (inputRef.current) inputRef.current.value = ''
            }}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Remove selected file"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
        <p className="font-semibold text-slate-800">Before you upload</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Your Affymetrix CEL file should contain one patient sample and the preprocessing must match the model's verified GPL96 MAS5 pipeline.
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer list-none font-medium text-slate-800">View file requirements</summary>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
            <li>Single-patient .CEL or .CEL.gz upload only</li>
            <li>Number of measurements: {formatGeneCount(model?.expected_genes) || 'depends on the selected question'}</li>
            <li>Model compatibility must be enabled for GPL96 MAS5 preprocessing</li>
            <li>Patient ID is optional but recommended for tracking</li>
          </ul>
        </details>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled || loading}
          className="inline-flex min-w-52 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading && <DnaLoader size="small" label="Reviewing patient data" />}
          {loading ? 'Reviewing patient data' : 'Analyze patient data'}
        </button>
      </div>
    </form>
  )
}
