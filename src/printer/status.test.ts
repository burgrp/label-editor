import { describe, expect, it } from 'vitest'

import { PrinterProtocolError } from './errors'
import {
  parseStatus,
  STATUS_PACKET_LENGTH,
  STATUS_TYPE_CODES,
} from './status'

function statusFrame(): Uint8Array {
  const frame = new Uint8Array(STATUS_PACKET_LENGTH)
  frame.set([0x80, 0x20, 0x42, 0x30])
  frame[4] = 0x72
  frame[7] = 0x02
  frame[8] = 0x09
  frame[9] = 0x30
  frame[10] = 0x04
  frame[11] = 0x01
  frame[17] = 0x25
  frame[18] = STATUS_TYPE_CODES.errorOccurred
  frame[19] = 0x01
  frame[20] = 0x00
  frame[21] = 0x14
  frame[22] = 0x01
  return frame
}

describe('PT-P300BT status parsing', () => {
  it('exposes model, media, status, phase, notification, power, and errors', () => {
    const status = parseStatus(statusFrame())

    expect(status.modelCode).toBe(0x72)
    expect(status.model).toBe('PT-P300BT')
    expect(status.mediaWidthCode).toBe(4)
    expect(status.mediaWidthMm).toBe(3.5)
    expect(status.mediaType).toBe(1)
    expect(status.mediaLengthMm).toBe(0x25)
    expect(status.statusType).toEqual({ code: 2, name: 'errorOccurred' })
    expect(status.phase).toEqual({
      typeCode: 1,
      type: 'printing',
      number: 0x14,
      name: 'coverOpenWhileReceiving',
    })
    expect(status.notification).toEqual({ code: 1, name: 'coverOpen' })
    expect(status.power).toEqual({ code: 2, state: 'batteryLow' })
    expect(status.errorCode).toBe(0x0930)
    expect(status.hasError).toBe(true)
    expect(status.activeErrors).toEqual([
      'coverOpen',
      'overheated',
      'noMedia',
      'lowBattery',
    ])
    expect(status.errorFlags.cutterJam).toBe(false)
    expect(status.errorFlags.lowBattery).toBe(true)
  })

  it('maps ready state and every supported tape width', () => {
    const expectedWidths = new Map([
      [4, 3.5],
      [6, 6],
      [9, 9],
      [12, 12],
    ])
    for (const [code, width] of expectedWidths) {
      const frame = statusFrame()
      frame[8] = 0
      frame[9] = 0
      frame[10] = code
      frame[18] = STATUS_TYPE_CODES.statusReply
      frame[19] = 0
      frame[20] = 0
      frame[21] = 0
      const status = parseStatus(frame)
      expect(status.mediaWidthMm).toBe(width)
      expect(status.phase.name).toBe('ready')
      expect(status.hasError).toBe(false)
    }
  })

  it('preserves unknown values without misclassifying them', () => {
    const frame = statusFrame()
    frame[4] = 0xff
    frame[7] = 0xff
    frame[10] = 18
    frame[18] = 0xff
    frame[19] = 0xff
    frame[22] = 0xff
    const status = parseStatus(frame)
    expect(status.model).toBe('unknown')
    expect(status.power.state).toBe('unknown')
    expect(status.mediaWidthMm).toBeNull()
    expect(status.statusType.name).toBe('unknown')
    expect(status.phase.type).toBe('unknown')
    expect(status.notification.name).toBe('unknown')
  })

  it('rejects malformed packets and defensively copies raw bytes', () => {
    expect(() => parseStatus(new Uint8Array(31))).toThrow(PrinterProtocolError)
    const invalidMagic = statusFrame()
    invalidMagic[0] = 0
    expect(() => parseStatus(invalidMagic)).toThrow(PrinterProtocolError)

    const frame = statusFrame()
    const parsed = parseStatus(frame)
    frame[4] = 0
    expect(parsed.raw[4]).toBe(0x72)
  })
})
