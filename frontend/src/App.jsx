import { useEffect, useState } from 'react'
import { Braces, FileSpreadsheet } from 'lucide-react'
import { extractApiError, fetchHealth, fetchModels, predictCsv, predictJson } from './api'
import Header from './components/Header'
import ModelSelector from './components/ModelSelector'
import ErrorBanner from './components/ErrorBanner'
import JsonTab from './components/JsonTab'
import CsvTab from './components/CsvTab'
import Results from './components/Results'
import { parseExpressionInput } from './expressionInput'

export default function App() {
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [apiStatus, setApiStatus] = useState('loading')
  const [modelsLoading, setModelsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('json')
  const [jsonInput, setJsonInput] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [jsonResult, setJsonResult] = useState(null)
  const [csvResult, setCsvResult] = useState(null)

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

  async function handleJsonSubmit(event) {
    event.preventDefault()
    setError('')
    setJsonResult(null)
    setCsvResult(null)

    try {
      requireModel()
      if (!selectedMeta?.ready) {
        throw new Error(selectedMeta?.readiness_reason || 'This model is not ready for safe prediction.')
      }
      const input = parseExpressionInput(jsonInput, selectedMeta.feature_ids)
      setLoading(true)
      const result = await predictJson(selectedModel, input.expression, input.featureIds)
      setJsonResult(result)
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
  }

  function handleModelChange(name) {
    setSelectedModel(name)
    setJsonResult(null)
    setCsvResult(null)
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
              onChange={setJsonInput}
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
        <Results jsonResult={jsonResult} csvResult={csvResult} model={selectedMeta} />
      </main>
    </div>
  )
}
