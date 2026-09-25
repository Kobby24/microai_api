import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BATCH_ACCEPT, isBatchExpressionFile } from './batchFile.js'

describe('batch file validation', () => {
  it('accepts csv and tsv extensions regardless of case', () => {
    assert.equal(isBatchExpressionFile('patients.csv'), true)
    assert.equal(isBatchExpressionFile('patients.TSV'), true)
    assert.equal(isBatchExpressionFile('patients.tsv'), true)
  })

  it('rejects other file types', () => {
    assert.equal(isBatchExpressionFile('patients.txt'), false)
    assert.equal(isBatchExpressionFile('patients.json'), false)
    assert.equal(isBatchExpressionFile(''), false)
  })

  it('exposes csv and tsv in the file picker filter', () => {
    assert.match(BATCH_ACCEPT, /\.csv/)
    assert.match(BATCH_ACCEPT, /\.tsv/)
    assert.match(BATCH_ACCEPT, /text\/csv/)
    assert.match(BATCH_ACCEPT, /text\/tab-separated-values/)
  })
})
