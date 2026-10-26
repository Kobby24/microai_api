import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BATCH_ACCEPT,
  batchSamplePayload,
  isBatchExpressionFile,
  parseBatchExpressionText,
} from './batchFile.js'

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

describe('batch expression sample mapping', () => {
  const featureIds = ['g1', 'g2', 'g3']

  it('aligns sample rows by feature ID and resolves the API sample index', () => {
    const parsed = parseBatchExpressionText(
      'sample_id,g3,g1,g2\nP001,3,1.5,2\nP002,4,-0.5,1\n',
      'patients.csv',
      featureIds,
    )

    assert.deepEqual(parsed.samples, [[1.5, 2, 3], [-0.5, 1, 4]])
    assert.deepEqual(batchSamplePayload(parsed, {
      sample_index: 1,
      sample_id: 'P002',
    }), {
      expression: [-0.5, 1, 4],
      featureIds,
      sampleId: 'P002',
    })
  })

  it('aligns gene rows and transposes each input sample', () => {
    const parsed = parseBatchExpressionText(
      'ID_REF\tP001\tP002\ng3\t3\t4\ng1\t1.5\t-0.5\ng2\t2\t1\n',
      'patients.tsv',
      featureIds,
    )

    assert.deepEqual(parsed.samples, [[1.5, 2, 3], [-0.5, 1, 4]])
  })

  it('supports quoted delimiters and quoted line breaks in sample IDs', () => {
    const parsed = parseBatchExpressionText(
      'sample_id,g1,g2,g3\n"patient,\n1",1,2,3\n',
      'patients.csv',
      featureIds,
    )

    assert.deepEqual(parsed.samples, [[1, 2, 3]])
  })

  it('rejects ambiguous source data and invalid sample indices', () => {
    assert.throws(
      () => parseBatchExpressionText('g1,g2,g3\n1,2,not-a-number\n', 'input.csv', featureIds),
      /Expression values must be numeric and finite/,
    )
    assert.throws(
      () => batchSamplePayload({ samples: [[1, 2, 3]], featureIds }, { sample_index: 2 }),
      /cannot be matched/,
    )
  })
})
