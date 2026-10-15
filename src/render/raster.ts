export const PRINTER_DPI = 180
export const PRINT_HEAD_DOTS = 128
export const MAX_PRINTABLE_DOTS = 64
export const MAX_PRINT_LENGTH_MM = 499

export interface MonochromeRaster {
  width: number
  height: typeof PRINT_HEAD_DOTS
  pixels: Uint8Array
}

export function mmToDots(millimetres: number): number {
  return Math.round((millimetres * PRINTER_DPI) / 25.4)
}

export function dotsToMm(dots: number): number {
  return (dots * 25.4) / PRINTER_DPI
}

export function printableDotsForTape(tapeWidthMm: number): number {
  return Math.round((MAX_PRINTABLE_DOTS * tapeWidthMm) / 12)
}

export function rgbaToPrintHeadRaster(
  rgba: Uint8ClampedArray,
  width: number,
  sourceHeight: number,
  threshold: number,
): MonochromeRaster {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error('Raster width must be a positive integer.')
  }
  if (
    !Number.isInteger(sourceHeight) ||
    sourceHeight <= 0 ||
    sourceHeight > PRINT_HEAD_DOTS
  ) {
    throw new Error(
      `Raster height must be between 1 and ${PRINT_HEAD_DOTS} dots.`,
    )
  }
  if (rgba.length !== width * sourceHeight * 4) {
    throw new Error('RGBA data length does not match its dimensions.')
  }
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error('Raster threshold must be an integer from 0 to 255.')
  }

  const pixels = new Uint8Array(width * PRINT_HEAD_DOTS)
  const offsetY = Math.floor((PRINT_HEAD_DOTS - sourceHeight) / 2)

  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (sourceY * width + x) * 4
      const alpha = rgba[sourceIndex + 3] / 255
      const red = (rgba[sourceIndex] ?? 255) * alpha + 255 * (1 - alpha)
      const green =
        (rgba[sourceIndex + 1] ?? 255) * alpha + 255 * (1 - alpha)
      const blue =
        (rgba[sourceIndex + 2] ?? 255) * alpha + 255 * (1 - alpha)
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue

      if (luminance < threshold) {
        const targetY = sourceY + offsetY
        pixels[targetY * width + x] = 1
      }
    }
  }

  return { width, height: PRINT_HEAD_DOTS, pixels }
}

export function packRasterColumns(raster: MonochromeRaster): Uint8Array {
  if (
    raster.height !== PRINT_HEAD_DOTS ||
    raster.pixels.length !== raster.width * PRINT_HEAD_DOTS
  ) {
    throw new Error('Raster does not match the 128-dot PT-P300BT print head.')
  }

  const bytesPerColumn = PRINT_HEAD_DOTS / 8
  const packed = new Uint8Array(raster.width * bytesPerColumn)

  for (let x = 0; x < raster.width; x += 1) {
    for (let y = 0; y < PRINT_HEAD_DOTS; y += 1) {
      if (raster.pixels[y * raster.width + x] === 0) {
        continue
      }
      const byteIndex = x * bytesPerColumn + Math.floor(y / 8)
      packed[byteIndex] |= 0x80 >> (y % 8)
    }
  }

  return packed
}

export function rasterToImageData(raster: MonochromeRaster): ImageData {
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4)

  for (let index = 0; index < raster.pixels.length; index += 1) {
    const color = raster.pixels[index] === 1 ? 0 : 255
    const target = index * 4
    rgba[target] = color
    rgba[target + 1] = color
    rgba[target + 2] = color
    rgba[target + 3] = 255
  }

  return new ImageData(rgba, raster.width, raster.height)
}
