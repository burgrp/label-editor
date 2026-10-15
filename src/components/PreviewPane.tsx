import { useEffect, useRef, useState, type PointerEvent } from 'react'
import {
  PREVIEW_MODES,
  type PreviewMode,
  type TapeWidthMm,
} from '../model/document'
import {
  renderLabels,
  type LabelMarkup,
  type RenderedLabels,
} from '../render/renderLabels'
import { dotsToMm, mmToDots } from '../render/raster'
import { FontLoadingError } from '../render/googleFonts'

const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  selected: 'Selected row',
  strip: 'Strip',
  wrapped: 'Wrapped',
}

interface PreviewPaneProps {
  labels: readonly LabelMarkup[]
  css: string
  tapeWidthMm: TapeWidthMm
  threshold: number
  previewMode: PreviewMode
  onPreviewModeChange: (mode: PreviewMode) => void
  blockedMessage?: string
  onRendered?: (rendered: RenderedLabels | null) => void
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; fontMessage?: string }
  | { status: 'ready'; rendered: RenderedLabels }
  | { status: 'error'; message: string; fontError: boolean }

interface PanOrigin {
  pointerId: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
}

export function PreviewPane({
  labels,
  css,
  tapeWidthMm,
  threshold,
  previewMode,
  onPreviewModeChange,
  blockedMessage,
  onRendered,
}: PreviewPaneProps) {
  const panOrigin = useRef<PanOrigin | null>(null)
  const [zoom, setZoom] = useState(3)
  const wrapLabels = previewMode === 'wrapped'
  const [isPanning, setIsPanning] = useState(false)
  const [state, setState] = useState<PreviewState>({ status: 'idle' })

  useEffect(() => {
    onRendered?.(null)
    if (blockedMessage) {
      return
    }

    const controller = new AbortController()
    const delay = window.setTimeout(() => {
      setState({ status: 'loading' })
      void renderLabels({
        labels,
        css,
        tapeWidthMm,
        threshold,
        signal: controller.signal,
        onFontLoading: (fontMessage) => {
          if (!controller.signal.aborted) {
            setState({ status: 'loading', fontMessage })
          }
        },
      })
        .then((rendered) => {
          if (controller.signal.aborted) {
            return
          }
          setState({ status: 'ready', rendered })
          onRendered?.(rendered)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return
          }
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
            fontError: error instanceof FontLoadingError,
          })
        })
    }, 180)

    return () => {
      window.clearTimeout(delay)
      controller.abort()
    }
  }, [
    blockedMessage,
    css,
    labels,
    onRendered,
    tapeWidthMm,
    threshold,
  ])

  const startPanning = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      state.status !== 'ready' ||
      blockedMessage
    ) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panOrigin.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    }
    setIsPanning(true)
  }

  const pan = (event: PointerEvent<HTMLDivElement>) => {
    const origin = panOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) {
      return
    }

    event.currentTarget.scrollLeft =
      origin.scrollLeft - (event.clientX - origin.clientX)
    event.currentTarget.scrollTop =
      origin.scrollTop - (event.clientY - origin.clientY)
  }

  const stopPanning = (event: PointerEvent<HTMLDivElement>) => {
    if (panOrigin.current?.pointerId !== event.pointerId) {
      return
    }

    panOrigin.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const segmentEnds =
    state.status === 'ready'
      ? wrapLabels
        ? state.rendered.segmentEnds.filter(
            (end, index, ends) => end > (ends[index - 1] ?? 0),
          )
        : [state.rendered.raster.width]
      : []
  const canPan = state.status === 'ready' && !blockedMessage

  return (
    <section className="panel preview-panel" aria-labelledby="preview-title">
      <header className="panel-header preview-header">
        <div>
          <h2 id="preview-title">Print preview</h2>
          <p>
            {state.status === 'ready'
              ? `${state.rendered.lengthMm.toFixed(1)} mm long`
              : 'The one-bit raster sent to the printer'}
          </p>
        </div>
        <div className="preview-controls">
          <span className="font-status" role="status">
            {state.status === 'loading' && state.fontMessage
              ? state.fontMessage
              : state.status === 'error' && state.fontError
                ? 'Fonts failed'
                : state.status === 'ready' && state.rendered.fontFamilies.length > 0
                  ? state.rendered.fontWarning ??
                    `Fonts ready: ${state.rendered.fontFamilies.join(', ')}`
                  : ''}
          </span>
          <fieldset className="segmented-control">
            <legend>Preview mode</legend>
            {PREVIEW_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={previewMode === mode}
                onClick={() => onPreviewModeChange(mode)}
              >
                {PREVIEW_MODE_LABELS[mode]}
              </button>
            ))}
          </fieldset>
          <label className="zoom-control">
            <span>Zoom</span>
            <input
              aria-label="Preview zoom"
              type="range"
              min="1"
              max="8"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <output>{zoom}x</output>
          </label>
        </div>
      </header>
      <div
        className={`preview-viewport${canPan ? ' can-pan' : ''}${isPanning ? ' is-panning' : ''}`}
        onPointerDown={startPanning}
        onPointerMove={pan}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
        onLostPointerCapture={stopPanning}
      >
        {blockedMessage ? (
          <PreviewMessage title="Preview unavailable" message={blockedMessage} />
        ) : state.status === 'loading' ? (
          <PreviewMessage title="Rendering" message={state.fontMessage ?? 'Updating the print raster...'} />
        ) : state.status === 'error' ? (
          <PreviewMessage title="Rendering failed" message={state.message} error />
        ) : state.status === 'ready' ? (
          <div className={`preview-tapes${wrapLabels ? ' is-wrapped' : ''}`}>
            {segmentEnds.map((to, index) => (
              <PreviewCanvas
                key={`${wrapLabels}-${index}`}
                rendered={state.rendered}
                tapeWidthMm={tapeWidthMm}
                zoom={zoom}
                from={segmentEnds[index - 1] ?? 0}
                to={to}
                label={
                  wrapLabels
                    ? `Monochrome label preview ${index + 1}`
                    : 'Monochrome label preview'
                }
              />
            ))}
          </div>
        ) : (
          <PreviewMessage title="Preview" message="Waiting for a valid label." />
        )}
      </div>
    </section>
  )
}

function PreviewCanvas({
  rendered,
  tapeWidthMm,
  zoom,
  from,
  to,
  label,
}: {
  rendered: RenderedLabels
  tapeWidthMm: TapeWidthMm
  zoom: number
  from: number
  to: number
  label: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) {
      paintPreview(canvasRef.current, rendered, tapeWidthMm, from, to)
    }
  }, [from, rendered, tapeWidthMm, to])

  return (
    <div className="tape-shadow">
      <canvas
        ref={canvasRef}
        aria-label={label}
        style={{
          width: `${dotsToMm(to - from) * zoom}mm`,
          height: `${tapeWidthMm * zoom}mm`,
        }}
      />
    </div>
  )
}

function PreviewMessage({
  title,
  message,
  error = false,
}: {
  title: string
  message: string
  error?: boolean
}) {
  return (
    <div className={`preview-message${error ? ' error' : ''}`} role="status">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  )
}

function paintPreview(
  canvas: HTMLCanvasElement,
  rendered: RenderedLabels,
  tapeWidthMm: TapeWidthMm,
  from: number,
  to: number,
): void {
  const width = to - from
  const tapeDots = mmToDots(tapeWidthMm)
  const offsetY = Math.floor((rendered.raster.height - tapeDots) / 2)
  canvas.width = width
  canvas.height = tapeDots
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  const image = context.createImageData(width, tapeDots)
  for (let y = 0; y < tapeDots; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y + offsetY) * rendered.raster.width + from + x
      const target = (y * width + x) * 4
      const color = rendered.raster.pixels[source] === 1 ? 18 : 255
      image.data[target] = color
      image.data[target + 1] = color
      image.data[target + 2] = color
      image.data[target + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)

  context.save()
  context.strokeStyle = 'rgba(37, 99, 235, 0.55)'
  context.setLineDash([2, 2])
  for (const end of rendered.segmentEnds.slice(0, -1)) {
    if (end <= from || end >= to) {
      continue
    }
    context.beginPath()
    context.moveTo(end - from + 0.5, 0)
    context.lineTo(end - from + 0.5, tapeDots)
    context.stroke()
  }
  context.restore()
}
