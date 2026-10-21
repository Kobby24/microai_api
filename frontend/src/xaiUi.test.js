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
  class_probabilities: { '0': 0.2, '1': 0.8 },
}
const model = {
  name: 'gse7390',
  display_name: 'GSE7390',
  predicts: 'estrogen_receptor_status',
  predicts_label: 'Estrogen receptor status',
  ready: true,
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
  features: [
    { feature_id: 'probe-positive', raw_input_value: 4.2, model_input_value: 0.7, shap_value: 0.3 },
    { feature_id: 'probe-negative', raw_input_value: 1.8, model_input_value: -0.2, shap_value: -0.1 },
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
    assert.doesNotMatch(markup, /View all .* selected features/)
  })

  it('shows an accessible loading state without removing the prediction', () => {
    const markup = renderResults({ explaining: true })
    assert.match(markup, /Explaining prediction/)
    assert.match(markup, /Calculating a local explanation/)
    assert.match(markup, /Class probabilities/)
  })

  it('renders positive and negative contributors and selected-feature scope', () => {
    const markup = renderResults({ explanation })
    assert.match(markup, /probe-positive/)
    assert.match(markup, /probe-negative/)
    assert.match(markup, /Toward ER-positive/)
    assert.match(markup, /Away from ER-positive/)
    assert.match(markup, /View all 2 selected features/)
    assert.match(markup, /Selected-feature-space explanation only/)
    assert.match(markup, /Additivity passed/)
    assert.match(markup, /lg:grid-cols-2/)
    assert.doesNotMatch(markup, /Explain prediction/)
  })

  it('shows an explanation error while keeping the prediction available', () => {
    const markup = renderResults({ explanationError: 'Reference data unavailable.' })
    assert.match(markup, /Explanation unavailable/)
    assert.match(markup, /Reference data unavailable/)
    assert.match(markup, /Try again/)
    assert.match(markup, /Class probabilities/)
  })

  it('keeps batch results outside the single-sample explanation flow', () => {
    const markup = renderResults({ jsonResult: null, csvResult: { samples_processed: 0, results: [] } })
    assert.doesNotMatch(markup, /Explain prediction/)
  })
})