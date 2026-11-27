// Analysis progress derived only from events that actually happened:
// - upload progress: bytes sent (XMLHttpRequest upload events, via axios onUploadProgress)
// - upload finished: every byte sent, now waiting for the server's response
// - CEL analysis jobs: processing-stage events sent by the backend (see celJob.js). Each
//   stage stays active until the backend reports the next one; nothing here uses timers.
// CSV/TSV and JSON requests report no intermediate server events, so their server work
// is one step rather than invented sub-steps.

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

// User-facing wording for each stage the backend reports, in pipeline order.
export const CEL_STAGE_LABELS = {
  received: 'File received by the server',
  validating_file: 'Validating the CEL file',
  sending_to_preprocessor: 'Sending the file to the preprocessing service',
  queued: 'Waiting for a preprocessing slot',
  preprocessing_started: 'Starting R preprocessing',
  loading_affy: 'Loading the Affymetrix analysis tools',
  reading_cel: 'Reading CEL data',
  mas5_background: 'Applying MAS5 background correction',
  mas5_summaries: 'Computing MAS5 expression values',
  mas5_unstaged: 'Applying MAS5 preprocessing',
  extracting: 'Extracting gene expression values',
  exporting: 'Returning expression data from R',
  validating_expression: 'Validating gene identifiers',
  predicting: 'Running the prediction model',
  preparing_results: 'Preparing your results',
}

export function celJobSteps(progress) {
  const steps = []
  const processing = progress?.phase === 'processing'
  const percent = processing ? null : uploadPercent(progress)
  steps.push({
    id: 'upload',
    label: 'Uploading patient data',
    state: processing ? 'complete' : 'active',
    detail: percent == null ? null : `${percent}% sent`,
  })
  if (!processing) return steps

  const events = Array.isArray(progress?.events) ? progress.events : []
  const stages = events.filter((event) => event?.type === 'stage' && CEL_STAGE_LABELS[event.stage])
  const finished = events.some((event) => event?.type === 'result_ready')
  if (!stages.length && !finished) {
    // Every byte is sent but the server has not confirmed the job yet.
    steps.push({ id: 'confirming', label: 'Confirming the upload with the server', state: 'active', detail: null })
    return steps
  }
  stages.forEach((event, index) => {
    const last = index === stages.length - 1
    steps.push({
      id: `${event.stage}-${event.seq}`,
      label: CEL_STAGE_LABELS[event.stage],
      state: last && !finished ? 'active' : 'complete',
      detail: null,
    })
  })
  if (finished) {
    steps.push({ id: 'completed', label: 'Prediction completed', state: 'complete', detail: null })
    if (progress?.fetchingResult) {
      steps.push({ id: 'loading-results', label: 'Loading your results', state: 'active', detail: null })
    }
  }
  return steps
}

export function activeStep(steps) {
  return steps.find((step) => step.state === 'active') || null
}

export function analysisSteps(mode, progress) {
  if (mode === 'cel' && progress?.celJob) return celJobSteps(progress)
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
