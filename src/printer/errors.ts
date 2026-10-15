export type PrinterErrorCode =
  | 'unsupported'
  | 'permission'
  | 'timeout'
  | 'disconnected'
  | 'io'
  | 'protocol'
  | 'validation'
  | 'status'
  | 'busy'

export class PrinterError extends Error {
  readonly code: PrinterErrorCode

  constructor(code: PrinterErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

export class WebSerialUnsupportedError extends PrinterError {
  constructor(message = 'Web Serial is not supported by this browser.', options?: ErrorOptions) {
    super('unsupported', message, options)
  }
}

export class WebSerialPermissionError extends PrinterError {
  constructor(message = 'Permission to access the printer was not granted.', options?: ErrorOptions) {
    super('permission', message, options)
  }
}

export class TransportTimeoutError extends PrinterError {
  readonly operation: string
  readonly timeoutMs: number

  constructor(operation: string, timeoutMs: number, options?: ErrorOptions) {
    super('timeout', `Timed out while ${operation} after ${timeoutMs} ms.`, options)
    this.operation = operation
    this.timeoutMs = timeoutMs
  }
}

export class TransportDisconnectedError extends PrinterError {
  constructor(message = 'The printer disconnected.', options?: ErrorOptions) {
    super('disconnected', message, options)
  }
}

export class TransportIOError extends PrinterError {
  readonly operation: string

  constructor(operation: string, options?: ErrorOptions) {
    super('io', `Printer I/O failed while ${operation}.`, options)
    this.operation = operation
  }
}

export class PrinterProtocolError extends PrinterError {
  constructor(message: string, options?: ErrorOptions) {
    super('protocol', message, options)
  }
}

export class PrinterValidationError extends PrinterError {
  constructor(message: string, options?: ErrorOptions) {
    super('validation', message, options)
  }
}

export class PrinterStatusError extends PrinterError {
  readonly activeErrors: readonly string[]

  constructor(message: string, activeErrors: readonly string[] = [], options?: ErrorOptions) {
    super('status', message, options)
    this.activeErrors = activeErrors
  }
}

export class PrinterBusyError extends PrinterError {
  constructor() {
    super('busy', 'Another printer operation is already in progress.')
  }
}
