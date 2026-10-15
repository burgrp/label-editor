import Papa, { type ParseError } from 'papaparse'

export interface CsvRecord {
  values: readonly string[]
  from: number
  to: number
}

export interface CsvDiagnostic {
  message: string
  from: number
  to: number
  row?: number
}

export interface CsvParseResult {
  records: readonly CsvRecord[]
  diagnostics: readonly CsvDiagnostic[]
  maxColumns: number
}

export function parseCsv(source: string): CsvParseResult {
  const ranges = findRecordRanges(source)
  const parsed = Papa.parse<string[]>(source, {
    delimiter: ',',
    quoteChar: '"',
    escapeChar: '"',
    header: false,
    skipEmptyLines: 'greedy',
  })

  const records = parsed.data.map((values, index) => {
    const range = ranges[index] ?? { from: source.length, to: source.length }
    return {
      values,
      from: range.from,
      to: range.to,
    }
  })

  return {
    records,
    diagnostics: parsed.errors.map((error) =>
      diagnosticFromPapaError(error, ranges, source.length),
    ),
    maxColumns: records.reduce(
      (maximum, record) => Math.max(maximum, record.values.length),
      0,
    ),
  }
}

export function findRecordIndexAtOffset(
  records: readonly CsvRecord[],
  offset: number,
): number {
  if (records.length === 0) {
    return 0
  }

  const exact = records.findIndex(
    (record) => offset >= record.from && offset <= record.to,
  )
  if (exact >= 0) {
    return exact
  }

  const next = records.findIndex((record) => record.from > offset)
  return next >= 0 ? next : records.length - 1
}

function findRecordRanges(source: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  let start = 0
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      if (inQuotes && source[index + 1] === '"') {
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && (character === '\n' || character === '\r')) {
      addNonEmptyRange(ranges, source, start, index)
      if (character === '\r' && source[index + 1] === '\n') {
        index += 1
      }
      start = index + 1
    }
  }

  addNonEmptyRange(ranges, source, start, source.length)
  return ranges
}

function addNonEmptyRange(
  ranges: Array<{ from: number; to: number }>,
  source: string,
  from: number,
  to: number,
): void {
  if (source.slice(from, to).trim().length > 0) {
    ranges.push({ from, to })
  }
}

function diagnosticFromPapaError(
  error: ParseError,
  ranges: ReadonlyArray<{ from: number; to: number }>,
  sourceLength: number,
): CsvDiagnostic {
  const row = typeof error.row === 'number' ? error.row : undefined
  const range = row === undefined ? undefined : ranges[row]
  const from =
    typeof error.index === 'number'
      ? Math.min(error.index, sourceLength)
      : (range?.from ?? 0)

  return {
    message: error.message,
    from,
    to: Math.max(from + 1, range?.to ?? from + 1),
    row,
  }
}
