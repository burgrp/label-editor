import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TransportDisconnectedError,
  TransportIOError,
  TransportTimeoutError,
  WebSerialPermissionError,
  WebSerialUnsupportedError,
} from './errors'
import {
  BLUETOOTH_SPP_UUID,
  WebSerialTransport,
  type WebSerialApi,
  type WebSerialPortLike,
  type WebSerialRequestOptions,
} from './webSerial'

interface PortHarness {
  readonly port: WebSerialPortLike
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  readonly controller: ReadableStreamDefaultController<Uint8Array>
  readonly writes: Uint8Array[]
  readonly open: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly setSignals: ReturnType<typeof vi.fn>
  readonly cancelled: () => number
}

function createPort(writeFailure?: Error): PortHarness {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let cancelCount = 0
  const writes: Uint8Array[] = []
  const readable = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel() {
      cancelCount += 1
    },
  })
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (writeFailure !== undefined) throw writeFailure
      writes.push(chunk.slice())
    },
  })
  const open = vi.fn(async () => undefined)
  const close = vi.fn(async () => undefined)
  const setSignals = vi.fn(async () => undefined)
  const port: WebSerialPortLike = {
    readable,
    writable,
    open,
    close,
    setSignals,
  }
  return {
    port,
    readable,
    writable,
    controller,
    writes,
    open,
    close,
    setSignals,
    cancelled: () => cancelCount,
  }
}

function createSerial(port: WebSerialPortLike): {
  readonly serial: WebSerialApi
  readonly requestPort: ReturnType<typeof vi.fn>
} {
  const requestPort = vi.fn(async (_options: WebSerialRequestOptions) => port)
  return {
    serial: { requestPort },
    requestPort,
  }
}

function namedError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WebSerialTransport', () => {
  it('requests Bluetooth Classic SPP and combines fragmented reads', async () => {
    const harness = createPort()
    const { serial, requestPort } = createSerial(harness.port)
    const transport = new WebSerialTransport({ serial, baudRate: 9600 })

    await transport.open()
    expect(transport.isOpen).toBe(true)
    expect(requestPort).toHaveBeenCalledWith({
      filters: [{ bluetoothServiceClassId: BLUETOOTH_SPP_UUID }],
      allowedBluetoothServiceClassIds: [BLUETOOTH_SPP_UUID],
    })
    expect(harness.open).toHaveBeenCalledWith({ baudRate: 9600 })
    expect(harness.setSignals).toHaveBeenCalledWith({
      dataTerminalReady: true,
      requestToSend: true,
    })

    const pendingRead = transport.read(5, 1_000)
    harness.controller.enqueue(Uint8Array.of(1, 2))
    harness.controller.enqueue(Uint8Array.of(3, 4, 5, 6))
    await expect(pendingRead).resolves.toEqual(Uint8Array.of(1, 2, 3, 4, 5))
    await expect(transport.read(1, 1_000)).resolves.toEqual(Uint8Array.of(6))

    await transport.write(Uint8Array.of(7, 8))
    expect(harness.writes).toEqual([Uint8Array.of(7, 8)])
    await transport.close()
    expect(transport.isOpen).toBe(false)
    expect(harness.cancelled()).toBe(1)
    expect(harness.readable.locked).toBe(false)
    expect(harness.writable.locked).toBe(false)
    expect(harness.close).toHaveBeenCalledOnce()
  })

  it('times out without abandoning the underlying read pump', async () => {
    vi.useFakeTimers()
    const harness = createPort()
    const { serial } = createSerial(harness.port)
    const transport = new WebSerialTransport({ serial })
    await transport.open()

    const timedOutRead = transport.read(1, 50)
    const rejection = expect(timedOutRead).rejects.toBeInstanceOf(TransportTimeoutError)
    await vi.advanceTimersByTimeAsync(50)
    await rejection

    harness.controller.enqueue(Uint8Array.of(0x42))
    await expect(transport.read(1, 50)).resolves.toEqual(Uint8Array.of(0x42))
    await transport.close()
  })

  it('reports permission denial and unsupported browsers explicitly', async () => {
    const deniedSerial: WebSerialApi = {
      requestPort: vi.fn(async () => {
        throw namedError('NotAllowedError')
      }),
    }
    await expect(new WebSerialTransport({ serial: deniedSerial }).open())
      .rejects.toBeInstanceOf(WebSerialPermissionError)

    const transport = new WebSerialTransport()
    await expect(transport.open()).rejects.toBeInstanceOf(WebSerialUnsupportedError)
  })

  it('reports stream closure as a disconnect and still releases resources', async () => {
    const harness = createPort()
    const { serial } = createSerial(harness.port)
    const transport = new WebSerialTransport({ serial })
    await transport.open()

    const pendingRead = transport.read(1, 1_000)
    harness.controller.close()
    await expect(pendingRead).rejects.toBeInstanceOf(TransportDisconnectedError)
    expect(transport.isOpen).toBe(false)

    await transport.close()
    expect(harness.readable.locked).toBe(false)
    expect(harness.writable.locked).toBe(false)
    expect(harness.close).toHaveBeenCalledOnce()
  })

  it('rejects a pending read when explicitly closed', async () => {
    const harness = createPort()
    const { serial } = createSerial(harness.port)
    const transport = new WebSerialTransport({ serial })
    await transport.open()

    const pendingRead = transport.read(1, 1_000)
    const rejection = expect(pendingRead).rejects.toBeInstanceOf(TransportDisconnectedError)
    await transport.close()
    await rejection
    expect(harness.readable.locked).toBe(false)
    expect(harness.writable.locked).toBe(false)
  })

  it('wraps write failures as transport I/O errors', async () => {
    const harness = createPort(new Error('write failed'))
    const { serial } = createSerial(harness.port)
    const transport = new WebSerialTransport({ serial })
    await transport.open()

    await expect(transport.write(Uint8Array.of(1))).rejects.toBeInstanceOf(TransportIOError)
    await transport.close()
  })
})
