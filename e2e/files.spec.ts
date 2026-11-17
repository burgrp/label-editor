import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_DOCUMENT } from '../src/model/document'
import { mockExo } from './helpers/googleFonts'

interface PickerRequest {
  suggestedName?: string
  types: { description: string; accept: Record<string, string[]> }[]
  multiple?: boolean
}

interface TestFiles {
  files: Record<string, string>
  openName: string
  saveName: string
  openError: string | null
  saveError: string | null
  readError: boolean
  writeError: boolean
  closeError: boolean
  permissionError: boolean
  holdWrite: boolean
  releaseWrite?: () => void
  opens: PickerRequest[]
  saves: PickerRequest[]
  writes: string[]
  closed: string[]
}

declare global {
  interface Window {
    __files: TestFiles
  }
}

const sourceDocument = {
  ...DEFAULT_DOCUMENT,
  data: 'first,loaded\nsecond,loaded',
}

test.beforeEach(async ({ page }) => {
  await mockExo(page)
  await page.addInitScript((initial) => {
    const state: TestFiles = {
      files: { 'source.json': JSON.stringify(initial) },
      openName: 'source.json',
      saveName: 'saved.json',
      openError: null,
      saveError: null,
      readError: false,
      writeError: false,
      closeError: false,
      permissionError: false,
      holdWrite: false,
      opens: [],
      saves: [],
      writes: [],
      closed: [],
    }
    const handle = (name: string) => ({
      name,
      kind: 'file',
      async getFile() {
        if (state.readError) throw new DOMException('Read denied', 'NotReadableError')
        return new File([state.files[name] ?? ''], name)
      },
      async createWritable() {
        if (state.permissionError) {
          throw new DOMException('Write permission denied', 'NotAllowedError')
        }
        let text = ''
        return new WritableStream({
          async write(chunk: string) {
            state.writes.push(name)
            if (state.holdWrite) {
              await new Promise<void>((resolve) => { state.releaseWrite = resolve })
            }
            if (state.writeError) throw new DOMException('Write aborted', 'AbortError')
            text += chunk
          },
          close() {
            if (state.closeError) throw new Error('Commit failed')
            state.files[name] = text
            state.closed.push(name)
          },
        })
      },
    })
    Object.assign(window, {
      __files: state,
      showOpenFilePicker: async (options: PickerRequest) => {
        state.opens.push(options)
        if (state.openError) throw new DOMException('Open denied or cancelled', state.openError)
        return [handle(state.openName)]
      },
      showSaveFilePicker: async (options: PickerRequest) => {
        state.saves.push(options)
        if (state.saveError) throw new DOMException('Save denied or cancelled', state.saveError)
        return handle(state.saveName)
      },
    })
  }, sourceDocument)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('.font-status')).toHaveText('Fonts ready: Exo')
})

test('opens JSON and saves back to the same file without a picker or download', async ({ page }) => {
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await openSource(page)
  await expect(page.getByText('Row 1 of 2')).toBeVisible()
  await editData(page, 'updated,labels')
  await expect(page.getByLabel('Current document')).toHaveText('source.json *')
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('brother-pt-label-editor.document.v1'),
  )).toContain('"data":"updated,labels"')
  expect(await page.evaluate(() => window.__files.writes)).toEqual([])

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('source.json')
  const result = await page.evaluate(() => window.__files)
  expect(JSON.parse(result.files['source.json'])).toEqual({
    ...sourceDocument, data: 'updated,labels',
  })
  expect(result.opens).toEqual([{
    types: [{ description: 'Label document', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  }])
  expect(result.saves).toEqual([])
  expect(result.closed).toEqual(['source.json'])
  expect(downloads).toEqual([])
})

test('Save on a new document chooses a file once and Save As switches the target', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('saved.json')
  await editData(page, 'first,change')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('saved.json')
  expect(await page.evaluate(() => window.__files.saves)).toEqual([{
    types: [{ description: 'Label document', accept: { 'application/json': ['.json'] } }],
    suggestedName: 'label-document.json',
  }])
  await page.evaluate(() => { window.__files.saveName = 'copy.json' })
  await page.getByRole('button', { name: 'Save As...' }).click()
  await expect(page.getByLabel('Current document')).toHaveText('copy.json')
  await editData(page, 'second,change')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('copy.json')
  const result = await page.evaluate(() => window.__files)
  expect(JSON.parse(result.files['saved.json']).data).toBe('first,change')
  expect(JSON.parse(result.files['copy.json']).data).toBe('second,change')
  expect(result.saves.map((request) => request.suggestedName))
    .toEqual(['label-document.json', 'saved.json'])
})

for (const action of ['Open JSON', 'Save As...'] as const) {
  test(`cancelling ${action} keeps the current file, data, and unsaved state`, async ({ page }) => {
    await openSource(page)
    await editData(page, 'unsaved,changes')
    await page.evaluate(() => {
      window.__files.openError = 'AbortError'
      window.__files.saveError = 'AbortError'
    })
    await page.getByRole('button', { name: action, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await expect(page.getByLabel('Current document')).toHaveText('source.json *')
    await expect(page.locator('#data-editor .cm-content')).toHaveText('unsaved,changes')
    await expect(page.locator('.notice.error')).toHaveCount(0)
    expect(await page.evaluate(() => window.__files.writes)).toEqual([])
  })
}

test('cancelling the first Save does not create a target or clear the unsaved marker', async ({ page }) => {
  await page.evaluate(() => { window.__files.saveError = 'AbortError' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Current document')).toHaveText('label-document.json *')
  await expect(page.locator('.notice')).toHaveCount(0)
})

for (const failure of ['open', 'read', 'invalid'] as const) {
  test(`preserves the current target after an ${failure} failure`, async ({ page }) => {
    await openSource(page)
    await page.evaluate((kind) => {
      const state = window.__files
      state.openName = 'broken.json'
      state.files['broken.json'] = '{"data":null}'
      if (kind === 'open') state.openError = 'NotAllowedError'
      if (kind === 'read') state.readError = true
    }, failure)
    await page.getByRole('button', { name: 'Open JSON' }).click()
    await expect(page.locator('.notice.error')).toContainText('Could not load document:')
    await expect(page.getByLabel('Current document')).toHaveText('source.json')
    await expect(page.locator('#data-editor .cm-content')).toContainText('first,loaded')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.notice')).toContainText('Saved document to source.json.')
    expect(await page.evaluate(() => window.__files.closed)).toEqual(['source.json'])
  })
}

for (const failure of ['picker', 'permission', 'write', 'close'] as const) {
  test(`reports ${failure} failures without switching targets or downloading a fallback`, async ({ page }) => {
    const downloads: string[] = []
    page.on('download', (download) => downloads.push(download.suggestedFilename()))
    await openSource(page)
    await editData(page, 'unsaved,changes')
    await page.evaluate((kind) => {
      const state = window.__files
      state.saveName = 'failed.json'
      if (kind === 'picker') state.saveError = 'NotAllowedError'
      if (kind === 'permission') state.permissionError = true
      if (kind === 'write') state.writeError = true
      if (kind === 'close') state.closeError = true
    }, failure)
    await page.getByRole('button', { name: 'Save As...' }).click()
    await expect(page.locator('.notice.error')).toContainText('Could not save document:')
    await expect(page.getByLabel('Current document')).toHaveText('source.json *')
    expect(await page.evaluate(() => window.__files.files['failed.json'])).toBeUndefined()
    expect(downloads).toEqual([])

    await page.evaluate(() => {
      window.__files.permissionError = false
      window.__files.writeError = false
      window.__files.closeError = false
    })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByLabel('Current document')).toHaveText('source.json')
  })
}

test('keeps edits made during a save marked unsaved and disables overlapping file operations', async ({ page }) => {
  await openSource(page)
  await page.evaluate(() => { window.__files.holdWrite = true })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => page.evaluate(() =>
    typeof window.__files.releaseWrite,
  )).toBe('function')
  for (const name of ['Open JSON', 'Save', 'Save As...', 'Import CSV...', 'Export CSV...']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  }
  await editData(page, 'edited,during save')
  await page.evaluate(() => {
    window.__files.holdWrite = false
    window.__files.releaseWrite?.()
  })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Current document')).toHaveText('source.json *')
  expect(JSON.parse(await page.evaluate(() =>
    window.__files.files['source.json'],
  )).data).toBe(sourceDocument.data)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('source.json')
  expect(JSON.parse(await page.evaluate(() =>
    window.__files.files['source.json'],
  )).data).toBe('edited,during save')
})

for (const [name, text] of [
  ['quoted multiline Unicode CSV', '"Ada, Lovelace","say ""hello"""\r\n\r\n"two\nlines",Příliš žluťoučký\r\n'],
  ['unfinished CSV', 'one,"unfinished'],
  ['empty CSV', ''],
] as const) {
  test(`exports exact ${name} without changing the JSON target or unsaved state`, async ({ page }) => {
    await openSource(page)
    await page.getByLabel('CSV data file', { exact: true }).setInputFiles({
      name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(text),
    })
    await expect(page.locator('.notice')).toContainText('Loaded')
    await page.evaluate(() => { window.__files.saveName = 'export.csv' })
    await page.getByRole('button', { name: 'Export CSV...' }).click()
    await expect(page.locator('.notice')).toContainText('Exported CSV data to export.csv.')
    await expect(page.getByLabel('Current document')).toHaveText('source.json *')
    const result = await page.evaluate(() => window.__files)
    expect(result.files['export.csv']).toBe(text)
    expect(result.files['source.json']).toBe(JSON.stringify(sourceDocument))
    expect(result.saves).toEqual([{
      types: [{ description: 'CSV data', accept: { 'text/csv': ['.csv'] } }],
      suggestedName: 'label-data.csv',
    }])
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByLabel('Current document')).toHaveText('source.json')
    expect(JSON.parse(await page.evaluate(() =>
      window.__files.files['source.json'],
    )).data).toBe(text)
  })
}

test('CSV export cancellation and write failure leave the clean JSON document unchanged', async ({ page }) => {
  await openSource(page)
  await page.evaluate(() => { window.__files.saveError = 'AbortError' })
  await page.getByRole('button', { name: 'Export CSV...' }).click()
  await expect(page.getByRole('button', { name: 'Export CSV...' })).toBeEnabled()
  await expect(page.locator('.notice.error')).toHaveCount(0)
  await expect(page.getByLabel('Current document')).toHaveText('source.json')
  await page.evaluate(() => {
    window.__files.saveError = null
    window.__files.closeError = true
  })
  await page.getByRole('button', { name: 'Export CSV...' }).click()
  await expect(page.locator('.notice.error')).toContainText('Could not export CSV data: Commit failed')
  await expect(page.getByLabel('Current document')).toHaveText('source.json')
  expect(await page.evaluate(() => window.__files.files['source.json']))
    .toBe(JSON.stringify(sourceDocument))
})

test('marks older template-only files unsaved and saves them as complete documents', async ({ page }) => {
  await page.evaluate(() => {
    const state = window.__files
    const { data: _data, ...template } = JSON.parse(state.files['source.json'])
    state.files['source.json'] = JSON.stringify(template)
  })
  await page.getByRole('button', { name: 'Open JSON' }).click()
  await expect(page.locator('.notice')).toContainText('CSV data unchanged.')
  await expect(page.getByLabel('Current document')).toHaveText('source.json *')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('source.json')
  expect(JSON.parse(await page.evaluate(() =>
    window.__files.files['source.json'],
  )).data).toBe(DEFAULT_DOCUMENT.data)
})

test('recovers data after reload without retaining a file handle or claiming it is saved', async ({ page }) => {
  await openSource(page)
  await editData(page, 'recovered,changes')
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('brother-pt-label-editor.document.v1'),
  )).toContain('"data":"recovered,changes"')
  await page.reload()
  await expect(page.getByLabel('Current document')).toHaveText('label-document.json *')
  await expect(page.locator('#data-editor .cm-content')).toHaveText('recovered,changes')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('saved.json')
  expect(await page.evaluate(() => window.__files.saves)).toHaveLength(1)
})

test('keeps long filenames and their unsaved marker inside the toolbar', async ({ page }) => {
  const name = `${'a-long-label-document-name-'.repeat(8)}.json`
  await page.evaluate((name) => {
    window.__files.openName = name
    window.__files.files[name] = window.__files.files['source.json']
  }, name)
  await page.getByRole('button', { name: 'Open JSON' }).click()
  await expect(page.getByLabel('Current document')).toHaveText(name)
  await editData(page, 'unsaved,changes')
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.unsaved-indicator')).toBeVisible()
    await expect(page.getByLabel('Current document')).toHaveAttribute(
      'title', `${name} (unsaved changes)`,
    )
    const bounds = await page.getByRole('group', { name: 'Document', exact: true }).boundingBox()
    if (!bounds) throw new Error('The document toolbar must be visible.')
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
  }
})

test('reads and writes through a real browser file handle, with only the pickers stubbed', async ({ page }) => {
  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory()
    const handle = await directory.getFileHandle('native-roundtrip.json', { create: true })
    Object.assign(window, {
      showSaveFilePicker: async () => handle,
      showOpenFilePicker: async () => [handle],
    })
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Current document')).toHaveText('native-roundtrip.json')
  await editData(page, 'real,file write')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.notice')).toContainText('Saved document to native-roundtrip.json.')
  await expect(page.getByLabel('Current document')).toHaveText('native-roundtrip.json')
  await editData(page, 'temporary,changes')
  await page.getByRole('button', { name: 'Open JSON' }).click()
  await expect(page.getByLabel('Current document')).toHaveText('native-roundtrip.json')
  await expect(page.locator('#data-editor .cm-content')).toHaveText('real,file write')
  const text = await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory()
    const handle = await directory.getFileHandle('native-roundtrip.json')
    const text = await (await handle.getFile()).text()
    await directory.removeEntry('native-roundtrip.json')
    return text
  })
  expect(JSON.parse(text)).toEqual({ ...DEFAULT_DOCUMENT, data: 'real,file write' })
})

async function openSource(page: Page) {
  await page.getByRole('button', { name: 'Open JSON' }).click()
  await expect(page.getByLabel('Current document')).toHaveText('source.json')
}

async function editData(page: Page, text: string) {
  await page.locator('#data-editor .cm-content').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText(text)
}
