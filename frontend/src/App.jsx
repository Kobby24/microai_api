import { useEffect, useReducer, useRef, useState } from 'react'
import { Braces, FileSpreadsheet } from 'lucide-react'
import { explainJson, extractApiError, fetchHealth, fetchModels, predictCsv, predictJson } from './api'
import Header from './components/Header'
import ModelSelector from './components/ModelSelector'
import ErrorBanner from './components/ErrorBanner'
import JsonTab from './components/JsonTab'
import CsvTab from './components/CsvTab'
import Results from './components/Results'
import { batchSamplePayload, parseBatchExpressionText } from './batchFile'
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
  const [selectedBatchRow, setSelectedBatchRow] = useState(null)
  const [explanationState, dispatchExplanation] = useReducer(
    explanationReducer,
    initialExplanationState,
  )
  const explanationRequestId = useRef(0)
  const explanationAbortController = useRef(null)
  const batchSourceRef = useRef(null)
  const batchRequestKeyRef = useRef(null)

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
    batchRequestKeyRef.current = null
    dispatchExplanation({ type: 'reset' })
  }

  function resetBatchSelection() {
    setSelectedBatchRow(null)
    batchSourceRef.current = null
    batchRequestKeyRef.current = null
  }

  async function handleJsonSubmit(event) {
    event.preventDefault()
    setError('')
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetBatchSelection()
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
    resetBatchSelection()
    resetExplanation()

    try {
      requireModel()
      if (!selectedMeta?.ready) {
        throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for safe prediction.')
      }
      if (!csvFile) {
        throw new Error('Upload a .csv or .tsv file before running a batch prediction.')
      }
      batchSourceRef.current = null
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
    resetBatchSelection()
    resetExplanation()
    setError(fileError || '')
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
  }

  function handleJsonInputChange(value) {
    setJsonInput(value)
    resetBatchSelection()
    setJsonResult(null)
    setCsvResult(null)
    setJsonRequest(null)
    resetExplanation()
  }

  function handleSampleIdChange(value) {
    setSampleId(value)
    resetBatchSelection()
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

  async function handleBatchExplain(row) {
    const requestKey = `${selectedModel}:${row?.sample_index}`
    setSelectedBatchRow(row)
    if (batchRequestKeyRef.current === requestKey) return

    explanationRequestId.current += 1
    const requestId = explanationRequestId.current
    explanationAbortController.current?.abort()
    const abortController = new AbortController()
    explanationAbortController.current = abortController
    batchRequestKeyRef.current = requestKey
    dispatchExplanation({ type: 'start', requestId })

    try {
      if (!csvFile) {
        throw new Error('The uploaded source file is no longer available. Upload it again to explain a sample.')
      }
      if (!selectedMeta?.ready || !Array.isArray(selectedMeta.feature_ids)) {
        throw new Error('The selected model does not have a verified gene/probe input schema.')
      }

      let source = batchSourceRef.current
      if (source?.file !== csvFile || source.modelName !== selectedModel) {
        const text = await csvFile.text()
        if (requestId !== explanationRequestId.current) return
        const parsed = parseBatchExpressionText(text, csvFile.name, selectedMeta.feature_ids)
        if (
          parsed.samples.length !== csvResult?.samples_processed
          || parsed.samples.length !== csvResult?.results?.length
        ) {
          throw new Error('The uploaded file no longer matches the batch results. Run the batch prediction again.')
        }
        source = {
          file: csvFile,
          modelName: selectedModel,
          parsed,
          explanations: new Map(),
        }
        batchSourceRef.current = source
      }

      const payload = batchSamplePayload(source.parsed, row)
      if (source.explanations.has(row.sample_index)) {
        dispatchExplanation({
          type: 'success',
          requestId,
          result: source.explanations.get(row.sample_index),
        })
        return
      }

      const result = await explainJson(
        selectedModel,
        payload.expression,
        payload.featureIds,
        undefined,
        abortController.signal,
        payload.sampleId,
      )
      if (
        !isExplanationForPrediction(result, selectedMeta, row)
        || (result.sample_id != null && String(result.sample_id) !== String(payload.sampleId ?? ''))
      ) {
        throw new Error('The explanation response did not match the selected batch sample.')
      }
      if (requestId !== explanationRequestId.current) return
      source.explanations.set(row.sample_index, result)
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
        batchRequestKeyRef.current = null
      }
    }
  }

  function handleCloseBatchExplanation() {
    setSelectedBatchRow(null)
  }

  function handleModelChange(name) {
    setSelectedModel(name)
    setCsvFile(null)
    resetBatchSelection()
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
          selectedBatchRow={selectedBatchRow}
          onExplainBatch={handleBatchExplain}
          onCloseBatchExplanation={handleCloseBatchExplanation}
        />
      </main>
    </div>
  )
}
