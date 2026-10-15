import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

export async function mockGoogleFonts(page: Page) {
  const requests: URL[] = []
  const fontFiles: string[] = []
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const [family, axes] = (url.searchParams.get('family') ?? '').split(':')
    const bold = axes.endsWith(',700')
    const style = axes.includes('@1,') ? 'italic' : 'normal'
    await route.fulfill({
      contentType: 'text/css',
      body: `@font-face{font-family:"${family}";font-style:${style};font-weight:${bold ? 700 : 400};src:url(https://fonts.gstatic.com/test/${bold ? 'solid' : 'regular'}.woff2) format("woff2")}`,
    })
  })
  await page.route('https://fonts.gstatic.com/**', async (route) => {
    fontFiles.push(route.request().url())
    const filename = route.request().url().includes('solid') ? 'fa-solid-900' : 'fa-regular-400'
    await route.fulfill({
      contentType: 'font/woff2',
      body: await readFile(`node_modules/@fortawesome/fontawesome-free/webfonts/${filename}.woff2`),
    })
  })
  return { requests, fontFiles }
}
