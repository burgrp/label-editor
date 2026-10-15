import { describe, expect, it } from 'vitest'

import { PrinterProtocolError } from './errors'
import { decodePackBits, encodePackBits } from './packbits'

describe('PackBits', () => {
  it('encodes literal and repeated packets deterministically', () => {
    expect([...encodePackBits(Uint8Array.of(1, 2, 3))]).toEqual([2, 1, 2, 3])
    expect([...encodePackBits(Uint8Array.of(7, 7, 7, 7, 7))]).toEqual([252, 7])
    expect([...encodePackBits(Uint8Array.of(1, 1, 2, 2, 2, 3))]).toEqual([
      255, 1,
      254, 2,
      0, 3,
    ])
  })

  it('splits packets at the 128-byte PackBits boundary', () => {
    const literals = Uint8Array.from({ length: 130 }, (_, index) => index)
    const encodedLiterals = encodePackBits(literals)
    expect(encodedLiterals[0]).toBe(127)
    expect(encodedLiterals[129]).toBe(1)
    expect(decodePackBits(encodedLiterals)).toEqual(literals)

    const repeated = new Uint8Array(129).fill(0xa5)
    expect([...encodePackBits(repeated)]).toEqual([129, 0xa5, 0, 0xa5])
    expect(decodePackBits(encodePackBits(repeated))).toEqual(repeated)
  })

  it('round-trips mixed data and accepts the PackBits no-op header', () => {
    const input = Uint8Array.of(
      0, 0, 0, 1, 2, 3, 3, 4, 5, 5, 5, 5, 6, 7, 8, 9,
    )
    expect(decodePackBits(encodePackBits(input))).toEqual(input)
    expect(decodePackBits(Uint8Array.of(128, 0, 0x2a))).toEqual(Uint8Array.of(0x2a))
  })

  it('rejects truncated packets', () => {
    expect(() => decodePackBits(Uint8Array.of(2, 1, 2))).toThrow(PrinterProtocolError)
    expect(() => decodePackBits(Uint8Array.of(255))).toThrow(PrinterProtocolError)
  })
})
