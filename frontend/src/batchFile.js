export const BATCH_ACCEPT = '.csv,.tsv,text/csv,text/tab-separated-values,text/tsv'

export function isBatchExpressionFile(filename) {
  const name = String(filename || '').toLowerCase()
  return name.endsWith('.csv') || name.endsWith('.tsv')
}

function parseDelimitedText(text, separator) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index += 1) {
    const character = text[index]

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"' && field === '') {
      quoted = true
    } else if (character === separator) {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      row.push(field)
      if (row.length !== 1 || row[0] !== '') rows.push(row)
      row = []
      field = ''
      if (character === '\r' && text[index + 1] === '\n') index += 1
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('The uploaded table contains an unterminated quoted value.')
  if (field || row.length) {
    row.push(field)
    if (row.length !== 1 || row[0] !== '') rows.push(row)
  }
  if (!rows.length) throw new Error('The uploaded table is empty.')

  const width = rows[0].length
  if (rows.some((values) => values.length !== width)) {
    throw new Error('The uploaded table has rows with inconsistent numbers of values.')
  }
  return rows
}

function validateIdentifiers(values, expectedFeatureIds) {
  const identifiers = values.map((value) => String(value ?? '').trim())
  const expected = new Set(expectedFeatureIds)

  if (
    !identifiers.length
    || identifiers.some((value) => !value)
    || new Set(identifiers).size !== identifiers.length
    || identifiers.length !== expected.size
    || identifiers.some((value) => !expected.has(value))
  ) {
    throw new Error("Feature identifiers do not match this model's required gene/probe set.")
  }
  const positions = new Map(identifiers.map((identifier, index) => [identifier, index]))
  return expectedFeatureIds.map((identifier) => positions.get(identifier))
}

function numericRows(rows) {
  return rows.map((row) => row.map((value) => {
    const trimmed = String(value ?? '').trim()
    const numericSyntax = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
    const numeric = Number(trimmed)
    if (!trimmed || (!numericSyntax.test(trimmed) && !/^[+-]?(?:infinity|inf|nan)$/i.test(trimmed)) || !Number.isFinite(numeric)) {
      throw new Error(
        'Expression values must be numeric and finite; missing, NaN, and infinite values are not supported.',
      )
    }
    return numeric
  }))
}

const GENE_ID_HEADERS = new Set([
  'gene',
  'gene_id',
  'geneid',
  'probe',
  'probe_id',
  'probeid',
  'feature',
  'feature_id',
  'featureid',
  'id_ref',
])

export function parseBatchExpressionText(text, filename, featureIds) {
  if (!Array.isArray(featureIds) || !featureIds.length || featureIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('This model has no verified gene/probe input schema.')
  }

  const separator = String(filename || '').toLowerCase().endsWith('.tsv') ? '\t' : ','
  const rows = parseDelimitedText(String(text), separator)
  const header = rows[0].map((value) => String(value ?? '').trim())
  let sampleIdColumn = null
  let headerFeatureIds = header

  if (header.length === featureIds.length + 1 && !featureIds.includes(header[0])) {
    sampleIdColumn = 0
    headerFeatureIds = header.slice(1)
  }

  if (
    headerFeatureIds.length === featureIds.length
    && headerFeatureIds.every((id) => featureIds.includes(id))
  ) {
    const order = validateIdentifiers(headerFeatureIds, featureIds)
    const values = rows.slice(1).map((values) => sampleIdColumn === null ? values : values.slice(1))
    if (!values.length) throw new Error('The expression table contains no samples.')
    const numeric = numericRows(values)
    return {
      featureIds: [...featureIds],
      samples: numeric.map((sample) => order.map((column) => sample[column])),
    }
  }

  let geneRows = rows
  if (GENE_ID_HEADERS.has(header[0]?.toLowerCase())) geneRows = rows.slice(1)
  if (geneRows.length === featureIds.length && geneRows[0]?.length >= 2) {
    const order = validateIdentifiers(geneRows.map((values) => values[0]), featureIds)
    const sampleColumns = numericRows(geneRows.map((values) => values.slice(1)))
    const sampleCount = geneRows[0].length - 1
    return {
      featureIds: [...featureIds],
      samples: Array.from({ length: sampleCount }, (_, sampleIndex) =>
        order.map((rowIndex) => sampleColumns[rowIndex][sampleIndex])),
    }
  }

  throw new Error(
    `Expected ${featureIds.length} identified genes, but the table has no unambiguous matching feature header or gene-ID column.`,
  )
}

export function batchSamplePayload(parsed, resultRow) {
  const sampleIndex = resultRow?.sample_index
  if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || !parsed?.samples?.[sampleIndex]) {
    throw new Error('This result cannot be matched to an expression row in the uploaded file.')
  }

  return {
    expression: parsed.samples[sampleIndex],
    featureIds: parsed.featureIds,
    sampleId: typeof resultRow.sample_id === 'string' && resultRow.sample_id.trim()
      ? resultRow.sample_id.trim()
      : undefined,
  }
}
