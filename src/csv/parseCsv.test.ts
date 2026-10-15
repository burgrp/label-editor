import { describe, expect, it } from 'vitest'
import { findRecordIndexAtOffset, parseCsv } from './parseCsv'

describe('parseCsv', () => {
  it('parses quotes, commas, escaped quotes, and blank records', () => {
    const source = [
      'one,"two, too"',
      '',
      '"three',
      'continued","say ""hi"""',
      'four,five',
    ].join('\n')

    const result = parseCsv(source)

    expect(result.diagnostics).toEqual([])
    expect(result.records.map((record) => record.values)).toEqual([
      ['one', 'two, too'],
      ['three\ncontinued', 'say "hi"'],
      ['four', 'five'],
    ])
    expect(result.maxColumns).toBe(2)
    expect(source.slice(result.records[1].from, result.records[1].to)).toContain(
      'continued',
    )
  })

  it('reports malformed quoted input', () => {
    const result = parseCsv('one,"unfinished')

    expect(result.diagnostics[0]?.message).toMatch(/quote/i)
  })

  it('maps cursor offsets to logical records and skips blank lines', () => {
    const source = 'first,row\n\nsecond,row'
    const records = parseCsv(source).records

    expect(findRecordIndexAtOffset(records, 2)).toBe(0)
    expect(findRecordIndexAtOffset(records, source.indexOf('second'))).toBe(1)
    expect(findRecordIndexAtOffset(records, source.length)).toBe(1)
  })
})
