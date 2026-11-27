// Follows a CEL analysis job's server-sent events (GET /predict_cel_jobs/{id}/events).
//
// Every status shown to the user comes from an event the backend sent; nothing here
// advances a stage on its own. EventSource reconnects by itself after a network blip and
// sends Last-Event-ID, so the server replays only missed events. If the browser gives up
// (readyState CLOSED), a new EventSource is opened with ?after=<last seq>. The job is
// never re-submitted, so a reconnect can't start a duplicate prediction.

const TERMINAL = new Set(['result_ready', 'error', 'cancelled'])
const CONNECTING = 0
const CLOSED = 2

export class CelJobError extends Error {
  constructor(message, { status = null, kind = 'error' } = {}) {
    super(message)
    this.name = 'CelJobError'
    this.status = status
    this.kind = kind // 'error' | 'cancelled' | 'connection'
  }
}

export const CONNECTION_LOST_MESSAGE =
  'We lost the connection to the server while your file was being processed. Check your connection and run the analysis again.'

export function celJobEventsUrl(apiBase, jobId, after = 0) {
  const base = `${String(apiBase).replace(/\/+$/, '')}/predict_cel_jobs/${encodeURIComponent(jobId)}/events`
  return after > 0 ? `${base}?after=${after}` : base
}

export function followCelJob({
  apiBase,
  jobId,
  onEvent = () => {},
  onConnectionChange = () => {},
  EventSourceImpl = globalThis.EventSource,
  maxReconnectAttempts = 3,
  reconnectGiveUpMs = 60000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let source = null
  let lastSeq = 0
  let settled = false
  let manualAttempts = 0
  let giveUpTimer = null
  let retryTimer = null
  let resolvePromise
  let rejectPromise

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  function cleanup() {
    if (giveUpTimer != null) clearTimer(giveUpTimer)
    if (retryTimer != null) clearTimer(retryTimer)
    giveUpTimer = null
    retryTimer = null
    if (source) {
      source.onmessage = null
      source.onerror = null
      source.onopen = null
      source.close()
      source = null
    }
  }

  function settle(error, value) {
    if (settled) return
    settled = true
    cleanup()
    if (error) rejectPromise(error)
    else resolvePromise(value)
  }

  function handleEvent(event) {
    if (!event || typeof event.seq !== 'number' || event.seq <= lastSeq) return // replayed duplicate
    lastSeq = event.seq
    manualAttempts = 0
    onEvent(event)
    if (!TERMINAL.has(event.type)) return
    if (event.type === 'result_ready') settle(null, event)
    else if (event.type === 'cancelled') settle(new CelJobError('The analysis was cancelled.', { status: 409, kind: 'cancelled' }))
    else settle(new CelJobError(event.detail || 'The analysis failed.', { status: event.status ?? null }))
  }

  function connect() {
    if (settled) return
    if (typeof EventSourceImpl !== 'function') {
      settle(new CelJobError('Live status updates are not supported by this browser.', { kind: 'connection' }))
      return
    }
    source = new EventSourceImpl(celJobEventsUrl(apiBase, jobId, lastSeq))
    source.onopen = () => {
      if (giveUpTimer != null) {
        clearTimer(giveUpTimer)
        giveUpTimer = null
      }
      onConnectionChange('open')
    }
    source.onmessage = (message) => {
      let event
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      handleEvent(event)
    }
    source.onerror = () => {
      if (settled) return
      onConnectionChange('reconnecting')
      if (source && source.readyState === CONNECTING) {
        // The browser is retrying on its own; stop waiting if it never comes back.
        if (giveUpTimer == null) {
          giveUpTimer = setTimer(() => settle(new CelJobError(CONNECTION_LOST_MESSAGE, { kind: 'connection' })), reconnectGiveUpMs)
        }
        return
      }
      // CLOSED: the browser stopped retrying (or the server refused the stream).
      if (source) {
        source.onmessage = null
        source.onerror = null
        source.onopen = null
        source.close()
        source = null
      }
      if (manualAttempts >= maxReconnectAttempts) {
        settle(new CelJobError(CONNECTION_LOST_MESSAGE, { kind: 'connection' }))
        return
      }
      manualAttempts += 1
      retryTimer = setTimer(() => {
        retryTimer = null
        connect()
      }, 1000 * 2 ** (manualAttempts - 1))
    }
  }

  connect()

  return {
    promise,
    close() {
      settle(new CelJobError('The analysis was cancelled.', { status: 409, kind: 'cancelled' }))
    },
    get lastSeq() {
      return lastSeq
    },
  }
}

export { CLOSED as EVENT_SOURCE_CLOSED, CONNECTING as EVENT_SOURCE_CONNECTING }
