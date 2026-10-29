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
  const question = model?.predicts_label || 'Selected question'
  const questionPrompt = model?.predicts === 'relapse'
    ? 'Is the breast cancer associated with relapse?'
    : model?.predicts === 'estrogen_receptor_status'
      ? 'Is the breast cancer ER positive or ER negative?'
      : 'Question to review.'
  const sampleLabel = isBatch ? file?.name || 'Selected patient data file' : sampleId?.trim() || 'Single patient'
  const format = isBatch ? file?.name?.toLowerCase().endsWith('.tsv') ? 'TSV' : 'CSV' : 'JSON expression map'

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 id="review-dialog-title" className="text-2xl font-semibold text-slate-950">Review patient data</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Before continuing, check that your question and patient data are correct.</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onCancel} className="icon-button" aria-label="Close review dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div>
            <p className="meta-label">Question</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{question}</p>
            <p className="mt-2 text-sm text-slate-600">{questionPrompt}</p>
          </div>

          <div>
            <p className="meta-label">Patient data</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{sampleLabel}</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="meta-label">Patients</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{isBatch ? 'Multiple patients' : 'Single patient'}</dd>
            </div>
            <div>
              <dt className="meta-label">File type</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{format}</dd>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Ready to continue?</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">Your patient data will be reviewed to provide a result for the question above.</p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="secondary-button">Back</button>
          <button type="button" onClick={onConfirm} className="primary-button">Continue</button>
        </div>
      </section>
    </div>
  )
}
