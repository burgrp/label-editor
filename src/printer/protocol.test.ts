import { describe, expect, it } from 'vitest'

import { PrinterValidationError } from './errors'
import { decodePackBits } from './packbits'
import {
  INVALIDATE_BYTE_COUNT,
  RASTER_COLUMN_BYTES,
  serializePrintConfiguration,
  serializePrintInformation,
  serializePrintWithoutFeed,
  serializeRasterColumn,
  serializeRasterJob,
} from './protocol'
import type { TapeWidthMm } from './types'

function bytes(data: Uint8Array): number[] {
  return [...data]
}

describe('PT-P300BT command serialization', () => {
  it.each([
    [3.5, 4],
    [6, 6],
    [9, 9],
    [12, 12],
  ] satisfies ReadonlyArray<readonly [TapeWidthMm, number]>)(
    'encodes %s mm tape with protocol width byte %i',
    (tapeWidthMm, widthCode) => {
      const command = serializePrintInformation({
        mediaType: 1,
        tapeWidthMm,
        mediaLengthMm: 0,
        rasterColumnCount: 0x01020304,
      })
      expect(bytes(command)).toEqual([
        0x1b, 0x69, 0x7a, 0xc4,
        0x01, widthCode, 0x00,
        0x04, 0x03, 0x02, 0x01,
        0x00, 0x00,
      ])
    },
  )

  it('orders configuration commands without enabling an auto-cutter', () => {
    const commands = serializePrintConfiguration({
      mediaType: 1,
      tapeWidthMm: 12,
      rasterColumnCount: 2,
      marginDots: 0x1234,
    }).map(bytes)

    expect(commands).toEqual([
      [0x1b, 0x69, 0x61, 0x01],
      [0x1b, 0x69, 0x7a, 0xc4, 0x01, 0x0c, 0x00, 0x02, 0, 0, 0, 0, 0],
      [0x1b, 0x69, 0x4b, 0x08],
      [0x1b, 0x69, 0x4d, 0x00],
      [0x1b, 0x69, 0x64, 0x34, 0x12],
      [0x4d, 0x02],
    ])
    expect(bytes(serializePrintWithoutFeed())).toEqual([0x0c])
  })

  it('serializes blank and PackBits-compressed 128-dot raster columns', () => {
    expect(bytes(serializeRasterColumn(new Uint8Array(RASTER_COLUMN_BYTES)))).toEqual([0x5a])

    const column = Uint8Array.of(
      0, 0, 0, 0,
      1, 2, 3, 4,
      0xff, 0xff, 0xff, 0xff,
      8, 7, 6, 5,
    )
    const command = serializeRasterColumn(column)
    const packedLength = command[1] | (command[2] << 8)
    expect(command[0]).toBe(0x47)
    expect(command.length).toBe(3 + packedLength)
    expect(decodePackBits(command.slice(3))).toEqual(column)
  })

  it('builds a complete one-page continuous raster job in wire order', () => {
    const marked = new Uint8Array(RASTER_COLUMN_BYTES).fill(0x55)
    const commands = serializeRasterJob({
      mediaType: 1,
      tapeWidthMm: 12,
      columns: [new Uint8Array(RASTER_COLUMN_BYTES), marked],
    }).map(bytes)

    expect(commands).toHaveLength(11)
    expect(commands[0]).toEqual(new Array<number>(INVALIDATE_BYTE_COUNT).fill(0))
    expect(commands[1]).toEqual([0x1b, 0x40])
    expect(commands[2]).toEqual([0x1b, 0x69, 0x61, 0x01])
    expect(commands[3].slice(0, 7)).toEqual([0x1b, 0x69, 0x7a, 0xc4, 1, 12, 0])
    expect(commands[5]).toEqual([0x1b, 0x69, 0x4d, 0x00])
    expect(commands[7]).toEqual([0x4d, 0x02])
    expect(commands[8]).toEqual([0x5a])
    expect(commands[9][0]).toBe(0x47)
    expect(commands[10]).toEqual([0x1a])
  })

  it('rejects malformed raster and numeric configuration values', () => {
    expect(() => serializeRasterColumn(new Uint8Array(15))).toThrow(PrinterValidationError)
    expect(() => serializeRasterJob({
      mediaType: 1,
      tapeWidthMm: 12,
      columns: new Uint8Array(17),
    })).toThrow(PrinterValidationError)
    expect(() => serializePrintInformation({
      mediaType: 256,
      tapeWidthMm: 12,
      rasterColumnCount: 1,
    })).toThrow(PrinterValidationError)
    expect(() => serializePrintInformation({
      mediaType: 1,
      tapeWidthMm: 18 as TapeWidthMm,
      rasterColumnCount: 1,
    })).toThrow(PrinterValidationError)
  })
})
