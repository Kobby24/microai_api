import { useEffect, useReducer, useRef, useState } from 'react'
import { Braces, FileSpreadsheet } from 'lucide-react'
import { explainJson, extractApiError, fetchHealth, fetchModels, predictCsv, predictJson } from './api'
import Header from './components/Header'
import ModelSelector from './components/ModelSelector'
import ErrorBanner from './components/ErrorBanner'
import JsonTab from './components/JsonTab'
import CsvTab from './components/CsvTab'
import Results from './components/Results'
import AnalysisReviewDialog from './components/AnalysisReviewDialog'
import AnalysisLoadingOverlay from './components/AnalysisLoadingOverlay'
import PredictionExplanationPage from './components/PredictionExplanationPage'
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
  const [workflowStep, setWorkflowStep] = useState('start')
  const [pendingMode, setPendingMode] = useState(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [explanationView, setExplanationView] = useState(false)
  const [explanationTarget, setExplanationTarget] = useState(null)
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

  function handleJsonSubmit(event) {
    event.preventDefault()
    setError('')
    if (!selectedModel) {
      setError('Choose a model before reviewing the analysis.')
      setWorkflowStep('model')
      return
    }
    try {
      if (!selectedMeta?.ready) throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for safe prediction.')
      parseExpressionInput(jsonInput, selectedMeta.feature_ids)
    } catch (validationError) {
      setError(validationError.message)
      return
    }
    setPendingMode('json')
    setReviewOpen(true)
  }

  async function runJsonPrediction() {
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
      return true
    } catch (err) {
      setError(err.response || err.request ? extractApiError(err) : err.message)
      return false
    } finally {
      setLoading(false)
    }
  }

  function handleCsvSubmit(event) {
    event.preventDefault()
    setError('')
    if (!selectedModel) {
      setError('Choose a model before reviewing the analysis.')
      setWorkflowStep('model')
      return
    }
    if (!csvFile) {
      setError('Upload a .csv or .tsv file before reviewing the analysis.')
      return
    }
    setPendingMode('csv')
    setReviewOpen(true)
  }

  async function runCsvPrediction() {
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
      return true
    } catch (err) {
      setError(err.response || err.request ? extractApiError(err) : err.message)
      return false
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
    setPendingMode(null)
    setWorkflowStep(name ? 'input' : 'model')
  }

  function handleStart() {
    setWorkflowStep(selectedModel ? 'input' : 'model')
  }

  function handleBackToInput() {
    setPendingMode(null)
    setReviewOpen(false)
    setWorkflowStep('input')
  }

  async function handleRunAnalysis() {
    const mode = pendingMode
    setReviewOpen(false)
    setWorkflowStep('analyzing')
    const success = mode === 'json' ? await runJsonPrediction() : await runCsvPrediction()
    setPendingMode(null)
    setWorkflowStep(success ? 'results' : 'input')
  }

  function openSingleExplanation() {
    setExplanationTarget(jsonResult)
    setExplanationView(true)
    handleExplain()
  }

  function openBatchExplanation(row) {
    setExplanationTarget(row)
    setExplanationView(true)
    handleBatchExplain(row)
  }

  function closeExplanationView() {
    setExplanationView(false)
    setExplanationTarget(null)
    setSelectedBatchRow(null)
    resetExplanation()
  }

  const selectedMeta = models.find((model) => model.name === selectedModel) || null

  const tabs = [
    { id: 'json', label: 'Single Sample (JSON)', icon: Braces },
    { id: 'csv', label: 'Batch Predict (CSV / TSV)', icon: FileSpreadsheet },
  ]

  return (
    <div className="min-h-screen bg-[#f4f7f8]">
      <Header apiStatus={apiStatus} model={selectedMeta} workflowStep={workflowStep} />

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-10">
        {workflowStep === 'start' && (
          <section className="grid items-end gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div className="max-w-2xl">
              <p className="eyebrow">Research analysis workspace</p>
              <h2 className="mt-4 max-w-xl font-display text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl">
                Gene expression analysis, made inspectable.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
                MicroAI helps research teams run supported model predictions, review class probabilities, and investigate the features influencing each result.
              </p>
              <button
                type="button"
                onClick={handleStart}
                className="mt-8 inline-flex items-center rounded-md bg-[#123b5d] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0d2f4b] focus:outline-none focus:ring-2 focus:ring-[#123b5d]/30"
              >
                Start analysis
              </button>
              <p className="mt-4 text-xs text-slate-500">Decision support for research use. Not a standalone clinical diagnosis.</p>
            </div>
            <div className="border-l border-slate-300 pl-6 lg:mb-2">
              <p className="text-sm font-semibold text-slate-900">A focused workflow</p>
              <ol className="mt-5 space-y-5">
                {['Choose a validated model', 'Provide a single sample or batch file', 'Review the model output and its drivers'].map((item, index) => (
                  <li key={item} className="flex gap-4">
                    <span className="font-mono text-xs font-semibold text-[#2f7b78]">0{index + 1}</span>
                    <span className="text-sm leading-6 text-slate-600">{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {workflowStep !== 'start' && workflowStep !== 'results' && workflowStep !== 'analyzing' && !explanationView && (
          <div className="space-y-8">
            <div>
              <p className="eyebrow">New analysis</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">Prepare your analysis</h2>
              <p className="mt-2 text-sm text-slate-600">Choose the model and data representation that match your research question.</p>
            </div>
            <div className="workflow-track" aria-label="Analysis workflow">
              {['Model', 'Data', 'Results'].map((label, index) => {
                const step = ['model', 'input', 'results'][index]
                const active = step === workflowStep || (workflowStep === 'input' && step === 'model')
                return <span key={label} className={active ? 'workflow-step workflow-step-active' : 'workflow-step'}><b>0{index + 1}</b>{label}</span>
              })}
            </div>

            {(workflowStep === 'model' || workflowStep === 'input') && (
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onChange={handleModelChange}
                loading={modelsLoading}
                disabled={models.length === 0}
              />
            )}

            {workflowStep === 'input' && selectedMeta && (
              <section className="surface-panel p-6">
                <div className="mb-6 flex items-end justify-between gap-4 border-b border-slate-200 pb-5">
                  <div>
                    <p className="eyebrow">02 / Provide data</p>
                    <h3 className="mt-2 text-xl font-semibold text-slate-950">How would you like to analyze your data?</h3>
                  </div>
                  <p className="hidden text-right text-xs text-slate-500 sm:block">Model: {selectedMeta.display_name || selectedMeta.name}</p>
                </div>
                <div className="flex border-b border-slate-200">
                  {tabs.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" onClick={() => setActiveTab(id)} className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition ${activeTab === id ? 'border-[#2f7b78] text-[#1f5f5c]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                      <Icon className="h-4 w-4" />{label}
                    </button>
                  ))}
                </div>
                <div className="pt-6">
                  {activeTab === 'json' ? <JsonTab value={jsonInput} onChange={handleJsonInputChange} sampleId={sampleId} onSampleIdChange={handleSampleIdChange} onSubmit={handleJsonSubmit} loading={loading} disabled={loading || !selectedMeta?.ready} model={selectedMeta} /> : <CsvTab file={csvFile} onFileChange={handleCsvFileChange} isDragging={isDragging} onDragState={setIsDragging} onSubmit={handleCsvSubmit} loading={loading} disabled={loading || !selectedMeta?.ready} model={selectedMeta} />}
                </div>
              </section>
            )}

          </div>
        )}

        <ErrorBanner message={error} />

        {explanationView && (
          <PredictionExplanationPage
            prediction={explanationTarget}
            model={selectedMeta}
            explanation={explanationState.result}
            loading={explanationState.status === 'loading'}
            error={explanationState.error}
            onRetry={explanationTarget?.sample_index != null ? () => handleBatchExplain(explanationTarget) : handleExplain}
            onBack={closeExplanationView}
          />
        )}

        {(workflowStep === 'results' || jsonResult || csvResult) && !loading && !explanationView && (
          <div className="mt-8">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div><p className="eyebrow">05 / Analysis results</p><h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">Review model outputs</h2></div>
              <button type="button" onClick={() => { setWorkflowStep('input'); setJsonResult(null); setCsvResult(null); resetBatchSelection(); resetExplanation() }} className="text-sm font-semibold text-[#1f5f5c] hover:underline">Start another analysis</button>
            </div>
            <Results jsonResult={jsonResult} csvResult={csvResult} model={selectedMeta} onExplain={handleExplain} onOpenExplanation={openSingleExplanation} onOpenBatchExplanation={openBatchExplanation} explaining={explanationState.status === 'loading'} explanation={explanationState.result} explanationError={explanationState.error} selectedBatchRow={selectedBatchRow} onExplainBatch={handleBatchExplain} onCloseBatchExplanation={handleCloseBatchExplanation} />
          </div>
        )}
      </main>
      {reviewOpen && <AnalysisReviewDialog model={selectedMeta} mode={pendingMode} file={csvFile} sampleId={sampleId} onCancel={handleBackToInput} onConfirm={handleRunAnalysis} />}
      {loading && <AnalysisLoadingOverlay mode={pendingMode} />}
    </div>
  )
}
