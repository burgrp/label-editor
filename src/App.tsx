import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  EditorPanel,
  type EditorDiagnostic,
} from './components/EditorPanel'
import { PreviewPane } from './components/PreviewPane'
import { findRecordIndexAtOffset, parseCsv } from './csv/parseCsv'
import {
  TAPE_WIDTHS_MM,
  type LabelDocument,
  type TapeWidthMm,
} from './model/document'
import {
  importTemplateJson,
  loadDocument,
  saveDocument,
  serializeTemplate,
} from './model/storage'
import {
  PrinterError,
  PTP300BTPrinter,
  WebSerialTransport,
  type PrinterStatus,
} from './printer'
import {
  renderLabels,
} from './render/renderLabels'
import { packRasterColumns } from './render/raster'
import {
  interpolateTemplate,
  validateTemplateSyntax,
} from './template/interpolate'
import {
  sanitizeLabelHtml,
  validateCssSafety,
  validateTemplateSafety,
} from './template/security'

interface Notice {
  kind: 'error' | 'info'
  message: string
}

type PrinterState =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'printing'

interface PrintProgressState {
  completedLines: number
  totalLines: number
  percent: number
}

function App() {
  const initial = useMemo(() => loadDocument(), [])
  const serialSupported = useMemo(() => hasWebSerialSupport(), [])
  const [document, setDocument] = useState<LabelDocument>(initial.document)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [dataFileRevision, setDataFileRevision] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(
    initial.error ? { kind: 'error', message: initial.error } : null,
  )
  const [printerState, setPrinterState] = useState<PrinterState>(
    serialSupported ? 'disconnected' : 'unsupported',
  )
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(null)
  const [printProgress, setPrintProgress] =
    useState<PrintProgressState | null>(null)
  const templateInput = useRef<HTMLInputElement>(null)
  const dataInput = useRef<HTMLInputElement>(null)
  const printerRef = useRef<PTP300BTPrinter | null>(null)

  const csv = useMemo(() => parseCsv(document.data), [document.data])
  const selectedRecord = findRecordIndexAtOffset(csv.records, cursorOffset)
  const templateDiagnostics = useMemo(
    () => [
      ...validateTemplateSyntax(document.template),
      ...validateTemplateSafety(document.template),
    ],
    [document.template],
  )
  const cssDiagnostics = useMemo(
    () => validateCssSafety(document.css),
    [document.css],
  )

  const compiledLabels = useMemo(
    () =>
      csv.records.map((record, recordIndex) => {
        const result = interpolateTemplate(document.template, record.values)
        return {
          html: sanitizeLabelHtml(result.html),
          classes: result.classes,
          missingColumns: result.missingColumns,
          safetyDiagnostics: validateTemplateSafety(result.html),
          recordIndex,
        }
      }),
    [csv.records, document.template],
  )

  const runtimeSafetyDiagnostics = compiledLabels.flatMap(
    (label) => label.safetyDiagnostics,
  )
  const previewLabels = useMemo(
    () =>
      document.previewMode === 'selected'
        ? (compiledLabels[selectedRecord]
            ? [compiledLabels[selectedRecord]]
            : [])
        : compiledLabels,
    [compiledLabels, document.previewMode, selectedRecord],
  )
  const labelMarkup = useMemo(
    () => previewLabels.map(({ html, classes }) => ({ html, classes })),
    [previewLabels],
  )
  const blockingMessage =
    csv.diagnostics[0]?.message ??
    templateDiagnostics[0]?.message ??
    cssDiagnostics[0]?.message ??
    runtimeSafetyDiagnostics[0]?.message ??
    (csv.records.length === 0 ? 'Add at least one non-empty CSV record.' : undefined)
  const missingWarnings = compiledLabels.flatMap((label) =>
    label.missingColumns.map(
      (column) => `Row ${label.recordIndex + 1} has no column ${column}.`,
    ),
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        saveDocument(document)
      } catch (error) {
        setNotice({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }, 400)
    return () => window.clearTimeout(timeout)
  }, [document])

  useEffect(
    () => () => {
      const printer = printerRef.current
      printerRef.current = null
      if (printer) {
        void printer.disconnect().catch((error: unknown) => {
          console.error('Could not disconnect the printer during cleanup.', error)
        })
      }
    },
    [],
  )

  const updateDocument = useCallback(
    <Key extends keyof LabelDocument>(
      key: Key,
      value: LabelDocument[Key],
    ) => {
      setDocument((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const handleTemplateExport = () => {
    try {
      downloadTextFile(serializeTemplate(document), 'label-template.json', 'application/json')
      setNotice({ kind: 'info', message: 'Template and settings exported.' })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `Could not export template and settings: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const handleSaveData = () => {
    try {
      downloadTextFile(document.data, 'label-data.csv', 'text/csv;charset=utf-8')
      setNotice({ kind: 'info', message: 'CSV data downloaded.' })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `Could not save CSV data: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const handleTemplateImport = async (file: File | undefined) => {
    if (!file) {
      return
    }
    try {
      const imported = importTemplateJson(await file.text())
      setDocument((current) => ({ ...current, ...imported }))
      setNotice({
        kind: 'info',
        message: `Imported template and settings from ${file.name}.`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `Could not import template and settings: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      if (templateInput.current) {
        templateInput.current.value = ''
      }
    }
  }

  const handleLoadData = async (file: File | undefined) => {
    if (!file) {
      return
    }

    try {
      const data = (await file.text()).replace(/^\uFEFF/, '')
      const parsed = parseCsv(data)
      updateDocument('data', data)
      setCursorOffset(0)
      setDataFileRevision((revision) => revision + 1)
      const error = parsed.diagnostics[0]
      setNotice(
        error
          ? {
              kind: 'error',
              message: `Loaded ${file.name}; correct the CSV before printing: ${error.message}`,
            }
          : { kind: 'info', message: `Loaded data from ${file.name}.` },
      )
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `Could not load CSV data: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      if (dataInput.current) {
        dataInput.current.value = ''
      }
    }
  }

  const handleConnect = async () => {
    if (!serialSupported || printerState !== 'disconnected') {
      return
    }

    const printer = new PTP300BTPrinter(new WebSerialTransport())
    printerRef.current = printer
    setPrinterState('connecting')
    setNotice(null)

    try {
      await printer.connect()
      const status = await printer.queryStatus()
      setPrinterStatus(status)
      syncDetectedMedia(status)
      setPrinterState('connected')

      if (status.hasError) {
        setNotice({
          kind: 'error',
          message: `Printer connected with an error: ${formatPrinterFlags(status.activeErrors)}.`,
        })
      } else {
        setNotice({
          kind: 'info',
          message: `${status.model} connected${status.mediaWidthMm ? ` with ${status.mediaWidthMm} mm tape` : ''}.`,
        })
      }
    } catch (error) {
      let message = printerErrorMessage(error)
      try {
        await printer.disconnect()
      } catch (cleanupError) {
        message += ` Cleanup also failed: ${printerErrorMessage(cleanupError)}`
      }
      printerRef.current = null
      setPrinterStatus(null)
      setPrinterState('disconnected')
      setNotice({ kind: 'error', message })
    }
  }

  const handleDisconnect = async () => {
    const printer = printerRef.current
    if (!printer || printerState !== 'connected') {
      return
    }

    setPrinterState('disconnecting')
    try {
      await printer.disconnect()
      setNotice({ kind: 'info', message: 'Printer disconnected.' })
    } catch (error) {
      setNotice({ kind: 'error', message: printerErrorMessage(error) })
    } finally {
      printerRef.current = null
      setPrinterStatus(null)
      setPrintProgress(null)
      setPrinterState('disconnected')
    }
  }

  const handlePrint = async (mode: 'selected' | 'strip') => {
    const printer = printerRef.current
    if (
      !printer ||
      printerState !== 'connected' ||
      blockingMessage ||
      compiledLabels.length === 0
    ) {
      return
    }

    const labels =
      mode === 'strip'
        ? compiledLabels
        : (compiledLabels[selectedRecord]
            ? [compiledLabels[selectedRecord]]
            : [])
    setPrinterState('printing')
    setPrintProgress({ completedLines: 0, totalLines: 0, percent: 0 })
    setNotice(null)

    try {
      const job = await renderLabels({
        labels: labels.map(({ html, classes }) => ({ html, classes })),
        css: document.css,
        tapeWidthMm: document.tapeWidthMm,
        threshold: document.threshold,
      })
      const rasterBytes = packRasterColumns(job.raster)
      let lastPercent = -1
      const result = await printer.print(rasterBytes, {
        tapeWidthMm: document.tapeWidthMm,
        onProgress: (progress) => {
          const percent = Math.floor(progress.fraction * 100)
          if (percent === lastPercent && progress.fraction < 1) {
            return
          }
          lastPercent = percent
          setPrintProgress({
            completedLines: progress.completedLines,
            totalLines: progress.totalLines,
            percent,
          })
        },
      })

      setPrinterStatus(result.completionStatus)
      syncDetectedMedia(result.completionStatus)
      setPrinterState('connected')
      setNotice({
        kind: 'info',
        message: `${mode === 'strip' ? 'Strip' : 'Selected label'} sent successfully (${result.linesPrinted} raster lines).`,
      })
    } catch (error) {
      const stillConnected = printer.isConnected
      if (!stillConnected) {
        printerRef.current = null
        setPrinterStatus(null)
      }
      setPrinterState(stillConnected ? 'connected' : 'disconnected')
      setNotice({ kind: 'error', message: printerErrorMessage(error) })
    } finally {
      setPrintProgress(null)
    }
  }

  const syncDetectedMedia = (status: PrinterStatus) => {
    if (
      status.mediaWidthMm !== null &&
      status.mediaWidthMm !== document.tapeWidthMm
    ) {
      updateDocument('tapeWidthMm', status.mediaWidthMm)
    }
  }

  const dataDiagnostics: EditorDiagnostic[] = csv.diagnostics.map(
    (diagnostic) => ({ ...diagnostic, severity: 'error' }),
  )
  const htmlDiagnostics: EditorDiagnostic[] = templateDiagnostics.map(
    (diagnostic) => ({ ...diagnostic, severity: 'error' }),
  )
  const styleDiagnostics: EditorDiagnostic[] = cssDiagnostics.map(
    (diagnostic) => ({ ...diagnostic, severity: 'error' }),
  )

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            PT
          </span>
          <h1>Label Editor</h1>
        </div>
          <div
            className="template-file-actions"
            role="group"
            aria-label="Template and settings"
          >
            <span
              className="file-actions-label"
              title="HTML, CSS, and settings; CSV data is loaded separately."
            >
              Template
            </span>
            <div className="file-action-buttons">
              <input
                ref={templateInput}
                className="visually-hidden"
                type="file"
                aria-label="Template and settings file"
                accept="application/json,.json"
                onChange={(event) =>
                  void handleTemplateImport(event.target.files?.[0])
                }
              />
              <button
                type="button"
                aria-label="Import template and settings"
                title="Import HTML, CSS, and settings; keep CSV data unchanged."
                onClick={() => templateInput.current?.click()}
              >
                Import
              </button>
              <button
                type="button"
                aria-label="Export template and settings"
                title="Export HTML, CSS, and settings without CSV data."
                onClick={handleTemplateExport}
              >
                Export
              </button>
            </div>
          </div>
        <section className="toolbar-group render-settings" aria-label="Printer settings">
            <label className="field-control">
              <span>Tape</span>
              <select
                value={document.tapeWidthMm}
                onChange={(event) =>
                  updateDocument('tapeWidthMm', Number(event.target.value) as TapeWidthMm)
                }
              >
                {TAPE_WIDTHS_MM.map((width) => (
                  <option key={width} value={width}>{width} mm</option>
                ))}
              </select>
            </label>
            <label className="field-control threshold-control">
              <span>Threshold</span>
              <input
                aria-label="Black threshold"
                type="range"
                min="0"
                max="255"
                value={document.threshold}
                onChange={(event) => updateDocument('threshold', Number(event.target.value))}
              />
              <output>{document.threshold}</output>
            </label>
        </section>
        <div className="toolbar-group printer-controls" role="group" aria-label="Printer">
          <span
            className={`printer-badge ${printerState}`}
            title={
              printerState === 'unsupported'
                ? 'Printing requires Web Serial in a secure Chrome or Edge context.'
                : undefined
            }
          >
            {printerStatusLabel(
              printerState,
              printerStatus,
              printProgress,
            )}
          </span>
          <button
            type="button"
            disabled={
              printerState === 'unsupported' ||
              printerState === 'connecting' ||
              printerState === 'disconnecting' ||
              printerState === 'printing'
            }
            onClick={() =>
              void (printerState === 'connected'
                ? handleDisconnect()
                : handleConnect())
            }
          >
            {printerActionLabel(printerState)}
          </button>
        </div>
        <div className="toolbar-group print-controls" role="group" aria-label="Print">
        {printerState === 'printing' && printProgress && (
          <label className="print-progress">
            <span className="visually-hidden">Print transfer progress</span>
            <progress
              max={printProgress.totalLines || 1}
              value={printProgress.completedLines}
            />
            <output>{printProgress.percent}%</output>
          </label>
        )}
        <button
          type="button"
          disabled={
            printerState !== 'connected' ||
            Boolean(blockingMessage) ||
            csv.records.length === 0
          }
          onClick={() => void handlePrint('selected')}
        >
          Print current
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            printerState !== 'connected' ||
            Boolean(blockingMessage) ||
            csv.records.length === 0
          }
          onClick={() => void handlePrint('strip')}
        >
          Print strip
        </button>
        </div>
      </header>

      <section className="workspace">
        <EditorPanel
          key={dataFileRevision}
          id="data-editor"
          title="Data"
          description={
            <>
              CSV -{' '}
              <span className="selection-status">
                {csv.records.length === 0
                  ? 'No labels'
                  : `Row ${selectedRecord + 1} of ${csv.records.length}`}
              </span>
            </>
          }
          value={document.data}
          language="csv"
          diagnostics={dataDiagnostics}
          headerActions={
            <>
              <input
                ref={dataInput}
                className="visually-hidden"
                type="file"
                aria-label="CSV data file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) =>
                  void handleLoadData(event.target.files?.[0])
                }
              />
              <button
                type="button"
                title="Load CSV data without changing the template or settings."
                onClick={() => dataInput.current?.click()}
              >
                Load CSV
              </button>
              <button
                type="button"
                title="Download the current CSV text without changing the template or settings."
                onClick={handleSaveData}
              >
                Save CSV
              </button>
            </>
          }
          onChange={(value) => updateDocument('data', value)}
          onCursorChange={setCursorOffset}
        />
        <EditorPanel
          id="html-editor"
          title="HTML"
          description="Insert escaped values with {{0}}, {{1}}, ..."
          value={document.template}
          language="html"
          diagnostics={htmlDiagnostics}
          maxColumns={csv.maxColumns}
          columnSamples={csv.records[0]?.values}
          onChange={(value) => updateDocument('template', value)}
        />
        <EditorPanel
          id="css-editor"
          title="CSS"
          description=".label height follows the selected tape"
          value={document.css}
          language="css"
          diagnostics={styleDiagnostics}
          onChange={(value) => updateDocument('css', value)}
        />
        <PreviewPane
          labels={labelMarkup}
          css={document.css}
          tapeWidthMm={document.tapeWidthMm}
          threshold={document.threshold}
          previewMode={document.previewMode}
          zoom={document.zoom}
          onZoomChange={(zoom) => updateDocument('zoom', zoom)}
          onPreviewModeChange={(mode) => updateDocument('previewMode', mode)}
          blockedMessage={blockingMessage}
        />
      </section>

      <footer className="status-bar">
        <span
          className={`status-indicator ${blockingMessage ? 'error' : 'ready'}`}
        />
        <span>
          {blockingMessage
            ? `Cannot preview or print: ${blockingMessage}`
            : missingWarnings[0] ??
              `${csv.records.length} label${csv.records.length === 1 ? '' : 's'} ready`}
        </span>
        {missingWarnings.length > 1 && (
          <span className="status-detail">
            +{missingWarnings.length - 1} more warnings
          </span>
        )}
        {printerState === 'unsupported' && (
          <span className="status-detail">
            Printing needs Chrome or Edge over HTTPS or localhost.
          </span>
        )}
        {notice && (
          <button
            type="button"
            className={`notice ${notice.kind}`}
            onClick={() => setNotice(null)}
          >
            {notice.message}
            <span aria-hidden="true"> x</span>
          </button>
        )}
        <nav className="status-links" aria-label="Design resources">
          <a
            href="https://fonts.google.com/?preview.script=Latn"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Fonts
          </a>
          <span aria-hidden="true">|</span>
          <a
            href="https://fonts.google.com/icons"
            target="_blank"
            rel="noopener noreferrer"
            title="Browse Google Material Symbols (opens in a new tab)"
          >
            Google Icons
          </a>
          <span aria-hidden="true">|</span>
          <a
            href="https://fontawesome.com/v7/search?ic=free-collection"
            target="_blank"
            rel="noopener noreferrer"
            title="Search Font Awesome 7 Free icons (opens in a new tab)"
          >
            FA Icons
          </a>
          <span aria-hidden="true">|</span>
          <a
            href="https://developer.mozilla.org/en-US/docs/Web/CSS"
            target="_blank"
            rel="noopener noreferrer"
          >
            CSS reference
          </a>
        </nav>
      </footer>
    </main>
  )
}

export default App

function downloadTextFile(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  try {
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function hasWebSerialSupport(): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof window === 'undefined' ||
    !window.isSecureContext
  ) {
    return false
  }
  const serial = (
    navigator as Navigator & {
      serial?: { requestPort?: unknown }
    }
  ).serial
  return typeof serial?.requestPort === 'function'
}

function printerStatusLabel(
  state: PrinterState,
  status: PrinterStatus | null,
  progress: PrintProgressState | null,
): string {
  if (state === 'unsupported') {
    return 'Web Serial unavailable'
  }
  if (state === 'connecting') {
    return 'Connecting...'
  }
  if (state === 'disconnecting') {
    return 'Disconnecting...'
  }
  if (state === 'printing') {
    return progress?.totalLines
      ? `Sending ${progress.percent}%`
      : 'Preparing print...'
  }
  if (state === 'connected' && status) {
    const media = status.mediaWidthMm ? ` - ${status.mediaWidthMm} mm` : ''
    return `${status.model}${media}`
  }
  return 'Printer not connected'
}

function printerActionLabel(state: PrinterState): string {
  if (state === 'connecting') {
    return 'Connecting...'
  }
  if (state === 'disconnecting') {
    return 'Disconnecting...'
  }
  if (state === 'connected') {
    return 'Disconnect'
  }
  if (state === 'printing') {
    return 'Printing...'
  }
  return 'Connect printer'
}

function printerErrorMessage(error: unknown): string {
  if (error instanceof PrinterError) {
    return `Printer ${error.code}: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

function formatPrinterFlags(flags: readonly string[]): string {
  return flags
    .map((flag) => flag.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`))
    .join(', ')
}
