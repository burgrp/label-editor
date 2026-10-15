import { PrinterValidationError } from './errors'
import { encodePackBits } from './packbits'
import {
  isTapeWidthMm,
  tapeWidthToProtocolCode,
  type RasterColumns,
  type TapeWidthMm,
} from './types'

export const RASTER_DOTS = 128
export const RASTER_COLUMN_BYTES = RASTER_DOTS / 8
export const INVALIDATE_BYTE_COUNT = 64

const ESC = 0x1b

export interface PrintConfiguration {
  readonly mediaType: number
  readonly tapeWidthMm: TapeWidthMm
  readonly mediaLengthMm?: number
  readonly rasterColumnCount: number
  readonly marginDots?: number
}

export interface RasterJob extends Omit<PrintConfiguration, 'rasterColumnCount'> {
  readonly columns: RasterColumns
}

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new PrinterValidationError(`${name} must be an unsigned byte.`)
  }
}

function assertUint16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new PrinterValidationError(`${name} must be an unsigned 16-bit integer.`)
  }
}

function assertColumnCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) {
    throw new PrinterValidationError('Raster column count must be between 1 and 4,294,967,295.')
  }
}

export function serializeInvalidate(): Uint8Array {
  return new Uint8Array(INVALIDATE_BYTE_COUNT)
}

export function serializeInitialize(): Uint8Array {
  return Uint8Array.of(ESC, 0x40)
}

export function serializeRasterMode(): Uint8Array {
  return Uint8Array.of(ESC, 0x69, 0x61, 0x01)
}

export function serializeStatusInquiry(): Uint8Array {
  return Uint8Array.of(ESC, 0x69, 0x53)
}

export function serializePrintInformation(configuration: PrintConfiguration): Uint8Array {
  assertByte(configuration.mediaType, 'Media type')
  if (!isTapeWidthMm(configuration.tapeWidthMm)) {
    throw new PrinterValidationError('Tape width must be 3.5, 6, 9, or 12 mm.')
  }
  const mediaLength = configuration.mediaLengthMm ?? 0
  assertByte(mediaLength, 'Media length')
  assertColumnCount(configuration.rasterColumnCount)

  const count = configuration.rasterColumnCount
  return Uint8Array.of(
    ESC,
    0x69,
    0x7a,
    0xc4,
    configuration.mediaType,
    tapeWidthToProtocolCode(configuration.tapeWidthMm),
    mediaLength,
    count & 0xff,
    (count >>> 8) & 0xff,
    (count >>> 16) & 0xff,
    (count >>> 24) & 0xff,
    0x00,
    0x00,
  )
}

export function serializeAdvancedMode(): Uint8Array {
  return Uint8Array.of(ESC, 0x69, 0x4b, 0x08)
}

export function serializePrintMode(options: { readonly mirror?: boolean } = {}): Uint8Array {
  return Uint8Array.of(ESC, 0x69, 0x4d, options.mirror ? 0x80 : 0x00)
}

export function serializeMargin(dots = 0): Uint8Array {
  assertUint16(dots, 'Margin')
  return Uint8Array.of(ESC, 0x69, 0x64, dots & 0xff, (dots >>> 8) & 0xff)
}

export function serializePackBitsMode(): Uint8Array {
  return Uint8Array.of(0x4d, 0x02)
}

export function serializeZeroRasterColumn(): Uint8Array {
  return Uint8Array.of(0x5a)
}

export function serializeRasterColumn(column: Uint8Array): Uint8Array {
  if (!(column instanceof Uint8Array) || column.length !== RASTER_COLUMN_BYTES) {
    throw new PrinterValidationError(
      `Each raster column must contain exactly ${RASTER_COLUMN_BYTES} bytes (${RASTER_DOTS} dots).`,
    )
  }
  if (column.every((value) => value === 0)) return serializeZeroRasterColumn()

  const packed = encodePackBits(column)
  const command = new Uint8Array(3 + packed.length)
  command[0] = 0x47
  command[1] = packed.length & 0xff
  command[2] = (packed.length >>> 8) & 0xff
  command.set(packed, 3)
  return command
}

export function serializePrintAndFeed(): Uint8Array {
  return Uint8Array.of(0x1a)
}

export function serializePrintWithoutFeed(): Uint8Array {
  return Uint8Array.of(0x0c)
}

export function normalizeRasterColumns(columns: RasterColumns): readonly Uint8Array[] {
  if (columns instanceof Uint8Array) {
    if (columns.length === 0 || columns.length % RASTER_COLUMN_BYTES !== 0) {
      throw new PrinterValidationError(
        `Raster data must be non-empty and divisible into ${RASTER_COLUMN_BYTES}-byte columns.`,
      )
    }
    const normalized: Uint8Array[] = []
    for (let offset = 0; offset < columns.length; offset += RASTER_COLUMN_BYTES) {
      normalized.push(columns.slice(offset, offset + RASTER_COLUMN_BYTES))
    }
    return normalized
  }

  if (!Array.isArray(columns)) {
    throw new PrinterValidationError('Raster columns must be a Uint8Array or an array of columns.')
  }
  if (columns.length === 0) {
    throw new PrinterValidationError('At least one raster column is required.')
  }
  return columns.map((column) => {
    if (!(column instanceof Uint8Array) || column.length !== RASTER_COLUMN_BYTES) {
      throw new PrinterValidationError(
        `Each raster column must contain exactly ${RASTER_COLUMN_BYTES} bytes (${RASTER_DOTS} dots).`,
      )
    }
    return column.slice()
  })
}

export function serializePrintConfiguration(
  configuration: PrintConfiguration,
): readonly Uint8Array[] {
  return [
    serializeRasterMode(),
    serializePrintInformation(configuration),
    serializeAdvancedMode(),
    serializePrintMode(),
    serializeMargin(configuration.marginDots ?? 0),
    serializePackBitsMode(),
  ]
}

export function serializeRasterJob(job: RasterJob): readonly Uint8Array[] {
  const columns = normalizeRasterColumns(job.columns)
  const configuration: PrintConfiguration = {
    mediaType: job.mediaType,
    tapeWidthMm: job.tapeWidthMm,
    mediaLengthMm: job.mediaLengthMm,
    rasterColumnCount: columns.length,
    marginDots: job.marginDots,
  }
  return [
    serializeInvalidate(),
    serializeInitialize(),
    ...serializePrintConfiguration(configuration),
    ...columns.map(serializeRasterColumn),
    serializePrintAndFeed(),
  ]
}
