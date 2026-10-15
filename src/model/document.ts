export const DOCUMENT_VERSION = 1 as const

export const TAPE_WIDTHS_MM = [3.5, 6, 9, 12] as const
export const PREVIEW_MODES = ['selected', 'strip', 'wrapped'] as const

export type TapeWidthMm = (typeof TAPE_WIDTHS_MM)[number]
export type PreviewMode = (typeof PREVIEW_MODES)[number]

export interface LabelDocument {
  version: typeof DOCUMENT_VERSION
  data: string
  template: string
  css: string
  previewMode: PreviewMode
  tapeWidthMm: TapeWidthMm
  threshold: number
}

export type LabelTemplate = Omit<LabelDocument, 'data'>

export const DEFAULT_DOCUMENT: LabelDocument = {
  version: DOCUMENT_VERSION,
  data: [
    'Ada Lovelace,Analytical Engine,1843',
    '"Grace Hopper","Compiler pioneer",1952',
    '"Margaret Hamilton","Apollo flight software",1969',
  ].join('\n'),
  template: [
    '<div class="name">{{0}}</div>',
    '<div class="detail">{{1}}</div>',
    '<div class="year">{{2}}</div>',
  ].join('\n'),
  css: [
    '.label {',
    '  width: 48mm;',
    '  padding: 1.2mm 2mm;',
    '  display: grid;',
    '  grid-template-columns: 1fr auto;',
    '  align-content: center;',
    '  gap: 0.4mm 2mm;',
    '  font-family: Arial, sans-serif;',
    '}',
    '',
    '.name {',
    '  font-size: 14pt;',
    '  font-weight: 700;',
    '}',
    '',
    '.detail {',
    '  font-size: 8pt;',
    '}',
    '',
    '.year {',
    '  grid-column: 2;',
    '  grid-row: 1 / span 2;',
    '  align-self: center;',
    '  font-size: 11pt;',
    '  font-weight: 700;',
    '}',
  ].join('\n'),
  previewMode: 'selected',
  tapeWidthMm: 12,
  threshold: 160,
}

export class DocumentValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid label document: ${issues.join('; ')}`)
    this.name = 'DocumentValidationError'
    this.issues = issues
  }
}

export function createDefaultDocument(): LabelDocument {
  return { ...DEFAULT_DOCUMENT }
}

export function parseLabelDocument(value: unknown): LabelDocument {
  if (!isRecord(value)) {
    throw new DocumentValidationError(['document must be a JSON object'])
  }

  const issues: string[] = []
  if (value.version !== DOCUMENT_VERSION) {
    issues.push(`version must be ${DOCUMENT_VERSION}`)
  }
  if (typeof value.data !== 'string') {
    issues.push('data must be a string')
  }
  if (typeof value.template !== 'string') {
    issues.push('template must be a string')
  }
  if (typeof value.css !== 'string') {
    issues.push('css must be a string')
  }
  if (!PREVIEW_MODES.some((mode) => mode === value.previewMode)) {
    issues.push('previewMode must be "selected", "strip", or "wrapped"')
  }
  if (!TAPE_WIDTHS_MM.some((width) => width === value.tapeWidthMm)) {
    issues.push(`tapeWidthMm must be one of ${TAPE_WIDTHS_MM.join(', ')}`)
  }
  if (
    typeof value.threshold !== 'number' ||
    !Number.isInteger(value.threshold) ||
    value.threshold < 0 ||
    value.threshold > 255
  ) {
    issues.push('threshold must be an integer from 0 to 255')
  }

  if (issues.length > 0) {
    throw new DocumentValidationError(issues)
  }

  return {
    version: DOCUMENT_VERSION,
    data: value.data as string,
    template: value.template as string,
    css: value.css as string,
    previewMode: value.previewMode as PreviewMode,
    tapeWidthMm: value.tapeWidthMm as TapeWidthMm,
    threshold: value.threshold as number,
  }
}

export function parseLabelTemplate(value: unknown): LabelTemplate {
  if (!isRecord(value)) {
    throw new DocumentValidationError(['template must be a JSON object'])
  }

  const { version, template, css, previewMode, tapeWidthMm, threshold } =
    parseLabelDocument({ ...value, data: '' })

  return { version, template, css, previewMode, tapeWidthMm, threshold }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
