import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOCUMENT,
  DocumentValidationError,
  PREVIEW_MODES,
  parseLabelDocument,
  type LabelTemplate,
} from './document'
import {
  DOCUMENT_STORAGE_KEY,
  importTemplateJson,
  loadDocument,
  saveDocument,
  serializeTemplate,
  type StorageAdapter,
} from './storage'

describe('label document validation', () => {
  it.each(PREVIEW_MODES)('round-trips a document in %s mode', (previewMode) => {
    const document = { ...DEFAULT_DOCUMENT, previewMode }
    expect(parseLabelDocument(document)).toEqual(document)
  })

  it('reports every invalid field', () => {
    expect(() =>
      parseLabelDocument({
        version: 9,
        data: [],
        template: null,
        css: 1,
        previewMode: 'all',
        tapeWidthMm: 18,
        threshold: 256,
      }),
    ).toThrow(DocumentValidationError)

    try {
      parseLabelDocument({})
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError)
      expect((error as DocumentValidationError).issues).toHaveLength(7)
    }
  })
})

describe('template files', () => {
  it.each(PREVIEW_MODES)(
    'exports and imports only template and settings in %s mode',
    (previewMode) => {
      const template: LabelTemplate = {
        version: 1,
        template: '<b>{{0}}</b>',
        css: '.label { width: 30mm; }',
        previewMode,
        tapeWidthMm: 9,
        threshold: 140,
      }
      const document = { ...template, data: 'Alice,Engineering' }
      const json = serializeTemplate(document)

      expect(JSON.parse(json)).toStrictEqual(template)
      expect(importTemplateJson(json)).toStrictEqual(template)
    },
  )

  it('ignores CSV data in older full-document exports', () => {
    const imported = importTemplateJson(JSON.stringify(DEFAULT_DOCUMENT))

    expect(imported).not.toHaveProperty('data')
    expect(imported.template).toBe(DEFAULT_DOCUMENT.template)
    expect(imported.css).toBe(DEFAULT_DOCUMENT.css)
    expect(imported.tapeWidthMm).toBe(DEFAULT_DOCUMENT.tapeWidthMm)
  })

  it.each(['not JSON', 'null', '[]', '{"version":99}'])(
    'rejects an invalid template file: %s',
    (json) => {
      expect(() => importTemplateJson(json)).toThrow()
    },
  )
})

describe('document storage', () => {
  it('loads defaults when there is no saved document', () => {
    const storage = memoryStorage()
    expect(loadDocument(storage)).toEqual({ document: DEFAULT_DOCUMENT })
  })

  it.each(PREVIEW_MODES)('saves and restores a document in %s mode', (previewMode) => {
    const storage = memoryStorage()
    const document = { ...DEFAULT_DOCUMENT, data: 'one,two', previewMode }

    saveDocument(document, storage)

    expect(loadDocument(storage)).toEqual({ document })
    expect(storage.getItem(DOCUMENT_STORAGE_KEY)).not.toBeNull()
  })

  it('keeps invalid storage from replacing the default document', () => {
    const storage = memoryStorage()
    storage.setItem(DOCUMENT_STORAGE_KEY, '{"version":99}')

    const result = loadDocument(storage)

    expect(result.document).toEqual(DEFAULT_DOCUMENT)
    expect(result.error).toMatch(/saved document is invalid/i)
  })

  it('surfaces storage failures', () => {
    const storage: StorageAdapter = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('full')
      },
    }

    expect(loadDocument(storage).error).toMatch(/denied/)
    expect(() => saveDocument(DEFAULT_DOCUMENT, storage)).toThrow(/full/)
  })
})

function memoryStorage(): StorageAdapter {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}
