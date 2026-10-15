import { PrinterProtocolError } from './errors'
import { protocolCodeToTapeWidth, type TapeWidthMm } from './types'

export const STATUS_PACKET_LENGTH = 32
export const PT_P300BT_MODEL_CODE = 0x72

const STATUS_MAGIC = Uint8Array.of(0x80, 0x20, 0x42, 0x30)

export const STATUS_TYPE_CODES = {
  statusReply: 0x00,
  printingCompleted: 0x01,
  errorOccurred: 0x02,
  interfaceModeFinished: 0x03,
  poweredOff: 0x04,
  notification: 0x05,
  phaseChange: 0x06,
} as const

export type StatusTypeName = keyof typeof STATUS_TYPE_CODES | 'unknown'

export type PowerState =
  | 'batteryFull'
  | 'batteryHalf'
  | 'batteryLow'
  | 'batteryCritical'
  | 'ac'
  | 'unknown'

export type PhaseType = 'editing' | 'printing' | 'unknown'
export type PhaseName = 'ready' | 'feed' | 'printing' | 'coverOpenWhileReceiving' | 'unknown'
export type NotificationName = 'none' | 'coverOpen' | 'coverClosed' | 'unknown'

export type PrinterErrorFlag =
  | 'replaceMedia'
  | 'expansionBufferFull'
  | 'communicationError'
  | 'communicationBufferFull'
  | 'coverOpen'
  | 'overheated'
  | 'feedError'
  | 'systemError'
  | 'noMedia'
  | 'endOfMedia'
  | 'cutterJam'
  | 'lowBattery'
  | 'printerInUse'
  | 'printerNotPowered'
  | 'overvoltage'
  | 'fanError'

export type PrinterErrorFlags = Readonly<Record<PrinterErrorFlag, boolean>>

export interface PrinterStatus {
  readonly raw: Uint8Array
  readonly modelCode: number
  readonly model: 'PT-P300BT' | 'unknown'
  readonly power: {
    readonly code: number
    readonly state: PowerState
  }
  readonly mediaWidthCode: number
  readonly mediaWidthMm: TapeWidthMm | null
  readonly mediaType: number
  readonly mediaLengthMm: number
  readonly statusType: {
    readonly code: number
    readonly name: StatusTypeName
  }
  readonly phase: {
    readonly typeCode: number
    readonly type: PhaseType
    readonly number: number
    readonly name: PhaseName
  }
  readonly notification: {
    readonly code: number
    readonly name: NotificationName
  }
  readonly errorCode: number
  readonly errorFlags: PrinterErrorFlags
  readonly activeErrors: readonly PrinterErrorFlag[]
  readonly hasError: boolean
}

const ERROR_FLAG_BITS: ReadonlyArray<readonly [PrinterErrorFlag, number]> = [
  ['replaceMedia', 0],
  ['expansionBufferFull', 1],
  ['communicationError', 2],
  ['communicationBufferFull', 3],
  ['coverOpen', 4],
  ['overheated', 5],
  ['feedError', 6],
  ['systemError', 7],
  ['noMedia', 8],
  ['endOfMedia', 9],
  ['cutterJam', 10],
  ['lowBattery', 11],
  ['printerInUse', 12],
  ['printerNotPowered', 13],
  ['overvoltage', 14],
  ['fanError', 15],
]

function statusTypeName(code: number): StatusTypeName {
  for (const [name, value] of Object.entries(STATUS_TYPE_CODES)) {
    if (value === code) return name as keyof typeof STATUS_TYPE_CODES
  }
  return 'unknown'
}

function powerState(code: number): PowerState {
  const states: readonly PowerState[] = [
    'batteryFull',
    'batteryHalf',
    'batteryLow',
    'batteryCritical',
    'ac',
  ]
  return states[code] ?? 'unknown'
}

function phase(typeCode: number, number: number): {
  type: PhaseType
  name: PhaseName
} {
  if (typeCode === 0x00) {
    if (number === 0x0000) return { type: 'editing', name: 'ready' }
    if (number === 0x0001) return { type: 'editing', name: 'feed' }
    return { type: 'editing', name: 'unknown' }
  }
  if (typeCode === 0x01) {
    if (number === 0x0000) return { type: 'printing', name: 'printing' }
    if (number === 0x0014) return { type: 'printing', name: 'coverOpenWhileReceiving' }
    return { type: 'printing', name: 'unknown' }
  }
  return { type: 'unknown', name: 'unknown' }
}

function notificationName(code: number): NotificationName {
  if (code === 0x00) return 'none'
  if (code === 0x01) return 'coverOpen'
  if (code === 0x02) return 'coverClosed'
  return 'unknown'
}

function parseErrorFlags(errorCode: number): {
  flags: PrinterErrorFlags
  active: readonly PrinterErrorFlag[]
} {
  const mutableFlags = {} as Record<PrinterErrorFlag, boolean>
  const active: PrinterErrorFlag[] = []
  for (const [name, bit] of ERROR_FLAG_BITS) {
    const set = (errorCode & (1 << bit)) !== 0
    mutableFlags[name] = set
    if (set) active.push(name)
  }
  return { flags: mutableFlags, active }
}

export function parseStatus(data: Uint8Array): PrinterStatus {
  if (data.length !== STATUS_PACKET_LENGTH) {
    throw new PrinterProtocolError(
      `Expected a ${STATUS_PACKET_LENGTH}-byte status packet, received ${data.length} bytes.`,
    )
  }
  for (let index = 0; index < STATUS_MAGIC.length; index += 1) {
    if (data[index] !== STATUS_MAGIC[index]) {
      throw new PrinterProtocolError('Status packet has an invalid PT-CBP header.')
    }
  }

  const modelCode = data[4]
  const errorCode = (data[8] << 8) | data[9]
  const parsedErrors = parseErrorFlags(errorCode)
  const phaseNumber = (data[20] << 8) | data[21]
  const parsedPhase = phase(data[19], phaseNumber)

  return {
    raw: data.slice(),
    modelCode,
    model: modelCode === PT_P300BT_MODEL_CODE ? 'PT-P300BT' : 'unknown',
    power: {
      code: data[7],
      state: powerState(data[7]),
    },
    mediaWidthCode: data[10],
    mediaWidthMm: protocolCodeToTapeWidth(data[10]),
    mediaType: data[11],
    mediaLengthMm: data[17],
    statusType: {
      code: data[18],
      name: statusTypeName(data[18]),
    },
    phase: {
      typeCode: data[19],
      type: parsedPhase.type,
      number: phaseNumber,
      name: parsedPhase.name,
    },
    notification: {
      code: data[22],
      name: notificationName(data[22]),
    },
    errorCode,
    errorFlags: parsedErrors.flags,
    activeErrors: parsedErrors.active,
    hasError: errorCode !== 0,
  }
}
