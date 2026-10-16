import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

export async function mockExo(page: Page) {
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    const family = new URL(route.request().url()).searchParams.get('family') ?? ''
    if (!family.startsWith('Exo:')) {
      await route.fallback()
      return
    }
    const weight = family.endsWith(',700') ? 700 : 400
    await route.fulfill({
      contentType: 'text/css',
      body: `@font-face{font-family:"Exo";font-style:normal;font-weight:${weight};src:url(https://fonts.gstatic.com/test/exo-${weight}.woff2) format("woff2")}`,
    })
  })
  await page.route('https://fonts.gstatic.com/test/exo-*.woff2', async (route) => {
    const weight = route.request().url().includes('700') ? 700 : 400
    await route.fulfill({
      contentType: 'font/woff2',
      body: await readFile(`node_modules/@fontsource/exo/files/exo-latin-${weight}-normal.woff2`),
    })
  })
}

export async function mockGoogleFonts(page: Page) {
  const requests: URL[] = []
  const fontFiles: string[] = []
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url())
    const [family, axes] = (url.searchParams.get('family') ?? '').split(':')
    if (family === 'Exo') {
      await route.fallback()
      return
    }
    requests.push(url)
    if (family.startsWith('Material Symbols ')) {
      const variant = family.split(' ').at(-1)?.toLowerCase()
      await route.fulfill({
        contentType: 'text/css',
        body: `@font-face{font-family:"${family}";font-style:normal;font-weight:100 700;src:url(https://fonts.gstatic.com/symbols/${variant}.woff2) format("woff2")}`,
      })
      return
    }
    const bold = axes.endsWith(',700')
    const style = axes.includes('@1,') ? 'italic' : 'normal'
    await route.fulfill({
      contentType: 'text/css',
      body: `@font-face{font-family:"${family}";font-style:${style};font-weight:${bold ? 700 : 400};src:url(https://fonts.gstatic.com/test/${bold ? 'solid' : 'regular'}.woff2) format("woff2")}`,
    })
  })
  await page.route('https://fonts.gstatic.com/**', async (route) => {
    if (route.request().url().includes('/test/exo-')) {
      await route.fallback()
      return
    }
    fontFiles.push(route.request().url())
    if (route.request().url().includes('/symbols/')) {
      const variant = route.request().url().split('/').at(-1)
      await route.fulfill({
        contentType: 'font/woff2',
        body: await readFile(`node_modules/material-symbols/material-symbols-${variant}`),
      })
      return
    }
    const filename = route.request().url().includes('solid') ? 'fa-solid-900' : 'fa-regular-400'
    await route.fulfill({
      contentType: 'font/woff2',
      body: await readFile(`node_modules/@fortawesome/fontawesome-free/webfonts/${filename}.woff2`),
    })
  })
  return { requests, fontFiles }
}
