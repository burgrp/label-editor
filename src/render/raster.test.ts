import { describe, expect, it } from 'vitest'
import {
  PRINT_HEAD_DOTS,
  mmToDots,
  packRasterColumns,
  printableDotsForTape,
  rgbaToPrintHeadRaster,
} from './raster'

describe('PT-P300BT raster conversion', () => {
  it('maps physical tape widths to 180 DPI dots', () => {
    expect(mmToDots(3.5)).toBe(25)
    expect(mmToDots(6)).toBe(43)
    expect(mmToDots(9)).toBe(64)
    expect(mmToDots(12)).toBe(85)
  })

  it('reserves the PT-P300BT tape-edge margins', () => {
    expect(printableDotsForTape(3.5)).toBe(19)
    expect(printableDotsForTape(6)).toBe(32)
    expect(printableDotsForTape(9)).toBe(48)
    expect(printableDotsForTape(12)).toBe(64)
  })

  it('centres thresholded pixels on the 128-dot head', () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
    ])
    const raster = rgbaToPrintHeadRaster(rgba, 2, 1, 160)
    const offset = Math.floor((PRINT_HEAD_DOTS - 1) / 2)

    expect(raster.pixels[offset * 2]).toBe(1)
    expect(raster.pixels[offset * 2 + 1]).toBe(0)
  })

  it('composites transparent pixels onto white', () => {
    const transparentBlack = new Uint8ClampedArray([0, 0, 0, 0])
    const raster = rgbaToPrintHeadRaster(transparentBlack, 1, 1, 160)

    expect(raster.pixels).not.toContain(1)
  })

  it('packs each raster column into sixteen most-significant-bit-first bytes', () => {
    const pixels = new Uint8Array(PRINT_HEAD_DOTS * 2)
    pixels[0] = 1
    pixels[7 * 2] = 1
    pixels[8 * 2] = 1
    pixels[1 * 2 + 1] = 1

    const packed = packRasterColumns({
      width: 2,
      height: PRINT_HEAD_DOTS,
      pixels,
    })

    expect(packed).toHaveLength(32)
    expect([...packed.slice(0, 3)]).toEqual([0x81, 0x80, 0])
    expect(packed[16]).toBe(0x40)
  })

  it('rejects invalid dimensions and thresholds', () => {
    expect(() =>
      rgbaToPrintHeadRaster(new Uint8ClampedArray(4), 0, 1, 160),
    ).toThrow(/width/)
    expect(() =>
      rgbaToPrintHeadRaster(new Uint8ClampedArray(4), 1, 129, 160),
    ).toThrow(/height/)
    expect(() =>
      rgbaToPrintHeadRaster(new Uint8ClampedArray(4), 1, 1, 300),
    ).toThrow(/threshold/)
  })
})
