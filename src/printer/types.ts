export const SUPPORTED_TAPE_WIDTHS = [3.5, 6, 9, 12] as const

export type TapeWidthMm = (typeof SUPPORTED_TAPE_WIDTHS)[number]

export interface PrinterTransport {
  readonly isOpen: boolean
  open(): Promise<void>
  write(data: Uint8Array): Promise<void>
  read(length: number, timeoutMs?: number): Promise<Uint8Array>
  close(): Promise<void>
}

export interface PrintProgress {
  readonly completedLines: number
  readonly totalLines: number
  readonly fraction: number
}

export type RasterColumns = Uint8Array | readonly Uint8Array[]

export function tapeWidthToProtocolCode(width: TapeWidthMm): number {
  return width === 3.5 ? 4 : width
}

export function protocolCodeToTapeWidth(code: number): TapeWidthMm | null {
  if (code === 4) return 3.5
  if (code === 6 || code === 9 || code === 12) return code
  return null
}

export function isTapeWidthMm(value: number): value is TapeWidthMm {
  return value === 3.5 || value === 6 || value === 9 || value === 12
}
