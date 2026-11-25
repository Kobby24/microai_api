// Analysis progress derived only from events the browser can observe:
// - upload progress: bytes sent (XMLHttpRequest upload events, via axios onUploadProgress)
// - upload finished: every byte sent, now waiting for the server's response
// The server runs preprocessing and prediction inside that one request and reports no
// intermediate events, so those are shown as a single step rather than invented sub-steps.

export const initialAnalysisProgress = { phase: 'uploading', loaded: 0, total: null }

export function progressFromUploadEvent(event) {
  const loaded = Number(event?.loaded)
  const total = Number(event?.total)
  const hasTotal = Number.isFinite(total) && total > 0
  const safeLoaded = Number.isFinite(loaded) && loaded > 0 ? loaded : 0
  return {
    phase: hasTotal && safeLoaded >= total ? 'processing' : 'uploading',
    loaded: safeLoaded,
    total: hasTotal ? total : null,
  }
}

export function uploadPercent(progress) {
  if (!progress?.total || !Number.isFinite(progress.loaded)) return null
  return Math.min(100, Math.floor((progress.loaded / progress.total) * 100))
}

export function analysisSteps(mode, progress) {
  const processing = progress?.phase === 'processing'
  const percent = processing ? null : uploadPercent(progress)
  const uploadLabel = mode === 'json' ? 'Sending patient data' : 'Uploading patient data'
  const processingLabel = mode === 'cel'
    ? 'Preprocessing the CEL file (MAS5) and running the model'
    : mode === 'csv'
      ? 'Reading the file and running the batch prediction'
      : 'Running the model'
  return [
    {
      label: uploadLabel,
      state: processing ? 'complete' : 'active',
      detail: percent == null ? null : `${percent}% sent`,
    },
    {
      label: processingLabel,
      state: processing ? 'active' : 'pending',
      detail: processing && mode === 'cel' ? 'This is usually the longest step.' : null,
    },
    { label: 'Show results', state: 'pending', detail: null },
  ]
}
