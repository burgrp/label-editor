import {
  PrinterError,
  PrinterValidationError,
  TransportDisconnectedError,
  TransportIOError,
  TransportTimeoutError,
  WebSerialPermissionError,
  WebSerialUnsupportedError,
} from './errors'
import type { PrinterTransport } from './types'

export const BLUETOOTH_SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb'

export interface WebSerialRequestOptions {
  readonly filters: ReadonlyArray<{
    readonly bluetoothServiceClassId: string
  }>
  readonly allowedBluetoothServiceClassIds: readonly string[]
}

export interface WebSerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: { readonly baudRate: number }): Promise<void>
  close(): Promise<void>
  setSignals?(signals: {
    readonly dataTerminalReady?: boolean
    readonly requestToSend?: boolean
  }): Promise<void>
}

export interface WebSerialApi {
  requestPort(options: WebSerialRequestOptions): Promise<WebSerialPortLike>
  addEventListener?(type: 'disconnect', listener: (event: Event) => void): void
  removeEventListener?(type: 'disconnect', listener: (event: Event) => void): void
}

export interface WebSerialTransportOptions {
  readonly baudRate?: number
  readonly defaultReadTimeoutMs?: number
  readonly serial?: WebSerialApi
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : ''
}

function browserSerial(): WebSerialApi | undefined {
  const browserGlobal = globalThis as typeof globalThis & {
    readonly navigator?: Navigator & { readonly serial?: WebSerialApi }
  }
  return browserGlobal.navigator?.serial
}

export class WebSerialTransport implements PrinterTransport {
  private readonly baudRate: number
  private readonly defaultReadTimeoutMs: number
  private readonly injectedSerial: WebSerialApi | undefined
  private serial: WebSerialApi | null = null
  private port: WebSerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readPump: Promise<void> | null = null
  private writeTail: Promise<void> = Promise.resolve()
  private receiveBuffer = new Uint8Array(0)
  private terminalReadError: PrinterError | null = null
  private readonly readWaiters = new Set<() => void>()
  private readPending = false
  private openState = false
  private closing = false
  private pumpCleanupError: unknown = null

  constructor(options: WebSerialTransportOptions = {}) {
    this.baudRate = options.baudRate ?? 9600
    this.defaultReadTimeoutMs = options.defaultReadTimeoutMs ?? 10_000
    this.injectedSerial = options.serial
    if (!Number.isInteger(this.baudRate) || this.baudRate <= 0) {
      throw new PrinterValidationError('Baud rate must be a positive integer.')
    }
    if (!Number.isFinite(this.defaultReadTimeoutMs) || this.defaultReadTimeoutMs <= 0) {
      throw new PrinterValidationError('Default read timeout must be greater than zero.')
    }
  }

  get isOpen(): boolean {
    return this.openState
  }

  async open(): Promise<void> {
    if (this.openState) return
    if (this.port !== null) await this.close()

    const serial = this.injectedSerial ?? browserSerial()
    if (serial === undefined) throw new WebSerialUnsupportedError()

    let port: WebSerialPortLike
    try {
      port = await serial.requestPort({
        filters: [{ bluetoothServiceClassId: BLUETOOTH_SPP_UUID }],
        allowedBluetoothServiceClassIds: [BLUETOOTH_SPP_UUID],
      })
    } catch (cause) {
      const name = errorName(cause)
      if (name === 'NotFoundError' || name === 'NotAllowedError' || name === 'SecurityError') {
        throw new WebSerialPermissionError(undefined, { cause })
      }
      if (name === 'TypeError') {
        throw new WebSerialUnsupportedError(
          'This browser does not support Bluetooth Classic SPP through Web Serial.',
          { cause },
        )
      }
      throw new TransportIOError('requesting a serial port', { cause })
    }

    let opened = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
    try {
      await port.open({ baudRate: this.baudRate })
      opened = true
      if (port.readable === null || port.writable === null) {
        throw new TransportDisconnectedError('The selected serial port has no readable or writable stream.')
      }
      if (port.setSignals !== undefined) {
        try {
          await port.setSignals({ dataTerminalReady: true, requestToSend: true })
        } catch {
          // Bluetooth stacks differ in modem-signal support; data streams remain authoritative.
        }
      }
      reader = port.readable.getReader()
      writer = port.writable.getWriter()
    } catch (cause) {
      try {
        reader?.releaseLock()
      } catch {
        // Continue releasing every resource.
      }
      try {
        writer?.releaseLock()
      } catch {
        // Continue releasing every resource.
      }
      if (opened) {
        try {
          await port.close()
        } catch {
          // Preserve the original open failure.
        }
      }
      if (cause instanceof PrinterError) throw cause
      const name = errorName(cause)
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new WebSerialPermissionError(undefined, { cause })
      }
      if (name === 'NetworkError' || name === 'InvalidStateError') {
        throw new TransportDisconnectedError('The selected printer could not be opened.', { cause })
      }
      throw new TransportIOError('opening the serial port', { cause })
    }

    this.serial = serial
    this.port = port
    this.reader = reader
    this.writer = writer
    this.receiveBuffer = new Uint8Array(0)
    this.terminalReadError = null
    this.pumpCleanupError = null
    this.closing = false
    this.openState = true
    serial.addEventListener?.('disconnect', this.handleDisconnect)
    this.readPump = this.pumpReads(reader)
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.openState || this.writer === null) {
      throw new TransportDisconnectedError('Cannot write because the printer is not connected.')
    }
    if (!(data instanceof Uint8Array)) {
      throw new PrinterValidationError('Transport writes require a Uint8Array.')
    }

    const writer = this.writer
    const copy = data.slice()
    const write = this.writeTail.then(() => writer.write(copy))
    this.writeTail = write.then(() => undefined, () => undefined)
    try {
      await write
    } catch (cause) {
      throw this.translateIOError('writing to the printer', cause)
    }
  }

  async read(length: number, timeoutMs = this.defaultReadTimeoutMs): Promise<Uint8Array> {
    if (!Number.isInteger(length) || length < 0) {
      throw new PrinterValidationError('Read length must be a non-negative integer.')
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new PrinterValidationError('Read timeout must be greater than zero.')
    }
    if (length === 0) return new Uint8Array(0)
    if (this.readPending) {
      throw new TransportIOError('starting a concurrent read')
    }
    if (!this.openState && this.receiveBuffer.length < length) {
      throw this.terminalReadError
        ?? new TransportDisconnectedError('Cannot read because the printer is not connected.')
    }

    this.readPending = true
    const deadline = Date.now() + timeoutMs
    try {
      while (this.receiveBuffer.length < length) {
        if (this.terminalReadError !== null) throw this.terminalReadError
        if (!this.openState) {
          throw new TransportDisconnectedError('The printer is no longer connected.')
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new TransportTimeoutError('reading from the printer', timeoutMs)
        await this.waitForInput(remaining, timeoutMs)
      }
      const result = this.receiveBuffer.slice(0, length)
      this.receiveBuffer = this.receiveBuffer.slice(length)
      return result
    } finally {
      this.readPending = false
    }
  }

  async close(): Promise<void> {
    const port = this.port
    if (port === null) {
      this.resetState()
      return
    }

    const disconnected = this.terminalReadError instanceof TransportDisconnectedError
    this.closing = true
    this.openState = false
    this.terminalReadError ??= new TransportDisconnectedError('The serial transport was closed.')
    this.serial?.removeEventListener?.('disconnect', this.handleDisconnect)
    this.notifyReaders()

    let cleanupError: unknown = null
    await this.writeTail

    const reader = this.reader
    if (reader !== null) {
      try {
        await reader.cancel()
      } catch (cause) {
        if (!disconnected) cleanupError ??= cause
      }
    }
    if (this.readPump !== null) {
      try {
        await this.readPump
      } catch (cause) {
        if (!disconnected) cleanupError ??= cause
      }
    }
    if (this.pumpCleanupError !== null && !disconnected) {
      cleanupError ??= this.pumpCleanupError
    }

    if (this.writer !== null) {
      try {
        this.writer.releaseLock()
      } catch (cause) {
        if (!disconnected) cleanupError ??= cause
      }
    }
    try {
      await port.close()
    } catch (cause) {
      if (!disconnected && errorName(cause) !== 'InvalidStateError') cleanupError ??= cause
    }

    this.resetState()
    if (cleanupError !== null) {
      throw new TransportIOError('closing the serial port', { cause: cleanupError })
    }
  }

  private readonly handleDisconnect = (event: Event): void => {
    const target: unknown = event.target
    if (target !== null && target !== this.port && target !== this.serial) return
    this.markDisconnected(new TransportDisconnectedError())
  }

  private async pumpReads(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      while (!this.closing) {
        const result = await reader.read()
        if (result.done) {
          if (!this.closing) {
            this.markDisconnected(new TransportDisconnectedError('The printer closed its input stream.'))
          }
          break
        }
        if (result.value.length > 0) {
          const combined = new Uint8Array(this.receiveBuffer.length + result.value.length)
          combined.set(this.receiveBuffer)
          combined.set(result.value, this.receiveBuffer.length)
          this.receiveBuffer = combined
          this.notifyReaders()
        }
      }
    } catch (cause) {
      if (!this.closing) {
        const error = this.translateIOError('reading from the printer', cause)
        if (error instanceof TransportDisconnectedError) this.markDisconnected(error)
        else {
          this.openState = false
          this.terminalReadError = error
          this.notifyReaders()
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch (cause) {
        if (this.closing) this.pumpCleanupError = cause
      }
      if (this.reader === reader) this.reader = null
      this.notifyReaders()
    }
  }

  private waitForInput(remainingMs: number, originalTimeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const wake = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.readWaiters.delete(wake)
        resolve()
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.readWaiters.delete(wake)
        reject(new TransportTimeoutError('reading from the printer', originalTimeoutMs))
      }, remainingMs)
      this.readWaiters.add(wake)
    })
  }

  private notifyReaders(): void {
    const waiters = [...this.readWaiters]
    this.readWaiters.clear()
    for (const wake of waiters) wake()
  }

  private markDisconnected(error: TransportDisconnectedError): void {
    if (this.closing) return
    this.openState = false
    this.terminalReadError ??= error
    this.notifyReaders()
  }

  private translateIOError(operation: string, cause: unknown): PrinterError {
    if (cause instanceof PrinterError) return cause
    const name = errorName(cause)
    if (
      !this.openState
      || name === 'NetworkError'
      || name === 'InvalidStateError'
      || name === 'AbortError'
    ) {
      const error = new TransportDisconnectedError(`The printer disconnected while ${operation}.`, {
        cause,
      })
      this.markDisconnected(error)
      return error
    }
    return new TransportIOError(operation, { cause })
  }

  private resetState(): void {
    this.serial = null
    this.port = null
    this.reader = null
    this.writer = null
    this.readPump = null
    this.writeTail = Promise.resolve()
    this.receiveBuffer = new Uint8Array(0)
    this.terminalReadError = null
    this.readPending = false
    this.openState = false
    this.closing = false
    this.pumpCleanupError = null
    this.notifyReaders()
  }
}
