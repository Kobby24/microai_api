import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analysisSteps, initialAnalysisProgress, progressFromUploadEvent, uploadPercent } from './analysisProgress.js'

describe('analysis progress', () => {
  it('starts in the upload phase with no invented percentage', () => {
    assert.equal(uploadPercent(initialAnalysisProgress), null)
    const steps = analysisSteps('cel', initialAnalysisProgress)
    assert.deepEqual(steps.map((step) => step.state), ['active', 'pending', 'pending'])
    assert.equal(steps[0].detail, null)
  })

  it('reports real upload bytes and switches to processing only when all bytes are sent', () => {
    assert.deepEqual(progressFromUploadEvent({ loaded: 250, total: 1000 }), { phase: 'uploading', loaded: 250, total: 1000 })
    assert.equal(uploadPercent(progressFromUploadEvent({ loaded: 999, total: 1000 })), 99)
    assert.equal(progressFromUploadEvent({ loaded: 1000, total: 1000 }).phase, 'processing')
  })

  it('stays in the upload phase when the browser does not report a total', () => {
    const progress = progressFromUploadEvent({ loaded: 500, total: undefined })
    assert.equal(progress.phase, 'uploading')
    assert.equal(uploadPercent(progress), null)
  })

  it('never marks the server step or results as complete', () => {
    for (const mode of ['cel', 'csv', 'json']) {
      const steps = analysisSteps(mode, { phase: 'processing', loaded: 10, total: 10 })
      assert.deepEqual(steps.map((step) => step.state), ['complete', 'active', 'pending'])
    }
  })
})
