import { useEffect, useReducer, useRef, useState } from 'react'
import { Braces, FileSpreadsheet } from 'lucide-react'
import { explainJson, extractApiError, fetchHealth, fetchModels, predictCsv, predictJson } from './api'
import Header from './components/Header'
import ModelSelector from './components/ModelSelector'
import ErrorBanner from './components/ErrorBanner'
import JsonTab from './components/JsonTab'
import CsvTab from './components/CsvTab'
import Results from './components/Results'
import { parseExpressionInput } from './expressionInput'
import { canStartExplanation, explanationReducer, initialExplanationState } from './explanationState'
import { isExplanationForPrediction } from './xaiPresentation'

export default function App() {
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [apiStatus, setApiStatus] = useState('loading')
  const [modelsLoading, setModelsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('json')
  const [jsonInput, setJsonInput] = useState('')
  const [sampleId, setSampleId] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [jsonResult, setJsonResult] = useState(null)
  const [csvResult, setCsvResult] = useState(null)
  const [jsonRequest, setJsonRequest] = useState(null)
  const [explanationState, dispatchExplanation] = useReducer(
    explanationReducer,
    initialExplanationState,
  )
  const explanationRequestId = useRef(0)
  const explanationAbortController = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function loadModels() {
      setModelsLoading(true)
      try {
        let loaded = []
        try {
          loaded = await fetchModels()
        } catch (err) {
          if (err.response?.status !== 404) throw err
          const health = await fetchHealth()
          loaded = (health.loaded_models || []).map((name) => ({
            name,
            display_name: name.toUpperCase(),
            predicts: '',
            predicts_label: '',
            expected_genes: null,
            feature_ids: null,
            ready: false,
            readiness_reason: 'The API did not provide a verified model schema.',
            label_meanings: {},
          }))
        }
        if (cancelled) return
        setModels(loaded)
        setApiStatus('ok')
        if (loaded.length === 1) {
          setSelectedModel(loaded[0].name)
        }
      } catch (err) {
        if (cancelled) return
        setModels([])
        setApiStatus('error')
        setError(extractApiError(err))
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    }

    loadModels()
    return () => {
      cancelled = true
    }
  }, [])

  function requireModel() {
    if (!selectedModel) {
      throw new Error('Select a model before running a prediction.')
    }
  }

  function resetExplanation() {
    explanationRequestId.current += 1
    explanationAbortController.current?.abort()
    explanationAbortController.current = null
    dispatchExplanation({ type: 'reset' })
  }

  async function handleJsonSubmit(event) {
    event.preventDefault()
    setError('')
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetExplanation()

    try {
      requireModel()
      if (!selectedMeta?.ready) {
        throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for safe prediction.')
      }
      const input = parseExpressionInput(jsonInput, selectedMeta.feature_ids)
      setLoading(true)
      const result = await predictJson(selectedModel, input.expression, input.featureIds, sampleId)
      setJsonResult(result)
      setJsonRequest({ ...input, sampleId: sampleId.trim() })
    } catch (err) {
      setError(err.response || err.request ? extractApiError(err) : err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCsvSubmit(event) {
    event.preventDefault()
    setError('')
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetExplanation()

    try {
      requireModel()
      if (!selectedMeta?.ready) {
        throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for safe prediction.')
      }
      if (!csvFile) {
        throw new Error('Upload a .csv or .tsv file before running a batch prediction.')
      }
      setLoading(true)
      const result = await predictCsv(selectedModel, csvFile)
      setCsvResult(result)
    } catch (err) {
      setError(err.response || err.request ? extractApiError(err) : err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCsvFileChange(file, fileError) {
    setCsvFile(file)
    setError(fileError || '')
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetExplanation()
  }

  function handleJsonInputChange(value) {
    setJsonInput(value)
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetExplanation()
  }

  function handleSampleIdChange(value) {
    setSampleId(value)
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetExplanation()
  }

  async function handleExplain() {
    if (!canStartExplanation({
      hasRequest: Boolean(jsonRequest),
      hasPrediction: Boolean(jsonResult),
      modelReady: Boolean(selectedMeta?.ready),
      status: explanationState.status,
      inFlight: Boolean(explanationAbortController.current),
    })) return

    const requestId = explanationRequestId.current + 1
    explanationRequestId.current = requestId
    const abortController = new AbortController()
    explanationAbortController.current = abortController
    dispatchExplanation({ type: 'start', requestId })
    try {
      const result = await explainJson(
        selectedModel,
        jsonRequest.expression,
        jsonRequest.featureIds,
        undefined,
        abortController.signal,
        jsonRequest.sampleId,
      )
      if (!isExplanationForPrediction(result, selectedMeta, jsonResult)) {
        throw new Error('The explanation response did not match the current prediction.')
      }
      if (requestId !== explanationRequestId.current) return
      dispatchExplanation({ type: 'success', requestId, result })
    } catch (err) {
      if (requestId !== explanationRequestId.current || abortController.signal.aborted) return
      dispatchExplanation({
        type: 'failure',
        requestId,
        error: err.response || err.request ? extractApiError(err) : err.message,
      })
    } finally {
      if (explanationAbortController.current === abortController) {
        explanationAbortController.current = null
      }
    }
  }

  function handleModelChange(name) {
    setSelectedModel(name)
    setCsvFile(null)
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetExplanation()
    setError('')
  }

  const selectedMeta = models.find((model) => model.name === selectedModel) || null

  const tabs = [
    { id: 'json', label: 'Single Sample (JSON)', icon: Braces },
    { id: 'csv', label: 'Batch Predict (CSV / TSV)', icon: FileSpreadsheet },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <Header apiStatus={apiStatus} />

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <ModelSelector
          models={models}
          selectedModel={selectedModel}
          onChange={handleModelChange}
          loading={modelsLoading}
          disabled={models.length === 0}
        />

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex border-b border-slate-200">
            {tabs.map(({ id, label, icon: Icon }) => {
              const selected = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                    selected
                      ? 'border-blue-700 text-blue-800'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              )
            })}
          </div>

          {activeTab === 'json' ? (
            <JsonTab
              value={jsonInput}
              onChange={handleJsonInputChange}
              sampleId={sampleId}
              onSampleIdChange={handleSampleIdChange}
              onSubmit={handleJsonSubmit}
              loading={loading}
              disabled={loading || !selectedMeta?.ready}
              model={selectedMeta}
            />
          ) : (
            <CsvTab
              file={csvFile}
              onFileChange={handleCsvFileChange}
              isDragging={isDragging}
              onDragState={setIsDragging}
              onSubmit={handleCsvSubmit}
              loading={loading}
              disabled={loading || !selectedMeta?.ready}
              model={selectedMeta}
            />
          )}
        </section>

        <ErrorBanner message={error} />
        <Results
          jsonResult={jsonResult}
          csvResult={csvResult}
          model={selectedMeta}
          onExplain={handleExplain}
          explaining={explanationState.status === 'loading'}
          explanation={explanationState.result}
          explanationError={explanationState.error}
        />
      </main>
    </div>
  )
}
