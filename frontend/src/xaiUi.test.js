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
  ],
  features: [
    { feature_id: 'probe-positive', gene_symbol: 'TP53', raw_input_value: 4.2, model_input_value: 0.7, expression_level: 'about typical', direction: 'toward_explained_class', relative_influence_percent: 75, shap_value: 0.3 },
    { feature_id: 'probe-negative', raw_input_value: 1.8, model_input_value: -0.2, expression_level: 'about typical', direction: 'away_from_explained_class', relative_influence_percent: 25, shap_value: -0.1 },
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

before(async () => {
  vite = await createServer({
    root: frontendRoot,
    configFile: `${frontendRoot}/vite.config.js`,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  Results = (await vite.ssrLoadModule('/src/components/Results.jsx')).default
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
    assert.match(markup, /Explain prediction/)
    assert.match(markup, /Class probabilities/)
    assert.match(markup, /Sample ID:.*sample-001/)
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

    assert.match(markup, /GSE2034/)
    assert.match(markup, /Relapse \(True\)/)
    assert.doesNotMatch(markup, /GSE7390/)
  })

  it('does not show an Explain action without a valid single prediction', () => {
    const markup = renderResults({ jsonResult: null })
    assert.doesNotMatch(markup, /Explain prediction/)
  })

  it('shows an accessible loading state without removing the prediction', () => {
    const markup = renderResults({ explaining: true })
    assert.match(markup, /Explaining prediction/)
    assert.match(markup, /Calculating a local explanation/)
    assert.match(markup, /Class probabilities/)
  })

  it('renders positive and negative contributors and selected-feature scope', () => {
    const markup = renderResults({ explanation })
    assert.match(markup, /TP53/)
    assert.match(markup, /probe-positive/)
    assert.match(markup, /probe-negative/)
    assert.match(markup, /Toward ER-positive/)
    assert.match(markup, /Toward ER-negative/)
    assert.match(markup, /Show technical details/)
    assert.match(markup, /0\.3000/)
    assert.match(markup, /Reference-background baseline/)
    assert.match(markup, /model evidence, not as an independent clinical diagnosis/)
    assert.match(markup, /Selected-feature-space explanation only/)
    assert.match(markup, /Additivity verified/)
    assert.match(markup, /sm:grid-cols/)
    assert.doesNotMatch(markup, /Explain prediction/)
  })

  it('shows an explanation error while keeping the prediction available', () => {
    const markup = renderResults({ explanationError: 'Reference data unavailable.' })
    assert.match(markup, /Explanation unavailable/)
    assert.match(markup, /Reference data unavailable/)
    assert.match(markup, /Try again/)
    assert.match(markup, /Class probabilities/)
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

    assert.match(markup, /Probability unavailable/)
    assert.match(markup, /reference-background baseline is not available/)
    assert.match(markup, /No valid sample-specific SHAP drivers were returned/)
    assert.doesNotMatch(markup, /Reference-background baseline.*0\.0%/)
  })

  it('keeps batch results outside the single-sample explanation flow', () => {
    const markup = renderResults({ jsonResult: null, csvResult: { samples_processed: 0, results: [] } })
    assert.doesNotMatch(markup, /Explain prediction/)
  })
})