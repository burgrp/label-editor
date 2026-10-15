import { PrinterProtocolError } from './errors'

const MAX_PACKET_LENGTH = 128
const MIN_RUN_LENGTH = 2

function repeatedLength(data: Uint8Array, offset: number): number {
  const value = data[offset]
  let length = 1
  while (
    length < MAX_PACKET_LENGTH
    && offset + length < data.length
    && data[offset + length] === value
  ) {
    length += 1
  }
  return length
}

export function encodePackBits(data: Uint8Array): Uint8Array {
  const encoded: number[] = []
  let offset = 0

  while (offset < data.length) {
    const runLength = repeatedLength(data, offset)
    if (runLength >= MIN_RUN_LENGTH) {
      encoded.push(257 - runLength, data[offset])
      offset += runLength
      continue
    }

    const literalStart = offset
    offset += runLength
    while (offset < data.length && offset - literalStart < MAX_PACKET_LENGTH) {
      const nextRunLength = repeatedLength(data, offset)
      if (nextRunLength >= MIN_RUN_LENGTH) break
      offset += Math.min(nextRunLength, MAX_PACKET_LENGTH - (offset - literalStart))
    }

    const literalLength = offset - literalStart
    encoded.push(literalLength - 1)
    for (let index = literalStart; index < offset; index += 1) {
      encoded.push(data[index])
    }
  }

  return Uint8Array.from(encoded)
}

export function decodePackBits(data: Uint8Array): Uint8Array {
  const decoded: number[] = []
  let offset = 0

  while (offset < data.length) {
    const header = data[offset]
    offset += 1

    if (header <= 127) {
      const literalLength = header + 1
      if (offset + literalLength > data.length) {
        throw new PrinterProtocolError('PackBits literal packet is truncated.')
      }
      for (let index = 0; index < literalLength; index += 1) {
        decoded.push(data[offset + index])
      }
      offset += literalLength
      continue
    }

    if (header === 128) continue
    if (offset >= data.length) {
      throw new PrinterProtocolError('PackBits run packet is truncated.')
    }

    const runLength = 257 - header
    const value = data[offset]
    offset += 1
    for (let index = 0; index < runLength; index += 1) {
      decoded.push(value)
    }
  }

  return Uint8Array.from(decoded)
}
