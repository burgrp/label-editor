import {
  PrinterBusyError,
  PrinterStatusError,
  PrinterValidationError,
  TransportDisconnectedError,
  TransportTimeoutError,
} from './errors'
import {
  normalizeRasterColumns,
  serializeInitialize,
  serializeInvalidate,
  serializePrintAndFeed,
  serializePrintConfiguration,
  serializeRasterColumn,
  serializeStatusInquiry,
} from './protocol'
import {
  parseStatus,
  PT_P300BT_MODEL_CODE,
  STATUS_PACKET_LENGTH,
  STATUS_TYPE_CODES,
  type PrinterStatus,
} from './status'
import type {
  PrinterTransport,
  PrintProgress,
  RasterColumns,
  TapeWidthMm,
} from './types'

export interface PTP300BTPrinterOptions {
  readonly statusTimeoutMs?: number
  readonly completionTimeoutMs?: number
}

export interface PrintOptions {
  readonly tapeWidthMm?: TapeWidthMm
  readonly marginDots?: number
  readonly statusTimeoutMs?: number
  readonly completionTimeoutMs?: number
  readonly onProgress?: (progress: PrintProgress) => void
}

export interface PrintResult {
  readonly initialStatus: PrinterStatus
  readonly completionStatus: PrinterStatus
  readonly linesPrinted: number
}

export class PTP300BTPrinter {
  private readonly transport: PrinterTransport
  private readonly statusTimeoutMs: number
  private readonly completionTimeoutMs: number
  private busy = false

  constructor(transport: PrinterTransport, options: PTP300BTPrinterOptions = {}) {
    this.transport = transport
    this.statusTimeoutMs = validateTimeout(options.statusTimeoutMs ?? 5_000, 'Status timeout')
    this.completionTimeoutMs = validateTimeout(
      options.completionTimeoutMs ?? 60_000,
      'Completion timeout',
    )
  }

  get isConnected(): boolean {
    return this.transport.isOpen
  }

  async connect(): Promise<void> {
    await this.runExclusive(async () => {
      if (!this.transport.isOpen) await this.transport.open()
    })
  }

  async queryStatus(timeoutMs = this.statusTimeoutMs): Promise<PrinterStatus> {
    return this.runExclusive(async () => {
      this.assertConnected()
      return this.queryStatusInternal(validateTimeout(timeoutMs, 'Status timeout'))
    })
  }

  async print(columns: RasterColumns, options: PrintOptions = {}): Promise<PrintResult> {
    return this.runExclusive(async () => {
      this.assertConnected()
      const normalizedColumns = normalizeRasterColumns(columns)
      const statusTimeout = validateTimeout(
        options.statusTimeoutMs ?? this.statusTimeoutMs,
        'Status timeout',
      )
      const completionTimeout = validateTimeout(
        options.completionTimeoutMs ?? this.completionTimeoutMs,
        'Completion timeout',
      )
      const initialStatus = await this.queryStatusInternal(statusTimeout)
      const tapeWidth = this.validateReadyStatus(initialStatus, options.tapeWidthMm)

      const configuration = {
        mediaType: initialStatus.mediaType,
        tapeWidthMm: tapeWidth,
        mediaLengthMm: initialStatus.mediaLengthMm,
        rasterColumnCount: normalizedColumns.length,
        marginDots: options.marginDots,
      }
      const setupCommands = [
        serializeInvalidate(),
        serializeInitialize(),
        ...serializePrintConfiguration(configuration),
      ]
      for (const command of setupCommands) await this.transport.write(command)

      for (let index = 0; index < normalizedColumns.length; index += 1) {
        await this.transport.write(serializeRasterColumn(normalizedColumns[index]))
        options.onProgress?.({
          completedLines: index + 1,
          totalLines: normalizedColumns.length,
          fraction: (index + 1) / normalizedColumns.length,
        })
      }
      await this.transport.write(serializePrintAndFeed())

      const completionStatus = await this.waitForCompletion(completionTimeout)
      return {
        initialStatus,
        completionStatus,
        linesPrinted: normalizedColumns.length,
      }
    })
  }

  async disconnect(): Promise<void> {
    await this.runExclusive(async () => {
      await this.transport.close()
    })
  }

  private async queryStatusInternal(timeoutMs: number): Promise<PrinterStatus> {
    await this.transport.write(serializeInvalidate())
    await this.transport.write(serializeInitialize())
    await this.transport.write(serializeStatusInquiry())
    return parseStatus(await this.transport.read(STATUS_PACKET_LENGTH, timeoutMs))
  }

  private validateReadyStatus(
    status: PrinterStatus,
    requestedTapeWidth: TapeWidthMm | undefined,
  ): TapeWidthMm {
    if (status.modelCode !== PT_P300BT_MODEL_CODE) {
      throw new PrinterStatusError(
        `Expected a PT-P300BT status packet, received model code 0x${status.modelCode.toString(16).padStart(2, '0')}.`,
      )
    }
    if (status.hasError || status.statusType.code === STATUS_TYPE_CODES.errorOccurred) {
      throw new PrinterStatusError(
        `Printer reported an error${status.activeErrors.length > 0 ? `: ${status.activeErrors.join(', ')}` : '.'}`,
        status.activeErrors,
      )
    }
    if (status.statusType.code === STATUS_TYPE_CODES.poweredOff) {
      throw new PrinterStatusError('Printer reports that it is powered off.')
    }
    if (status.statusType.code !== STATUS_TYPE_CODES.statusReply) {
      throw new PrinterStatusError(`Printer is not ready (status: ${status.statusType.name}).`)
    }
    if (status.phase.name !== 'ready') {
      throw new PrinterStatusError(`Printer is not ready (phase: ${status.phase.name}).`)
    }
    if (status.mediaWidthMm === null) {
      throw new PrinterStatusError(
        `Unsupported or missing tape width code ${status.mediaWidthCode}.`,
      )
    }
    if (status.mediaType === 0x00 || status.mediaType === 0xff) {
      throw new PrinterStatusError('No supported tape cassette is loaded.')
    }
    if (requestedTapeWidth !== undefined && requestedTapeWidth !== status.mediaWidthMm) {
      throw new PrinterValidationError(
        `Requested ${requestedTapeWidth} mm tape, but the printer reports ${status.mediaWidthMm} mm tape.`,
      )
    }
    return status.mediaWidthMm
  }

  private async waitForCompletion(timeoutMs: number): Promise<PrinterStatus> {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new TransportTimeoutError('waiting for print completion', timeoutMs)
      }

      let status: PrinterStatus
      try {
        status = parseStatus(await this.transport.read(STATUS_PACKET_LENGTH, remaining))
      } catch (error) {
        if (error instanceof TransportTimeoutError) {
          throw new TransportTimeoutError('waiting for print completion', timeoutMs, {
            cause: error,
          })
        }
        throw error
      }

      if (status.modelCode !== PT_P300BT_MODEL_CODE) {
        throw new PrinterStatusError('Received completion status from an unexpected printer model.')
      }
      if (status.hasError || status.statusType.code === STATUS_TYPE_CODES.errorOccurred) {
        throw new PrinterStatusError(
          `Print failed${status.activeErrors.length > 0 ? `: ${status.activeErrors.join(', ')}` : '.'}`,
          status.activeErrors,
        )
      }
      if (status.statusType.code === STATUS_TYPE_CODES.poweredOff) {
        throw new PrinterStatusError('Printer powered off before completing the job.')
      }
      if (status.statusType.code === STATUS_TYPE_CODES.printingCompleted) return status
    }
  }

  private assertConnected(): void {
    if (!this.transport.isOpen) {
      throw new TransportDisconnectedError('Connect to the printer before using it.')
    }
  }

  private async runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.busy) throw new PrinterBusyError()
    this.busy = true
    try {
      return await operation()
    } finally {
      this.busy = false
    }
  }
}

function validateTimeout(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PrinterValidationError(`${name} must be greater than zero.`)
  }
  return value
}
