import { toCanvas } from 'html-to-image'
import type { TapeWidthMm } from '../model/document'
import { FONT_AWESOME_CSS, FONT_AWESOME_FONT_CSS } from './fontAwesome'
import { FontLoadingError, resolveGoogleFonts } from './googleFonts'
import { MATERIAL_SYMBOLS_CSS } from './materialSymbols'
import {
  MAX_PRINT_LENGTH_MM,
  dotsToMm,
  mmToDots,
  printableDotsForTape,
  rgbaToPrintHeadRaster,
  type MonochromeRaster,
} from './raster'

const CSS_PIXELS_PER_INCH = 96

export interface LabelMarkup {
  html: string
  classes?: readonly string[]
}

export interface RenderLabelsRequest {
  labels: readonly LabelMarkup[]
  css: string
  tapeWidthMm: TapeWidthMm
  threshold: number
  signal?: AbortSignal
  onFontLoading?: (message: string) => void
}

export interface RenderedLabels {
  raster: MonochromeRaster
  segmentEnds: readonly number[]
  lengthMm: number
  fontFamilies: readonly string[]
  fontWarning?: string
}

export async function renderLabels(
  request: RenderLabelsRequest,
): Promise<RenderedLabels> {
  if (request.labels.length === 0) {
    throw new Error('Add at least one CSV record before previewing or printing.')
  }
  throwIfAborted(request.signal)

  const iframe = createRenderFrame(request.tapeWidthMm)
  document.body.append(iframe)

  try {
    await frameLoaded(iframe, request.signal)
    const frameDocument = iframe.contentDocument
    if (!frameDocument) {
      throw new Error('Could not initialize the isolated label renderer.')
    }

    const iconStyle = frameDocument.createElement('style')
    iconStyle.textContent = `${FONT_AWESOME_CSS}\n${MATERIAL_SYMBOLS_CSS}`
    frameDocument.head.append(iconStyle)

    const userStyle = frameDocument.createElement('style')
    userStyle.textContent = request.css
    frameDocument.head.append(userStyle)

    const constraints = frameDocument.createElement('style')
    constraints.textContent = renderConstraints(request.tapeWidthMm)
    frameDocument.head.append(constraints)

    const strip = frameDocument.getElementById('label-strip')
    if (!strip) {
      throw new Error('The isolated label renderer did not create its strip.')
    }

    for (const label of request.labels) {
      const segment = frameDocument.createElement('section')
      segment.className = 'label-segment'
      const element = frameDocument.createElement('div')
      element.className = 'label'
      if (label.classes?.length) {
        element.classList.add(...label.classes)
      }
      element.innerHTML = label.html
      segment.append(element)
      strip.append(segment)
    }

    const fonts = await resolveGoogleFonts(strip, {
      signal: request.signal,
      onLoading: request.onFontLoading,
    })
    if (fonts.css) {
      const fontStyle = frameDocument.createElement('style')
      fontStyle.textContent = fonts.css
      frameDocument.head.append(fontStyle)
    }
    // Flush layout so newly embedded font faces are requested before fonts.ready.
    strip.getBoundingClientRect()
    await settleFrame(frameDocument, request.signal)
    for (const face of frameDocument.fonts) {
      if (face.status === 'error') {
        throw new FontLoadingError(`Could not decode font ${face.family}; printing with a fallback is disabled.`)
      }
    }

    const bounds = strip.getBoundingClientRect()
    const cssWidth = Math.max(bounds.width, strip.scrollWidth)
    const cssHeight = (request.tapeWidthMm * CSS_PIXELS_PER_INCH) / 25.4
    const targetWidth = Math.max(
      1,
      Math.round((cssWidth * 180) / CSS_PIXELS_PER_INCH),
    )
    const targetHeight = mmToDots(request.tapeWidthMm)
    const lengthMm = dotsToMm(targetWidth)

    if (lengthMm > MAX_PRINT_LENGTH_MM) {
      throw new Error(
        `The strip is ${lengthMm.toFixed(1)} mm long; the PT-P300BT limit is ${MAX_PRINT_LENGTH_MM} mm.`,
      )
    }

    const segmentEnds = [...strip.children].map((child) => {
      const end =
        (child.getBoundingClientRect().right - bounds.left) *
        (180 / CSS_PIXELS_PER_INCH)
      return Math.min(targetWidth, Math.max(1, Math.round(end)))
    })

    throwIfAborted(request.signal)
    const canvas = await toCanvas(strip, {
      width: cssWidth,
      height: cssHeight,
      canvasWidth: targetWidth,
      canvasHeight: targetHeight,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
      fontEmbedCSS: `${FONT_AWESOME_FONT_CSS}\n${fonts.css}`,
      skipAutoScale: true,
    })
    throwIfAborted(request.signal)

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('This browser cannot read the label rendering canvas.')
    }
    const image = context.getImageData(0, 0, targetWidth, targetHeight)

    return {
      raster: rgbaToPrintHeadRaster(
        image.data,
        targetWidth,
        targetHeight,
        request.threshold,
      ),
      segmentEnds,
      lengthMm,
      fontFamilies: fonts.families,
      fontWarning: fonts.warning,
    }
  } finally {
    iframe.remove()
  }
}

function createRenderFrame(tapeWidthMm: TapeWidthMm): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.title = 'Isolated label renderer'
  iframe.tabIndex = -1
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.style.position = 'fixed'
  iframe.style.left = '-100000px'
  iframe.style.top = '0'
  iframe.style.width = '1200px'
  iframe.style.height = `${Math.max(32, tapeWidthMm * 8)}px`
  iframe.style.visibility = 'hidden'
  iframe.srcdoc = [
    '<!doctype html><html><head>',
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" ',
    'content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:">',
    '<style>',
    'html,body{margin:0;padding:0;width:max-content;height:max-content;background:#fff;}',
    '#label-strip{display:inline-flex;align-items:stretch;white-space:normal;}',
    '</style>',
    '</head><body><main id="label-strip"></main></body></html>',
  ].join('')
  return iframe
}

function renderConstraints(tapeWidthMm: TapeWidthMm): string {
  const printableHeightMm = dotsToMm(printableDotsForTape(tapeWidthMm))
  return [
    '.label-segment {',
    `height: ${tapeWidthMm}mm !important;`,
    `min-height: ${tapeWidthMm}mm !important;`,
    `max-height: ${tapeWidthMm}mm !important;`,
    'display: flex !important;',
    'align-items: center !important;',
    'box-sizing: border-box !important;',
    'flex: 0 0 auto !important;',
    'overflow: hidden !important;',
    'background: #fff !important;',
    '}',
    '.label {',
    `height: ${printableHeightMm}mm !important;`,
    `min-height: ${printableHeightMm}mm !important;`,
    `max-height: ${printableHeightMm}mm !important;`,
    'box-sizing: border-box !important;',
    'flex: 0 0 auto !important;',
    'overflow: hidden !important;',
    'color: #000;',
    'background: #fff;',
    '}',
  ].join('')
}

function frameLoaded(
  iframe: HTMLIFrameElement,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (iframe.contentDocument?.getElementById('label-strip')) {
      resolve()
      return
    }

    const onAbort = () => {
      cleanup()
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const onLoad = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      iframe.removeEventListener('load', onLoad)
      signal?.removeEventListener('abort', onAbort)
    }

    iframe.addEventListener('load', onLoad, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function settleFrame(
  frameDocument: Document,
  signal?: AbortSignal,
): Promise<void> {
  await frameDocument.fonts.ready
  const images = [...frameDocument.images]
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) {
        return
      }
      try {
        await image.decode()
      } catch {
        throw new Error(`Could not load inline image "${image.alt || 'unnamed'}".`)
      }
    }),
  )
  throwIfAborted(signal)
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  }
}
