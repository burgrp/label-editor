import { expect, test, type Page } from '@playwright/test'
import { mockExo, mockGoogleFonts } from './helpers/googleFonts'

test.beforeEach(async ({ page }) => {
  await mockExo(page)
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    await caches.delete('label-editor.google-fonts.v1')
  })
  await page.reload()
  await expect(page.locator('.font-status')).toHaveText('Fonts ready: Exo')
})

async function setFontTemplate(page: Page, css: string, template = '<span>&#xf111;</span>') {
  await page.getByLabel('Template and settings file', { exact: true }).setInputFiles({
    name: 'google-fonts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      template,
      css,
      previewMode: 'selected',
      tapeWidthMm: 12,
      threshold: 160,
    })),
  })
}

test('discovers inherited, variable, shorthand, and pseudo-element fonts and embeds real glyphs', async ({
  page,
}) => {
  const { requests, fontFiles } = await mockGoogleFonts(page)
  await setFontTemplate(page, [
    '.label { --family: "Label Test Font"; width: 40mm; font: 24pt var(--family); }',
    '.heavy { font-weight: 700; }',
    '.slanted { font-style: italic; }',
    '.unused { display: none; font-family: "Never Requested"; }',
    '.label::before { display:none; content:"hidden"; font-family:"Also Never Requested"; }',
    '.label::after { content: "\\f111"; font: 700 24pt "Pseudo Test Font"; }',
  ].join('\n'), [
    '<span>&#xf111;</span><b class="heavy">&#xf111;</b>',
    '<i class="slanted">&#xf111;</i><span class="unused">hidden</span>',
  ].join(''))

  await expect(page.locator('.font-status')).toContainText('Fonts ready: Pseudo Test Font, Label Test Font')
  const variants = requests.map((url) => url.searchParams.get('family'))
  expect(variants).toEqual([
    'Pseudo Test Font:ital,wght@0,700',
    'Label Test Font:ital,wght@0,400',
    'Label Test Font:ital,wght@0,700',
    'Label Test Font:ital,wght@1,400',
  ])
  expect(fontFiles).toHaveLength(4)
  expect(requests.every((url) => !url.searchParams.has('text'))).toBe(true)
  const canvas = page.getByLabel('Monochrome label preview', { exact: true })
  const ink = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected canvas')
    const pixels = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data
    if (!pixels) throw new Error('Expected raster pixels')
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 128) count++
    }
    return count
  })
  expect(ink).toBeGreaterThan(3000)
})

test('reuses cached fonts after reloading when Google is unreachable', async ({ page }) => {
  const { requests, fontFiles } = await mockGoogleFonts(page)
  await setFontTemplate(page, '.label{width:30mm;font:24pt "Cached Test Font"}')
  await expect(page.locator('.font-status')).toContainText('Fonts ready: Cached Test Font')
  expect(requests).toHaveLength(1)
  expect(fontFiles).toHaveLength(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('brother-pt-label-editor.document.v1')))
    .toContain('Cached Test Font')
  await page.unroute('https://fonts.googleapis.com/**')
  await page.unroute('https://fonts.gstatic.com/**')
  const unexpected: string[] = []
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    unexpected.push(route.request().url())
    await route.abort()
  })
  await page.reload()
  await expect(page.locator('.font-status')).toContainText('Fonts ready: Cached Test Font')
  await expect(page.getByLabel('Monochrome label preview', { exact: true })).toBeVisible()
  expect(unexpected).toEqual([])
})

test('shows a visible font error instead of previewing a fallback', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 400, body: 'Unknown family' }),
  )
  await setFontTemplate(page, '.label{width:30mm;font:24pt "Unknown Test Font"}')
  await expect(page.locator('.font-status')).toHaveText('Fonts failed')
  await expect(page.getByText(/Could not load Google font "Unknown Test Font"/)).toBeVisible()
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(0)
})

test('reports persistent cache failures but still renders successfully downloaded fonts', async ({
  page,
}) => {
  await mockGoogleFonts(page)
  await page.evaluate(() => {
    caches.open = () => Promise.reject(new Error('Storage denied'))
  })
  await setFontTemplate(page, '.label{width:30mm;font:24pt "Uncached Test Font"}')
  await expect(page.locator('.font-status')).toContainText('Font cache unavailable: Storage denied.')
  await expect(page.getByLabel('Monochrome label preview', { exact: true })).toBeVisible()
})

test('reports invalid downloaded font files rather than rendering fallback glyphs', async ({ page }) => {
  await mockGoogleFonts(page)
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ contentType: 'font/woff2', body: 'invalid font bytes' }),
  )
  await setFontTemplate(page, '.label{width:30mm;font:24pt "Broken Test Font"}')
  await expect(page.locator('.font-status')).toHaveText('Fonts failed')
  await expect(page.getByText(/Could not decode font/)).toBeVisible()
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(0)
})

test('reports loading and never replaces a new preview with a stale font download', async ({ page }) => {
  let release: () => void = () => { throw new Error('The font request has not started.') }
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ status: 400, body: 'Old failed request' })
  })
  await setFontTemplate(page, '.label{width:30mm;font:24pt "Slow Test Font"}')
  await expect(page.locator('.font-status')).toContainText('Loading fonts: Slow Test Font')
  await setFontTemplate(page, '.label{width:40mm;font:12pt Arial}')
  await expect(page.getByLabel('Monochrome label preview', { exact: true })).toBeVisible()
  release()
  await expect(page.locator('.font-status')).not.toContainText('Slow Test Font')
  await expect(page.getByLabel('Monochrome label preview', { exact: true })).toHaveAttribute('width', '283')
})
