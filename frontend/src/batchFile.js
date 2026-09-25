export const BATCH_ACCEPT = '.csv,.tsv,text/csv,text/tab-separated-values,text/tsv'

export function isBatchExpressionFile(filename) {
  const name = String(filename || '').toLowerCase()
  return name.endsWith('.csv') || name.endsWith('.tsv')
}
