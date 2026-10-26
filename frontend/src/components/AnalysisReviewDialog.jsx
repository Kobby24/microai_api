import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function AnalysisReviewDialog({ model, mode, file, sampleId, onCancel, onConfirm }) {
  const closeButtonRef = useRef(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const isBatch = mode === 'csv'
  const inputLabel = isBatch ? file?.name || 'Selected CSV or TSV file' : sampleId?.trim() || 'Single sample'
  const format = isBatch ? file?.name?.toLowerCase().endsWith('.tsv') ? 'TSV' : 'CSV' : 'JSON expression map'

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5">
          <div>
            <p className="eyebrow">Review analysis</p>
            <h2 id="review-dialog-title" className="mt-2 text-2xl font-semibold text-slate-950">Ready to run?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Review your input before MicroAI starts the analysis.</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onCancel} className="icon-button" aria-label="Close review dialog">
            <X className="h-5 w-5" />
          </button>
        </div>
        <dl className="grid gap-5 px-6 py-6 sm:grid-cols-2">
          <div><dt className="meta-label">Model</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{model?.display_name || model?.name || 'Selected model'}</dd></div>
          <div><dt className="meta-label">Input</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-900">{inputLabel}</dd></div>
          <div><dt className="meta-label">Analysis mode</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{isBatch ? 'Multiple samples' : 'Single sample'}</dd></div>
          <div><dt className="meta-label">Data format</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{format}</dd></div>
        </dl>
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="secondary-button">Cancel</button>
          <button type="button" onClick={onConfirm} className="primary-button">Run analysis</button>
        </div>
      </section>
    </div>
  )
}
