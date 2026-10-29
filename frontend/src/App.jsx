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
      throw new Error('Select a model first.')
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
      setError('Select a model first.')
      setWorkflowStep('model')
      return
    }
    try {
      if (!selectedMeta?.ready) throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for predictions.')
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
        throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for predictions.')
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
      setError('Select a model first.')
      setWorkflowStep('model')
      return
    }
    if (!csvFile) {
      setError('Select a CSV or TSV file first.')
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
        throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for predictions.')
      }
      if (!csvFile) {
        throw new Error('Select a CSV or TSV file first.')
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
        throw new Error('Explanation did not match the current prediction.')
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
        throw new Error('Source file unavailable. Upload it again to explain this patient.')
      }
      if (!selectedMeta?.ready || !Array.isArray(selectedMeta.feature_ids)) {
        throw new Error('The model has no verified gene/probe schema.')
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
          throw new Error('Source file differs from these results. Run the batch prediction again.')
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
        throw new Error('Explanation did not match this batch patient.')
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
  const questionPrompt =
    selectedMeta?.predicts === 'relapse'
      ? 'Is the breast cancer associated with relapse?'
      : selectedMeta?.predicts === 'estrogen_receptor_status'
        ? 'Is the breast cancer ER positive or ER negative?'
        : 'Choose a question to continue.'

  const tabs = [
    { id: 'json', label: 'One patient', icon: Braces },
    { id: 'csv', label: 'Multiple patients', icon: FileSpreadsheet },
  ]

  return (
    <div className="min-h-screen bg-[#f4f7f8]">
      <Header apiStatus={apiStatus} model={selectedMeta} workflowStep={workflowStep} />

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-10">
        {workflowStep === 'start' && (
          <div className="space-y-10">
            <section className="max-w-3xl">
              <h2 className="font-display text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl">
                Breast Cancer Insights
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Explore important information about a breast cancer patient using their gene expression data.
              </p>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                Choose what you would like to find out, provide patient data, and view the results in a clear and easy-to-understand format.
              </p>
            </section>

            <section className="space-y-6">
              <div>
                <p className="eyebrow">Question selection</p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-950">What would you like to find out?</h3>
              </div>
              <ModelSelector
                models={models}
                selectedModel={selectedModel}
                onChange={handleModelChange}
                loading={modelsLoading}
                disabled={models.length === 0}
              />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-display text-2xl font-semibold text-slate-950">How it works</h3>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {[
                  ['01 · Choose what you want to find out', 'Select Disease Relapse or ER Status.'],
                  ['02 · Provide patient data', 'Upload the gene expression data for one patient or multiple patients.'],
                  ['03 · Review the result', 'See each patient result in plain language and review the confidence score.'],
                  ['04 · See what influenced it', 'Review the gene activity patterns that were most important in reaching the result.'],
                ].map(([heading, text]) => (
                  <div key={heading} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">{heading}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="text-xl font-semibold text-slate-950">For research and clinical support</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                This tool helps make gene expression information easier to explore and understand.
              </p>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                The results are intended to support research and clinical review. They should not be used on their own to diagnose a patient or make treatment decisions.
              </p>
            </section>
          </div>
        )}

        {workflowStep !== 'start' && workflowStep !== 'results' && workflowStep !== 'analyzing' && !explanationView && (
          <div className="space-y-8">
            <div>
              <p className="eyebrow">02 / Provide patient data</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">Add patient data</h2>
              <p className="mt-2 text-sm text-slate-600">Provide the gene expression data for the breast cancer patient you want to examine.</p>
            </div>
            <div className="workflow-track" aria-label="Analysis workflow">
              {['Question', 'Patient data', 'Results'].map((label, index) => {
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
                <div className="mb-6 border-b border-slate-200 pb-5">
                  <p className="eyebrow">02 / Provide patient data</p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-950">Add patient data</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    Provide the gene expression data for the breast cancer patient you want to examine.
                  </p>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Question we're exploring</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{selectedMeta.predicts_label || 'Selected question'}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{questionPrompt}</p>
                  </div>
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
              <div><p className="eyebrow">05 / Analysis results</p><h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">Model results</h2></div>
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
