import {
  createDefaultDocument,
  parseLabelDocument,
  parseLabelTemplate,
  type LabelDocument,
  type LabelTemplate,
} from './document'

export const DOCUMENT_STORAGE_KEY = 'brother-pt-label-editor.document.v1'

export interface DocumentLoadResult {
  document: LabelDocument
  error?: string
}

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function loadDocument(
  storage: StorageAdapter = window.localStorage,
): DocumentLoadResult {
  let stored: string | null
  try {
    stored = storage.getItem(DOCUMENT_STORAGE_KEY)
  } catch (error) {
    return {
      document: createDefaultDocument(),
      error: `Could not read the saved document: ${errorMessage(error)}`,
    }
  }

  if (stored === null) {
    return { document: createDefaultDocument() }
  }

  try {
    return { document: parseLabelDocument(JSON.parse(stored)) }
  } catch (error) {
    return {
      document: createDefaultDocument(),
      error: `The saved document is invalid: ${errorMessage(error)}`,
    }
  }
}

export function saveDocument(
  document: LabelDocument,
  storage: StorageAdapter = window.localStorage,
): void {
  const validated = parseLabelDocument(document)
  try {
    storage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify(validated))
  } catch (error) {
    throw new Error(`Could not save the document: ${errorMessage(error)}`)
  }
}

export function serializeTemplate(template: LabelTemplate): string {
  return `${JSON.stringify(parseLabelTemplate(template), null, 2)}\n`
}

export function importTemplateJson(json: string): LabelTemplate {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`The selected file is not valid JSON: ${errorMessage(error)}`)
  }
  return parseLabelTemplate(parsed)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
