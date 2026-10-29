import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const prediction = {
  prediction: '1',
  probability: 0.8,
  sample_id: 'sample-001',
  class_probabilities: { '0': 0.2, '1': 0.8 },
}
const model = {
  name: 'gse7390',
  display_name: 'GSE7390',
  predicts: 'estrogen_receptor_status',
  predicts_label: 'Estrogen receptor status',
  ready: true,
  classes: ['0', '1'],
  label_meanings: { '0': 'ER-negative', '1': 'ER-positive' },
}
const explanation = {
  model_name: 'gse7390',
  prediction: '1',
  prediction_label: 'ER-positive',
  explained_class: '1',
  explained_class_label: 'ER-positive',
  class_probabilities: { '0': 0.2, '1': 0.8 },
  output: 'calibrated_class_probability',
  base_value: 0.4,
  predicted_output: 0.8,
  summary: 'The model predicts ER-positive. The strongest SHAP contributions toward this class came from TP53 and probe-negative.',
  drivers: [
    {
      feature_id: 'probe-positive',
      gene_symbol: 'TP53',
      raw_input_value: 4.2,
      model_input_value: 0.7,
      expression_level: 'about typical',
      direction: 'toward_explained_class',
      shap_value: 0.3,
      relative_influence_percent: 75,
    },
    {
      feature_id: 'probe-negative',
      raw_input_value: 1.8,
      model_input_value: -0.2,
      expression_level: 'about typical',
      direction: 'away_from_explained_class',
      shap_value: -0.1,
      relative_influence_percent: 25,
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      feature_id: `probe-other-${index + 1}`,
      raw_input_value: 2,
      model_input_value: 0.1,
      expression_level: 'about typical',
      direction: 'toward_explained_class',
      shap_value: 0.033,
    })),
  ],
  features: [
    { feature_id: 'probe-positive', gene_symbol: 'TP53', raw_input_value: 4.2, model_input_value: 0.7, expression_level: 'about typical', direction: 'toward_explained_class', relative_influence_percent: 75, shap_value: 0.3 },
    { feature_id: 'probe-negative', raw_input_value: 1.8, model_input_value: -0.2, expression_level: 'about typical', direction: 'away_from_explained_class', relative_influence_percent: 25, shap_value: -0.1 },
    ...Array.from({ length: 6 }, (_, index) => ({
      feature_id: `probe-other-${index + 1}`,
      raw_input_value: 2,
      model_input_value: 0.1,
      expression_level: 'about typical',
      direction: 'toward_explained_class',
      shap_value: 0.033,
      relative_influence_percent: 1,
    })),
    { feature_id: 'probe-remainder', raw_input_value: 2, model_input_value: 0.1, expression_level: 'about typical', direction: 'toward_explained_class', shap_value: 0.002 },
  ],
  metadata: {
    method: 'shap_permutation',
    explained_feature_space: 'selected_standardized_features',
    background_samples: 50,
    max_evals: 1000,
    additivity_residual: 0,
    additivity_tolerance: 0.01,
    additivity_verified: true,
    preprocessing_scope_note: 'Selected-feature-space explanation only.',
  },
}

let vite
let Results
let AnalysisReviewDialog
let AnalysisLoadingOverlay
let PredictionExplanationPage
let DnaLoader
let Header
let ModelSelector
let JsonTab
let CsvTab

before(async () => {
  vite = await createServer({
    root: frontendRoot,
    configFile: `${frontendRoot}/vite.config.js`,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  Results = (await vite.ssrLoadModule('/src/components/Results.jsx')).default
  AnalysisReviewDialog = (await vite.ssrLoadModule('/src/components/AnalysisReviewDialog.jsx')).default
  AnalysisLoadingOverlay = (await vite.ssrLoadModule('/src/components/AnalysisLoadingOverlay.jsx')).default
  PredictionExplanationPage = (await vite.ssrLoadModule('/src/components/PredictionExplanationPage.jsx')).default
  DnaLoader = (await vite.ssrLoadModule('/src/components/ui/DnaLoader.jsx')).default
  Header = (await vite.ssrLoadModule('/src/components/Header.jsx')).default
  ModelSelector = (await vite.ssrLoadModule('/src/components/ModelSelector.jsx')).default
  JsonTab = (await vite.ssrLoadModule('/src/components/JsonTab.jsx')).default
  CsvTab = (await vite.ssrLoadModule('/src/components/CsvTab.jsx')).default
})

after(async () => {
  await vite?.close()
})

function renderResults(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(Results, {
      jsonResult: prediction,
      csvResult: null,
      model,
      onExplain: () => {},
      explaining: false,
      explanation: null,
      explanationError: '',
      ...overrides,
    }),
  )
}

describe('SHAP explanation UI', () => {
  it('shows an explicit explain action after a single-sample prediction', () => {
    const markup = renderResults()
    assert.match(markup, /Understand result/)
    assert.match(markup, /How strongly does the system support this result\?/) 
    assert.match(markup, /Patient ID:.*sample-001/)
    assert.doesNotMatch(markup, /Show technical details/)
  })

  it('renders a GSE2034 explanation with its own model and class labels', () => {
    const gse2034Model = {
      ...model,
      name: 'gse2034',
      display_name: 'GSE2034',
      predicts: 'relapse',
      predicts_label: 'Disease relapse',
      label_meanings: { '0': 'No relapse (False)', '1': 'Relapse (True)' },
    }
    const gse2034Explanation = {
      ...explanation,
      model_name: 'gse2034',
      explained_class_label: 'Relapse (True)',
    }
    const markup = renderResults({ model: gse2034Model, explanation: gse2034Explanation })

    assert.match(markup, /Relapse \(True\)/)
  })

  it('does not show an Explain action without a valid single prediction', () => {
    const markup = renderResults({ jsonResult: null })
    assert.doesNotMatch(markup, /Understand result/)
  })

  it('shows an accessible loading state without removing the prediction', () => {
    const markup = renderResults({ explaining: true })
    assert.match(markup, /Loading explanation/)
    assert.match(markup, /Reviewing the gene activity patterns that influenced this result/)
    assert.match(markup, /dna-loader--small/)
    assert.match(markup, /Model confidence/)
  })

  it('keeps question-first plain-language guidance while exposing technical details in the researcher section', () => {
    const markup = renderResults({ explanation })
    assert.match(markup, /What influenced this result\?/) 
    assert.match(markup, /Gene activity patterns/)
    assert.match(markup, /Technical explanation for researchers/)
    assert.match(markup, /Technical details/)
    assert.match(markup, /TP53/)
    assert.doesNotMatch(markup, /Cumulative SHAP waterfall/)
    assert.doesNotMatch(markup, /Understand result/)
  })

  it('shows an explanation error while keeping the prediction available', () => {
    const markup = renderResults({ explanationError: 'Reference data unavailable.', explaining: true })
    assert.match(markup, /We couldn&#x27;t load this explanation\./)
    assert.match(markup, /Reference data unavailable/)
    assert.match(markup, /Retrying/)
    assert.match(markup, /dna-loader--small/)
    assert.match(markup, /Model confidence/)
  })

  it('shows honest empty states when explanation probabilities and baseline are missing', () => {
    const incompleteExplanation = {
      ...explanation,
      class_probabilities: { '0': null, '1': null },
      base_value: null,
      predicted_output: null,
      drivers: [],
      features: [],
    }
    const markup = renderResults({ explanation: incompleteExplanation })

    assert.match(markup, /Model confidence/)
    assert.match(markup, /No valid gene activity patterns returned/)
    assert.doesNotMatch(markup, /Cumulative SHAP waterfall/)
    assert.doesNotMatch(markup, /Reference-background baseline.*0\.0%/)
  })

  it('keeps batch results outside the single-sample explanation flow', () => {
    const markup = renderResults({ jsonResult: null, csvResult: { samples_processed: 0, results: [] } })
    assert.doesNotMatch(markup, /Understand result/)
  })

  it('offers an explanation action for every batch result, including later samples', () => {
    const results = Array.from({ length: 12 }, (_, sample_index) => ({
      sample_index,
      prediction: sample_index % 2 ? '1' : '0',
      probability: 0.75,
      class_probabilities: { '0': 0.25, '1': 0.75 },
    }))
    const markup = renderResults({
      jsonResult: null,
      csvResult: { samples_processed: results.length, filename: 'patients.csv', results },
    })

    assert.equal((markup.match(/aria-label="Understand result for /g) || []).length, results.length)
    assert.match(markup, /aria-label="Understand result for Patient 11"/)
    assert.doesNotMatch(markup, /showing the first 10/)
  })

  it('shows selected sample prediction details, explanation, and an accessible back action', () => {
    const row = {
      sample_index: 4,
      prediction: '1',
      probability: 0.8,
      class_probabilities: { '0': 0.2, '1': 0.8 },
    }
    const markup = renderResults({
      jsonResult: null,
      csvResult: { samples_processed: 1, filename: 'patients.csv', results: [row] },
      selectedBatchRow: row,
      explanation,
    })

    assert.match(markup, /Prediction details/)
    assert.match(markup, /Patient 4/)
    assert.match(markup, /Model confidence/)
    assert.match(markup, /The strongest gene activity patterns supporting this result/)
    assert.match(markup, /Technical details/)
    assert.match(markup, /Back to results/)
  })

  it('keeps selected batch predictions visible during explanation loading and errors', () => {
    const row = {
      sample_index: 0,
      prediction: '1',
      probability: 0.8,
      class_probabilities: { '0': 0.2, '1': 0.8 },
    }
    const loadingMarkup = renderResults({
      jsonResult: null,
      csvResult: { samples_processed: 1, filename: 'patients.csv', results: [row] },
      selectedBatchRow: row,
      explaining: true,
    })
    const errorMarkup = renderResults({
      jsonResult: null,
      csvResult: { samples_processed: 1, filename: 'patients.csv', results: [row] },
      selectedBatchRow: row,
      explanationError: 'Source mapping unavailable.',
    })

    assert.match(loadingMarkup, /Reviewing the gene activity patterns that influenced this result/)
    assert.match(loadingMarkup, /ER-negative/)
    assert.match(errorMarkup, /We couldn&#x27;t load this explanation\./)
    assert.match(errorMarkup, /Source mapping unavailable/)
    assert.match(errorMarkup, /Try again/)
  })
})

describe('analysis workflow surfaces', () => {
  it('uses the DNA loader for API/model discovery and both prediction buttons', () => {
    const header = renderToStaticMarkup(
      React.createElement(Header, { apiStatus: 'loading', model: null, workflowStep: 'start' }),
    )
    const selector = renderToStaticMarkup(
      React.createElement(ModelSelector, {
        models: [],
        selectedModel: '',
        onChange: () => {},
        loading: true,
        disabled: false,
      }),
    )
    const jsonTab = renderToStaticMarkup(
      React.createElement(JsonTab, {
        value: '[]',
        onChange: () => {},
        sampleId: '',
        onSampleIdChange: () => {},
        onSubmit: () => {},
        loading: true,
        disabled: false,
        model,
      }),
    )
    const csvTab = renderToStaticMarkup(
      React.createElement(CsvTab, {
        file: null,
        onFileChange: () => {},
        isDragging: false,
        onDragState: () => {},
        onSubmit: () => {},
        loading: true,
        disabled: false,
        model,
      }),
    )

    assert.match(header, /Checking API connection/)
    assert.match(selector, /Loading questions/)
    assert.match(jsonTab, /Reviewing patient data/)
    assert.match(csvTab, /Reviewing patient data/)
    for (const markup of [header, selector, jsonTab, csvTab]) {
      assert.match(markup, /dna-loader--small/)
      assert.doesNotMatch(markup, /animate-spin/)
    }
  })

  it('renders the reusable accessible DNA loader with twelve decorative rungs', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DnaLoader, { size: 'small', label: 'Loading models' }),
    )

    assert.match(markup, /role="status"/)
    assert.match(markup, /Loading models/)
    assert.equal((markup.match(/dna-loader__rung/g) || []).length, 12)
  })

  it('renders review metadata without exposing the full input', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisReviewDialog, {
        model,
        mode: 'csv',
        file: { name: 'patients.csv' },
        onCancel: () => {},
        onConfirm: () => {},
      }),
    )
    assert.match(markup, /Review patient data/)
    assert.match(markup, /patients\.csv/)
    assert.match(markup, /File type/)
    assert.match(markup, /Continue/)
    assert.doesNotMatch(markup, /expression map|feature_id/) 
  })

  it('renders truthful indeterminate analysis progress', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AnalysisLoadingOverlay, { mode: 'json' }),
    )
    assert.match(markup, /Running analysis/)
    assert.match(markup, /Validate data/)
    assert.match(markup, /Run model/)
    assert.match(markup, /dna-loader--large/)
    assert.doesNotMatch(markup, /dna-loader--small/)
    assert.match(markup, /indeterminate-bar/)
    assert.doesNotMatch(markup, /animate-spin/)
    assert.doesNotMatch(markup, /10%|50%|100%/)
  })

  it('renders the dedicated explanation page and preserves an unavailable state', () => {
    const markup = renderToStaticMarkup(
      React.createElement(PredictionExplanationPage, {
        prediction,
        model,
        explanation: null,
        loading: true,
        error: '',
        onRetry: () => {},
        onBack: () => {},
      }),
    )
    assert.match(markup, /Understanding this patient&#x27;s result|Understanding this patient's result/)
    assert.match(markup, /sample-001/)
    assert.match(markup, /How strongly does the system support this result\?/) 
    assert.match(markup, /Loading explanation/)
    assert.match(markup, /dna-loader--small/)

    const unavailable = renderToStaticMarkup(
      React.createElement(PredictionExplanationPage, {
        prediction: null,
        model,
        explanation: null,
        loading: false,
        error: '',
        onRetry: () => {},
        onBack: () => {},
      }),
    )
    assert.match(unavailable, /No prediction available/)
    assert.match(unavailable, /Back to analysis/)
  })
})
