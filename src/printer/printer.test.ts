import { describe, expect, it } from 'vitest'

import {
  PrinterStatusError,
  PrinterValidationError,
  TransportDisconnectedError,
  TransportTimeoutError,
} from './errors'
import { PTP300BTPrinter } from './printer'
import { RASTER_COLUMN_BYTES } from './protocol'
import { STATUS_PACKET_LENGTH, STATUS_TYPE_CODES } from './status'
import type { PrinterTransport, PrintProgress } from './types'

interface StatusOverrides {
  readonly modelCode?: number
  readonly errorCode?: number
  readonly widthCode?: number
  readonly mediaType?: number
  readonly statusType?: number
  readonly phaseType?: number
  readonly phaseNumber?: number
  readonly notification?: number
}

function statusFrame(overrides: StatusOverrides = {}): Uint8Array {
  const frame = new Uint8Array(STATUS_PACKET_LENGTH)
  frame.set([0x80, 0x20, 0x42, 0x30])
  frame[4] = overrides.modelCode ?? 0x72
  frame[7] = 4
  const errorCode = overrides.errorCode ?? 0
  frame[8] = (errorCode >>> 8) & 0xff
  frame[9] = errorCode & 0xff
  frame[10] = overrides.widthCode ?? 12
  frame[11] = overrides.mediaType ?? 1
  frame[18] = overrides.statusType ?? STATUS_TYPE_CODES.statusReply
  frame[19] = overrides.phaseType ?? 0
  const phaseNumber = overrides.phaseNumber ?? 0
  frame[20] = (phaseNumber >>> 8) & 0xff
  frame[21] = phaseNumber & 0xff
  frame[22] = overrides.notification ?? 0
  return frame
}

class FakeTransport implements PrinterTransport {
  isOpen = false
  readonly writes: Uint8Array[] = []
  readonly responses: Uint8Array[]
  openCount = 0
  closeCount = 0

  constructor(responses: readonly Uint8Array[]) {
    this.responses = responses.map((response) => response.slice())
  }

  async open(): Promise<void> {
    this.openCount += 1
    this.isOpen = true
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.isOpen) throw new TransportDisconnectedError()
    this.writes.push(data.slice())
  }

  async read(length: number, timeoutMs = 1_000): Promise<Uint8Array> {
    const response = this.responses.shift()
    if (response === undefined) throw new TransportTimeoutError('fake transport read', timeoutMs)
    if (response.length !== length) return response
    return response.slice()
  }

  async close(): Promise<void> {
    this.closeCount += 1
    this.isOpen = false
  }
}

function bytes(data: Uint8Array): number[] {
  return [...data]
}

describe('PTP300BTPrinter', () => {
  it('connects, queries, prints one full raster job with line progress, and disconnects', async () => {
    const transport = new FakeTransport([
      statusFrame(),
      statusFrame(),
      statusFrame({
        statusType: STATUS_TYPE_CODES.phaseChange,
        phaseType: 1,
      }),
      statusFrame({ statusType: STATUS_TYPE_CODES.printingCompleted }),
    ])
    const printer = new PTP300BTPrinter(transport)

    await printer.connect()
    expect(printer.isConnected).toBe(true)
    await expect(printer.queryStatus()).resolves.toMatchObject({
      model: 'PT-P300BT',
      mediaWidthMm: 12,
    })

    const raster = new Uint8Array(RASTER_COLUMN_BYTES * 2)
    raster.fill(0xaa, RASTER_COLUMN_BYTES)
    const progress: PrintProgress[] = []
    const result = await printer.print(raster, {
      tapeWidthMm: 12,
      marginDots: 7,
      onProgress(value) {
        progress.push(value)
      },
    })

    expect(result.linesPrinted).toBe(2)
    expect(result.completionStatus.statusType.name).toBe('printingCompleted')
    expect(progress).toEqual([
      { completedLines: 1, totalLines: 2, fraction: 0.5 },
      { completedLines: 2, totalLines: 2, fraction: 1 },
    ])

    expect(transport.writes.map(bytes)).toEqual([
      new Array<number>(64).fill(0),
      [0x1b, 0x40],
      [0x1b, 0x69, 0x53],
      new Array<number>(64).fill(0),
      [0x1b, 0x40],
      [0x1b, 0x69, 0x53],
      new Array<number>(64).fill(0),
      [0x1b, 0x40],
      [0x1b, 0x69, 0x61, 0x01],
      [0x1b, 0x69, 0x7a, 0xc4, 1, 12, 0, 2, 0, 0, 0, 0, 0],
      [0x1b, 0x69, 0x4b, 0x08],
      [0x1b, 0x69, 0x4d, 0x00],
      [0x1b, 0x69, 0x64, 7, 0],
      [0x4d, 0x02],
      [0x5a],
      [0x47, 2, 0, 241, 0xaa],
      [0x1a],
    ])

    await printer.disconnect()
    expect(printer.isConnected).toBe(false)
    expect(transport.openCount).toBe(1)
    expect(transport.closeCount).toBe(1)
  })

  it('validates connection and raster data before any job bytes are sent', async () => {
    const disconnected = new PTP300BTPrinter(new FakeTransport([]))
    await expect(disconnected.print(new Uint8Array(16)))
      .rejects.toBeInstanceOf(TransportDisconnectedError)

    const transport = new FakeTransport([])
    const printer = new PTP300BTPrinter(transport)
    await printer.connect()
    await expect(printer.print(new Uint8Array(15)))
      .rejects.toBeInstanceOf(PrinterValidationError)
    expect(transport.writes).toHaveLength(0)
  })

  it('refuses tape mismatches before sending raster configuration', async () => {
    const transport = new FakeTransport([statusFrame({ widthCode: 6 })])
    const printer = new PTP300BTPrinter(transport)
    await printer.connect()

    await expect(printer.print(new Uint8Array(16), { tapeWidthMm: 12 }))
      .rejects.toThrow('printer reports 6 mm tape')
    expect(transport.writes).toHaveLength(3)
  })

  it('surfaces printer flags and completion timeouts explicitly', async () => {
    const errorTransport = new FakeTransport([
      statusFrame({
        errorCode: 0x0800,
        statusType: STATUS_TYPE_CODES.errorOccurred,
      }),
    ])
    const errorPrinter = new PTP300BTPrinter(errorTransport)
    await errorPrinter.connect()
    const failure = errorPrinter.print(new Uint8Array(16))
    await expect(failure).rejects.toBeInstanceOf(PrinterStatusError)
    await expect(failure).rejects.toMatchObject({ activeErrors: ['lowBattery'] })

    const timeoutTransport = new FakeTransport([statusFrame()])
    const timeoutPrinter = new PTP300BTPrinter(timeoutTransport)
    await timeoutPrinter.connect()
    await expect(timeoutPrinter.print(new Uint8Array(16), { completionTimeoutMs: 10 }))
      .rejects.toMatchObject({
        code: 'timeout',
        operation: 'waiting for print completion',
        timeoutMs: 10,
      })
  })
})
