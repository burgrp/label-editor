import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
})

test('loads the data editor, template tabs, and deterministic print preview', async ({
  page,
}) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Template' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'HTML' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('tab', { name: 'CSS' })).toBeVisible()
  await expect(page.locator('#html-editor')).toBeVisible()
  await expect(page.locator('#css-editor')).toBeHidden()
  await expect(page.getByLabel('Monochrome label preview')).toBeVisible()
  await expect(page.getByLabel('Preview zoom')).toHaveValue('3')
  await expect(page.locator('.zoom-control output')).toHaveText('3x')
  await expect(page.getByText('3 labels ready')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load CSV' })).toBeVisible()
  await expect(
    page.getByRole('group', { name: 'Template and settings', exact: true }),
  ).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('switches template tabs with the mouse and keyboard without losing edits or undo history', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'CSS' }).click()
  await expect(page.locator('#html-editor')).toBeHidden()
  await setEditor(page, 'css-editor', '.label { width: 30mm; }')
  await expect.poll(() => previewLength(page)).toBeGreaterThan(29)
  await expect.poll(() => previewLength(page)).toBeLessThan(31)

  await page.getByRole('tab', { name: 'CSS' }).press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'HTML' })).toBeFocused()
  await expect(page.locator('#html-editor .cm-content')).toContainText('{{0}}')
  await expect(page.locator('#css-editor')).toBeHidden()

  await page.getByRole('tab', { name: 'HTML' }).press('End')
  await expect(page.getByRole('tab', { name: 'CSS' })).toBeFocused()
  await expect(page.locator('#css-editor .cm-content')).toContainText('30mm')
  await page.locator('#css-editor .cm-content').click()
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z',
  )
  await expect(page.locator('#css-editor .cm-content')).toContainText('48mm')
})

test('fits the screen with a full-width preview and internal editor scrolling', async ({
  page,
}) => {
  await setEditor(
    page,
    'data-editor',
    Array.from({ length: 100 }, (_, index) => `Row ${index},value,year`).join('\n'),
  )

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1000, height: 700 },
    { width: 390, height: 844 },
    { width: 800, height: 400 },
  ]) {
    await page.setViewportSize(size)
    await expect
      .poll(() =>
        page.evaluate(() => ({
          pageHeight: document.documentElement.scrollHeight,
          pageWidth: document.documentElement.scrollWidth,
          windowHeight: window.innerHeight,
          windowWidth: window.innerWidth,
        })),
      )
      .toEqual({
        pageHeight: size.height,
        pageWidth: size.width,
        windowHeight: size.height,
        windowWidth: size.width,
      })

    const data = await page.locator('.editor-panel').first().boundingBox()
    const template = await page.locator('.template-panel').boundingBox()
    const preview = await page.locator('.preview-panel').boundingBox()
    if (!data || !template || !preview) {
      throw new Error('All workspace panels must have visible bounds.')
    }
    expect(preview.y).toBeGreaterThanOrEqual(data.y + data.height)
    expect(preview.y).toBeGreaterThanOrEqual(template.y + template.height)
    expect(preview.x).toBe(data.x)
    expect(Math.abs(preview.height - size.height * 0.3)).toBeLessThan(1)
    if (size.width > 620) {
      expect(preview.x + preview.width).toBe(template.x + template.width)
    }
  }

  const editorSizes = await page
    .locator('#data-editor .cm-scroller')
    .evaluate((element) => ({
      contentHeight: element.scrollHeight,
      viewportHeight: element.clientHeight,
    }))
  expect(editorSizes.contentHeight).toBeGreaterThan(editorSizes.viewportHeight)
  expect(editorSizes.viewportHeight).toBeGreaterThan(0)
})

test('selects a CSV record from the editor cursor and composes the strip', async ({
  page,
}) => {
  await expect(page.getByText('Row 1 of 3')).toBeVisible()
  await page.locator('#data-editor .cm-line').nth(1).click()
  await expect(page.getByText('Row 2 of 3')).toBeVisible()

  const selectedLength = await previewLength(page)
  await page.getByRole('button', { name: 'Strip', exact: true }).click()
  await expect
    .poll(async () => previewLength(page))
    .toBeGreaterThan(selectedLength * 2)
})

test('uses physical print dimensions at 1x and retains the 180-DPI raster', async ({
  page,
}) => {
  const canvas = page.getByLabel('Monochrome label preview', { exact: true })
  await expect(canvas).toBeVisible()
  const defaultBounds = await canvas.boundingBox()
  if (!defaultBounds) {
    throw new Error('The default preview must have visible bounds.')
  }

  await page.getByLabel('Preview zoom').press('Home')
  await expect(page.getByLabel('Preview zoom')).toHaveValue('1')

  let oneToOneBounds = { width: 0, height: 0 }
  for (const [tapeWidthMm, rasterHeight] of [
    [3.5, 25],
    [6, 43],
    [9, 64],
    [12, 85],
  ]) {
    await page.getByLabel('Tape').selectOption(String(tapeWidthMm))
    await expect(canvas).toHaveAttribute('height', String(rasterHeight))
    await expect(async () => {
      const dimensions = await canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) {
          throw new Error('The print preview must be a canvas.')
        }
        const bounds = element.getBoundingClientRect()
        return {
          rasterWidth: element.width,
          rasterHeight: element.height,
          displayWidth: bounds.width,
          displayHeight: bounds.height,
        }
      })
      expect(dimensions.rasterHeight).toBe(rasterHeight)
      expect(dimensions.displayWidth).toBeCloseTo(
        (dimensions.rasterWidth * 96) / 180,
        1,
      )
      expect(dimensions.displayHeight).toBeCloseTo((tapeWidthMm * 96) / 25.4, 1)
      oneToOneBounds = {
        width: dimensions.displayWidth,
        height: dimensions.displayHeight,
      }
    }).toPass({ timeout: 5000 })
  }

  expect(defaultBounds.width / oneToOneBounds.width).toBeCloseTo(3, 2)
  expect(defaultBounds.height / oneToOneBounds.height).toBeCloseTo(3, 2)
})

test('keeps the three preview modes in the preview header and restores wrapped mode', async ({
  page,
}) => {
  const preview = page.getByRole('region', { name: 'Print preview', exact: true })
  const modes = preview.getByRole('group', { name: 'Preview mode' })
  await expect(modes.getByRole('button')).toHaveCount(3)
  await expect(modes.getByRole('button', { name: 'Selected row' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('region', { name: 'Printer settings' }).getByRole('group'),
  ).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(0)

  await modes.getByRole('button', { name: 'Wrapped' }).click()
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(3)
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('brother-pt-label-editor.document.v1'),
      ),
    )
    .toContain('"previewMode":"wrapped"')

  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Wrapped', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(3)
  await page.getByRole('button', { name: 'Selected row' }).click()
  await expect(page.getByLabel('Monochrome label preview', { exact: true })).toBeVisible()
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(1)
})

test('optionally wraps whole labels without changing the strip dimensions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 900 })
  await page.getByRole('button', { name: 'Strip', exact: true }).click()
  await page.getByLabel('Preview zoom').press('Home')

  const strip = page.getByLabel('Monochrome label preview', { exact: true })
  await expect(strip).toBeVisible()
  await expect.poll(() => previewLength(page)).toBeGreaterThan(100)
  const stripWidth = Number(await strip.getAttribute('width'))
  const stripInk = await previewInkRows(strip)
  const wrappedMode = page.getByRole('button', { name: 'Wrapped', exact: true })
  await expect(wrappedMode).toHaveAttribute('aria-pressed', 'false')
  await wrappedMode.click()
  await expect(wrappedMode).toHaveAttribute('aria-pressed', 'true')

  const canvases = page.locator('.preview-tapes canvas')
  await expect(canvases).toHaveCount(3)
  expect(
    await canvases.evaluateAll((elements) =>
      elements.reduce(
        (width, canvas) => width + Number(canvas.getAttribute('width')),
        0,
      ),
    ),
  ).toBe(stripWidth)
  expect(await previewInkRows(canvases)).toEqual(stripInk)
  const rows = await canvases.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().top),
  )
  expect(rows[1]).toBe(rows[0])
  expect(rows[2]).toBeGreaterThan(rows[0])

  await page.getByRole('button', { name: 'Strip', exact: true }).press('Space')
  await expect(wrappedMode).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(1)
  await expect(strip).toHaveAttribute('width', String(stripWidth))
})

test('pans the strip by grabbing the canvas and stops when released outside', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Strip', exact: true }).click()
  const canvas = page.getByLabel('Monochrome label preview', { exact: true })
  await expect(canvas).toBeVisible()
  await expect.poll(() => previewLength(page)).toBeGreaterThan(100)
  const viewport = page.locator('.preview-viewport')
  await viewport.scrollIntoViewIfNeeded()
  const bounds = await viewport.boundingBox()
  const tapeBounds = await canvas.boundingBox()
  if (!bounds || !tapeBounds) {
    throw new Error('The preview viewport and tape must have visible bounds.')
  }

  const startX = bounds.x + bounds.width / 2
  const startY = Math.max(bounds.y + 30, tapeBounds.y + 20)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await expect(viewport).toHaveCSS('cursor', 'grabbing')
  await page.mouse.move(bounds.x - 30, startY, { steps: 8 })
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(100)
  await page.mouse.up()
  await expect(viewport).toHaveCSS('cursor', 'grab')

  const releasedScroll = await viewport.evaluate(
    (element) => element.scrollLeft,
  )
  await page.mouse.move(startX, startY, { steps: 5 })
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(
    releasedScroll,
  )
})

test('pans overflowing wrapped labels horizontally and vertically', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Wrapped', exact: true }).click()
  await page.getByLabel('Preview zoom').press('End')
  const canvas = page.getByLabel('Monochrome label preview 1', { exact: true })
  await expect(canvas).toBeVisible()
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(3)
  const viewport = page.locator('.preview-viewport')
  await viewport.scrollIntoViewIfNeeded()
  const bounds = await viewport.boundingBox()
  if (!bounds) {
    throw new Error('The preview viewport must have visible bounds.')
  }

  const startX = bounds.x + Math.min(200, bounds.width / 2)
  const startY = bounds.y + Math.min(180, bounds.height / 2)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX - 100, startY - 100, { steps: 5 })
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(80)
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(80)
  await page.mouse.up()
})

test('blocks malformed CSV until it is corrected', async ({ page }) => {
  await setEditor(page, 'data-editor', 'one,"unfinished')

  await expect(page.getByText(/Cannot preview or print:/)).toContainText(
    /quote/i,
  )
  await expect(page.getByLabel('Monochrome label preview')).toHaveCount(0)

  await setEditor(page, 'data-editor', 'one,two')
  await expect(page.getByText('Row 1 has no column 2.')).toBeVisible()
  await expect(page.getByLabel('Monochrome label preview')).toBeVisible()
})

test('warns for a missing column without blocking preview', async ({ page }) => {
  await setEditor(page, 'html-editor', '<strong>{{8}}</strong>')

  await expect(page.getByText('Row 1 has no column 8.')).toBeVisible()
  await expect(page.getByLabel('Monochrome label preview')).toBeVisible()
})

test('offers CSV placeholder completion in the HTML editor', async ({
  page,
}) => {
  await setEditor(page, 'html-editor', '{{')
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Space' : 'Control+Space',
  )

  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('{{0}}')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText(
    'Example: Ada Lovelace',
  )
})

test('blocks remote template resources', async ({ page }) => {
  await setEditor(
    page,
    'html-editor',
    '<img src="https://example.com/tracker.png">',
  )

  await expect(page.getByText(/Cannot preview or print:/)).toContainText(
    /inline data/i,
  )
  await expect(page.getByLabel('Monochrome label preview')).toHaveCount(0)
})

test('loads CSV data without changing the template or settings', async ({
  page,
}) => {
  await page.getByLabel('Tape').selectOption('9')
  await page.getByRole('tab', { name: 'CSS' }).click()
  await setEditor(page, 'css-editor', '.label { width: 30mm; }')
  await page.getByRole('tab', { name: 'HTML' }).click()
  const html = await page.locator('#html-editor .cm-content').innerText()
  await page.getByRole('button', { name: 'Wrapped', exact: true }).click()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load CSV' }).click()
  const chooser = await chooserPromise
  const csvFile = {
    name: 'labels.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\uFEFF"First, label",value,1\nSecond,label,2'),
  }
  await chooser.setFiles(csvFile)

  await expect(page.getByText('Loaded data from labels.csv.')).toBeVisible()
  await expect(page.locator('#data-editor .cm-content')).toContainText(
    '"First, label",value,1',
  )
  await expect(page.getByText('Row 1 of 2')).toBeVisible()
  await expect(page.getByLabel('Tape')).toHaveValue('9')
  await expect(page.getByRole('button', { name: 'Wrapped' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('#html-editor .cm-content')).toHaveText(html, {
    useInnerText: true,
  })
  await page.getByRole('tab', { name: 'CSS' }).click()
  await expect(page.locator('#css-editor .cm-content')).toContainText('30mm')
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(2)

  await setEditor(page, 'data-editor', 'temporary,data,row')
  await page.getByLabel('CSV data file', { exact: true }).setInputFiles(csvFile)
  await expect(page.locator('#data-editor .cm-content')).toContainText('Second,label,2')
  await expect(page.getByText('Row 1 of 2')).toBeVisible()
})

test('loads malformed CSV into the editor with blocking diagnostics', async ({
  page,
}) => {
  await page.getByLabel('CSV data file', { exact: true }).setInputFiles({
    name: 'malformed.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('one,"unfinished'),
  })

  await expect(page.locator('#data-editor .cm-content')).toContainText(
    'one,"unfinished',
  )
  await expect(page.getByText(/Cannot preview or print:/)).toContainText(/quote/i)
  await expect(
    page.getByText(/Loaded malformed.csv; correct the CSV before printing:/),
  ).toBeVisible()
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(0)
})

test('preserves data and reports a CSV file read failure', async ({ page }) => {
  const originalData = await page.locator('#data-editor .cm-content').innerText()
  await page.evaluate(() => {
    File.prototype.text = () => Promise.reject(new Error('File read denied.'))
  })
  await page.getByLabel('CSV data file', { exact: true }).setInputFiles({
    name: 'unreadable.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('new,data'),
  })

  await expect(
    page.getByText('Could not load CSV data: File read denied.'),
  ).toBeVisible()
  await expect(page.locator('#data-editor .cm-content')).toHaveText(originalData, {
    useInnerText: true,
  })
})

test('persists data while importing and exporting only template and settings', async ({
  page,
}) => {
  await setEditor(page, 'data-editor', 'saved,value')
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('brother-pt-label-editor.document.v1'),
      ),
    )
    .toContain('"data":"saved,value"')
  await page.reload()
  await expect(page.locator('#data-editor .cm-content')).toContainText(
    'saved,value',
  )

  const template = {
    version: 1,
    template: '<b>{{0}}</b>',
    css: '.label { width: 30mm; }',
    previewMode: 'wrapped',
    tapeWidthMm: 9,
    threshold: 140,
  }
  await page.getByLabel('Template and settings file', { exact: true }).setInputFiles({
    name: 'imported.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify(template),
    ),
  })
  await expect(
    page.getByText('Imported template and settings from imported.json.'),
  ).toBeVisible()
  await expect(page.locator('#data-editor .cm-content')).toContainText(
    'saved,value',
  )
  await expect(page.locator('#html-editor .cm-content')).toContainText('<b>{{0}}</b>')
  await expect(page.getByLabel('Tape')).toHaveValue('9')
  await expect(page.getByLabel('Black threshold')).toHaveValue('140')
  await expect(page.getByRole('button', { name: 'Wrapped' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByLabel('Template and settings file', { exact: true }).setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  })
  await expect(page.getByText(/Invalid label document:/)).toBeVisible()
  await expect(page.locator('#data-editor .cm-content')).toContainText(
    'saved,value',
  )
  await expect(page.locator('#html-editor .cm-content')).toContainText('<b>{{0}}</b>')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export template and settings' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('label-template.json')
  expect(JSON.parse(await readFile(await download.path(), 'utf8'))).toStrictEqual(
    template,
  )
})

test('keeps data and the selected row when importing an older full-document file', async ({
  page,
}) => {
  await page.locator('#data-editor .cm-line').nth(1).click()
  await expect(page.getByText('Row 2 of 3')).toBeVisible()
  const originalData = await page.locator('#data-editor .cm-content').innerText()

  await page.getByLabel('Template and settings file', { exact: true }).setInputFiles({
    name: 'older-document.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        data: 'do,not,import',
        template: '<b>{{0}}</b>',
        css: '.label { width: 30mm; }',
        previewMode: 'selected',
        tapeWidthMm: 12,
        threshold: 160,
      }),
    ),
  })

  await expect(
    page.getByText('Imported template and settings from older-document.json.'),
  ).toBeVisible()
  await expect(page.locator('#data-editor .cm-content')).toHaveText(originalData, {
    useInnerText: true,
  })
  await expect(page.getByText('Row 2 of 3')).toBeVisible()
  await expect(page.locator('#html-editor .cm-content')).toContainText('<b>{{0}}</b>')
})

async function setEditor(page: Page, id: string, value: string): Promise<void> {
  const editor = page.locator(`#${id} .cm-content`)
  await editor.click()
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
  )
  await page.keyboard.insertText(value)
}

async function previewInkRows(canvases: Locator): Promise<string[]> {
  return canvases.evaluateAll((elements) => {
    const images = elements.map((element) => {
      if (!(element instanceof HTMLCanvasElement)) {
        throw new Error('Preview elements must be canvases.')
      }
      const context = element.getContext('2d')
      if (!context) {
        throw new Error('Preview canvases must have a drawing context.')
      }
      return context.getImageData(0, 0, element.width, element.height)
    })

    return Array.from({ length: images[0]?.height ?? 0 }, (_, y) =>
      images
        .map((image) => {
          let row = ''
          for (let x = 0; x < image.width; x += 1) {
            // The red channel distinguishes black ink from blue segment guides.
            row += image.data[(y * image.width + x) * 4] < 128 ? '1' : '0'
          }
          return row
        })
        .join(''),
    )
  })
}

async function previewLength(page: Page): Promise<number> {
  const description = page
    .getByRole('heading', { name: 'Print preview' })
    .locator('..')
    .locator('p')
  let length = Number.NaN
  await expect
    .poll(async () => {
      length = Number.parseFloat(await description.innerText())
      return length
    })
    .toBeGreaterThan(0)
  return length
}
