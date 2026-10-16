import { expect, test, type Page } from '@playwright/test'
import { mockExo, mockGoogleFonts } from './helpers/googleFonts'

async function setTemplate(page: Page, css: string, template: string, mode = 'selected') {
  await page.getByLabel('Template and settings file', { exact: true }).setInputFiles({
    name: 'symbols.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1, template, css, previewMode: mode, tapeWidthMm: 12, threshold: 160,
    })),
  })
}

async function inkCounts(page: Page): Promise<number[]> {
  return page.locator('.preview-tapes canvas').evaluateAll((elements) =>
    elements.map((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected canvas')
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
      if (!data) throw new Error('Expected pixels')
      let count = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] < 128) count++
      return count
    }),
  )
}

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

test('supports all symbol families, subsets names, and keeps Font Awesome working', async ({
  page,
}) => {
  const { requests } = await mockGoogleFonts(page)
  await setTemplate(page,
    '.label{width:20mm}.material-symbols-outlined,.material-symbols-rounded,.material-symbols-sharp{font-size:24px}',
    '<span class="{{0}}">{{1}}</span>', 'wrapped',
  )
  await page.getByLabel('CSV data file', { exact: true }).setInputFiles({
    name: 'symbols.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'material-symbols-outlined,home',
      'material-symbols-rounded,warning',
      'material-symbols-sharp,electrical_services',
      'fa-solid fa-house,',
    ].join('\n')),
  })
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(4, { timeout: 15_000 })
  expect((await inkCounts(page)).every((count) => count > 50)).toBe(true)
  const queries = requests.filter((url) =>
    url.searchParams.get('family')?.startsWith('Material Symbols '),
  )
  expect(queries.map((url) => url.searchParams.get('icon_names'))).toEqual(
    ['home', 'warning', 'electrical_services'],
  )
  expect(queries.every((url) =>
    !url.searchParams.has('text') && !url.searchParams.get('family')?.includes('ital'),
  )).toBe(true)
})

test('renders filled and outlined instances of one glyph differently without extra requests', async ({
  page,
}) => {
  const { requests } = await mockGoogleFonts(page)
  const css = '.label{width:20mm}.filled .material-symbols-rounded{font-variation-settings:"FILL" 1,"wght" 700,"opsz" 32,"GRAD" 50}'
  await setTemplate(page, css, '<span class="material-symbols-rounded">home</span>', 'wrapped')
  await page.getByLabel('CSV data file', { exact: true }).setInputFiles({
    name: 'fill.csv', mimeType: 'text/csv', buffer: Buffer.from('class:plain\nclass:filled'),
  })
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(2)
  const [outlined, filled] = await inkCounts(page)
  expect(outlined).toBeGreaterThan(50)
  expect(filled).toBeGreaterThan(outlined * 1.2)
  expect(requests.filter((url) =>
    url.searchParams.get('family')?.startsWith('Material Symbols '),
  )).toHaveLength(1)
})

test('never sends ordinary label text when collecting symbols and deduplicates names', async ({
  page,
}) => {
  const { requests } = await mockGoogleFonts(page)
  await setTemplate(page, '.label{width:40mm}',
    '<span>Private label text</span><span class="material-symbols-rounded">home</span><span class="material-symbols-rounded">home warning</span>',
  )
  await expect(page.locator('.font-status')).toContainText('Fonts ready: Material Symbols Rounded')
  expect(requests).toHaveLength(1)
  expect(requests[0].searchParams.get('icon_names')).toBe('home,warning')
  expect(requests[0].href).not.toContain('Private')
})
