import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { CEL_STAGE_LABELS, activeStep, analysisSteps, celJobSteps } from './analysisProgress.js'
import { CONNECTION_LOST_MESSAGE, CelJobError, celJobEventsUrl, followCelJob } from './celJob.js'

const stage = (seq, name) => ({ seq, type: 'stage', stage: name })

// Minimal EventSource stand-in: tests decide exactly which server events arrive.
class FakeEventSource {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.closed = false
    FakeEventSource.instances.push(this)
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  send(event) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }

  fail(readyState) {
    this.readyState = readyState
    this.onerror?.()
  }

  close() {
    this.closed = true
    this.readyState = 2
  }
}

function manualTimers() {
  const pending = []
  return {
    setTimer: (fn, ms) => {
      pending.push({ fn, ms })
      return pending.length - 1
    },
    clearTimer: (id) => {
      if (pending[id]) pending[id].fn = null
    },
    run() {
      const due = pending.splice(0)
      due.forEach((timer) => timer.fn?.())
    },
    pending,
  }
}

function follow(options = {}) {
  FakeEventSource.instances = []
  const events = []
  const connection = []
  const timers = manualTimers()
  const handle = followCelJob({
    apiBase: 'https://api.example.test/',
    jobId: 'job-1',
    onEvent: (event) => events.push(event),
    onConnectionChange: (state) => connection.push(state),
    EventSourceImpl: FakeEventSource,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...options,
  })
  return { handle, events, connection, timers, source: () => FakeEventSource.instances.at(-1) }
}

describe('CEL job event stream', () => {
  it('builds the events URL and resumes after the last received event', () => {
    assert.equal(celJobEventsUrl('https://api.example.test/', 'a b'), 'https://api.example.test/predict_cel_jobs/a%20b/events')
    assert.equal(celJobEventsUrl('https://api.example.test', 'x', 7), 'https://api.example.test/predict_cel_jobs/x/events?after=7')
  })

  it('passes backend events through in order and resolves only on result_ready', async () => {
    const { handle, events, source } = follow()
    source().open()
    source().send(stage(1, 'received'))
    source().send(stage(2, 'mas5_background'))
    let resolved = false
    handle.promise.then(() => { resolved = true })
    await Promise.resolve()
    assert.equal(resolved, false)
    source().send({ seq: 3, type: 'result_ready' })
    await handle.promise
    assert.deepEqual(events.map((event) => event.seq), [1, 2, 3])
    assert.equal(source().closed, true)
  })

  it('ignores events replayed after a reconnect instead of showing them twice', async () => {
    const { handle, events, connection, source } = follow()
    source().open()
    source().send(stage(1, 'received'))
    source().send(stage(2, 'reading_cel'))
    source().fail(0) // browser is reconnecting on its own
    assert.deepEqual(connection, ['open', 'reconnecting'])
    source().open()
    source().send(stage(2, 'reading_cel'))
    source().send(stage(3, 'mas5_background'))
    source().send({ seq: 4, type: 'result_ready' })
    await handle.promise
    assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4])
    assert.equal(FakeEventSource.instances.length, 1)
  })

  it('reopens the stream from the last event when the browser gives up, never re-submitting the job', async () => {
    const { handle, events, timers } = follow()
    FakeEventSource.instances[0].open()
    FakeEventSource.instances[0].send(stage(1, 'received'))
    FakeEventSource.instances[0].send(stage(2, 'mas5_background'))
    FakeEventSource.instances[0].fail(2)
    assert.equal(FakeEventSource.instances[0].closed, true)
    timers.run()
    const second = FakeEventSource.instances[1]
    assert.equal(second.url, 'https://api.example.test/predict_cel_jobs/job-1/events?after=2')
    second.open()
    second.send({ seq: 3, type: 'result_ready' })
    await handle.promise
    assert.deepEqual(events.map((event) => event.seq), [1, 2, 3])
    assert.ok(FakeEventSource.instances.every((instance) => instance.url.includes('/predict_cel_jobs/job-1/events')))
  })

  it('reports a connection failure after repeated reconnect failures', async () => {
    const { handle, timers } = follow({ maxReconnectAttempts: 2 })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeEventSource.instances.at(-1).fail(2)
      timers.run()
    }
    await assert.rejects(handle.promise, (error) => error instanceof CelJobError && error.kind === 'connection' && error.message === CONNECTION_LOST_MESSAGE)
  })

  it('gives up when an automatic reconnect never succeeds', async () => {
    const { handle, timers } = follow({ reconnectGiveUpMs: 5000 })
    FakeEventSource.instances[0].fail(0)
    assert.equal(timers.pending[0].ms, 5000)
    timers.run()
    await assert.rejects(handle.promise, (error) => error.kind === 'connection')
  })

  it('surfaces the backend error detail and status', async () => {
    const { handle, source } = follow()
    source().send(stage(1, 'validating_expression'))
    source().send({ seq: 2, type: 'error', status: 400, detail: "Feature identifiers do not match this model's required gene/probe set." })
    await assert.rejects(handle.promise, (error) => error.status === 400 && /gene\/probe set/.test(error.message))
  })

  it('treats backend and local cancellation as cancelled, not as a failure', async () => {
    const first = follow()
    first.source().send({ seq: 1, type: 'cancelled' })
    await assert.rejects(first.handle.promise, (error) => error.kind === 'cancelled')
    const second = follow()
    second.handle.close()
    await assert.rejects(second.handle.promise, (error) => error.kind === 'cancelled')
    assert.equal(second.source().closed, true)
  })
})

describe('CEL processing steps', () => {
  const uploaded = { phase: 'processing', loaded: 10, total: 10, celJob: true }

  it('keeps the real upload percentage until every byte is sent', () => {
    const steps = celJobSteps({ phase: 'uploading', loaded: 680, total: 1000, celJob: true, events: [] })
    assert.deepEqual(steps, [{ id: 'upload', label: 'Uploading patient data', state: 'active', detail: '68% sent' }])
  })

  it('waits for the server to confirm the upload before showing any processing stage', () => {
    const steps = celJobSteps({ ...uploaded, events: [] })
    assert.deepEqual(steps.map((step) => [step.label, step.state]), [
      ['Uploading patient data', 'complete'],
      ['Confirming the upload with the server', 'active'],
    ])
  })

  it('marks every reported stage complete except the latest, which stays active', () => {
    const steps = celJobSteps({
      ...uploaded,
      events: [stage(1, 'received'), stage(2, 'queued'), stage(3, 'preprocessing_started'), stage(4, 'mas5_background')],
    })
    assert.deepEqual(steps.map((step) => [step.label, step.state]), [
      ['Uploading patient data', 'complete'],
      ['File received by the server', 'complete'],
      ['Waiting for a preprocessing slot', 'complete'],
      ['Starting R preprocessing', 'complete'],
      ['Applying MAS5 background correction', 'active'],
    ])
    assert.equal(activeStep(steps).label, 'Applying MAS5 background correction')
  })

  it('shows the queue as the active stage until the backend reports that processing started', () => {
    const steps = celJobSteps({ ...uploaded, events: [stage(1, 'received'), stage(2, 'sending_to_preprocessor'), stage(3, 'queued')] })
    assert.equal(activeStep(steps).label, 'Waiting for a preprocessing slot')
    assert.ok(!steps.some((step) => step.label === 'Reading CEL data'))
  })

  it('shows completion only after result_ready, then loading the result', () => {
    const events = [stage(1, 'predicting'), stage(2, 'preparing_results')]
    assert.equal(activeStep(celJobSteps({ ...uploaded, events })).label, 'Preparing your results')
    const done = celJobSteps({ ...uploaded, events: [...events, { seq: 3, type: 'result_ready' }], fetchingResult: true })
    assert.deepEqual(done.slice(-3).map((step) => [step.label, step.state]), [
      ['Preparing your results', 'complete'],
      ['Prediction completed', 'complete'],
      ['Loading your results', 'active'],
    ])
  })

  it('ignores unknown stage names and has a label for every backend stage', () => {
    const steps = celJobSteps({ ...uploaded, events: [stage(1, 'received'), stage(2, 'something_else')] })
    assert.equal(steps.length, 2)
    const backend = readFileSync(fileURLToPath(new URL('../../backend/main.py', import.meta.url)), 'utf8')
    for (const name of ['received', 'validating_file', 'sending_to_preprocessor', 'mas5_unstaged', 'validating_expression', 'predicting', 'preparing_results']) {
      assert.ok(backend.includes(`"${name}"`), name)
      assert.ok(CEL_STAGE_LABELS[name], name)
    }
    for (const name of ['queued', 'preprocessing_started', 'loading_affy', 'reading_cel', 'mas5_background', 'mas5_summaries', 'extracting', 'exporting']) {
      assert.ok(CEL_STAGE_LABELS[name], name)
    }
  })

  it('keeps the existing single-request behaviour for CSV and older CEL backends', () => {
    assert.equal(analysisSteps('cel', { phase: 'processing', loaded: 1, total: 1 })[1].label, 'Preprocessing the CEL file (MAS5) and running the model')
    assert.equal(analysisSteps('csv', { phase: 'processing', loaded: 1, total: 1 })[1].label, 'Reading the file and running the batch prediction')
  })

  it('progress modules contain no timers, so stages cannot advance on their own', () => {
    const progressSource = readFileSync(fileURLToPath(new URL('./analysisProgress.js', import.meta.url)), 'utf8')
    assert.doesNotMatch(progressSource, /setTimeout|setInterval|requestAnimationFrame/)
    const followerSource = readFileSync(fileURLToPath(new URL('./celJob.js', import.meta.url)), 'utf8')
    // The follower's only timers are the reconnect back-off and the give-up limit.
    assert.equal((followerSource.match(/setTimer\(/g) || []).length, 2)
  })
})

describe('CEL processing overlay', () => {
  let vite
  let AnalysisLoadingOverlay
  let isMissingCelJobRoute

  before(async () => {
    const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
    vite = await createServer({ root: frontendRoot, configFile: `${frontendRoot}/vite.config.js`, server: { middlewareMode: true }, appType: 'custom' })
    AnalysisLoadingOverlay = (await vite.ssrLoadModule('/src/components/AnalysisLoadingOverlay.jsx')).default
    isMissingCelJobRoute = (await vite.ssrLoadModule('/src/api.js')).isMissingCelJobRoute
  })

  after(async () => {
    await vite?.close()
  })

  const render = (progress, onCancel) => renderToStaticMarkup(React.createElement(AnalysisLoadingOverlay, { mode: 'cel', progress, onCancel }))

  it('still shows only the upload percentage while uploading', () => {
    const markup = render({ phase: 'uploading', loaded: 34, total: 50, celJob: true, events: [] })
    assert.match(markup, /68% sent/)
    assert.doesNotMatch(markup, /MAS5|Reading CEL data|Cancel analysis/)
  })

  it('shows the current backend stage prominently with completed stages checked', () => {
    const markup = render({
      phase: 'processing', loaded: 1, total: 1, celJob: true, jobId: 'j',
      events: [stage(1, 'received'), stage(2, 'reading_cel'), stage(3, 'mas5_summaries')],
    }, () => {})
    assert.match(markup, /role="status"[^>]*>Computing MAS5 expression values…/)
    assert.equal((markup.match(/text-emerald-700/g) || []).length, 3)
    assert.equal((markup.match(/stage-active-dot/g) || []).length, 1)
    assert.match(markup, /dna-loader--large/)
    assert.match(markup, /Cancel analysis/)
    assert.doesNotMatch(markup, /\d+%/)
  })

  it('says it is reconnecting without implying the analysis failed', () => {
    const markup = render({ phase: 'processing', loaded: 1, total: 1, celJob: true, connection: 'reconnecting', events: [stage(1, 'mas5_background')] })
    assert.match(markup, /Reconnecting; your analysis continues on the server/)
    assert.match(markup, /Applying MAS5 background correction…/)
  })

  it('recognises an API without the job endpoint, but not an unknown model', () => {
    assert.equal(isMissingCelJobRoute({ response: { status: 404, data: { detail: 'Not Found' } } }), true)
    assert.equal(isMissingCelJobRoute({ response: { status: 404, data: { detail: 'Model not found' } } }), false)
    assert.equal(isMissingCelJobRoute({ response: { status: 503, data: { detail: 'Not Found' } } }), false)
  })
})
