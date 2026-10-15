const CACHE_NAME = 'label-editor.google-fonts.v1'
const systemFamilies = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math',
  'fangsong', '-apple-system', 'blinkmacsystemfont', 'arial', 'helvetica',
  'times new roman', 'times', 'courier new', 'courier', 'verdana', 'georgia',
  'tahoma', 'trebuchet ms', 'segoe ui', 'consolas', 'liberation sans',
  'liberation serif', 'liberation mono',
])

export interface FontRequest {
  family: string
  weight: string
  style: 'normal' | 'italic'
}

interface EmbeddedFont {
  css: string
  warning?: string
}

export interface ResolvedFonts extends EmbeddedFont {
  families: readonly string[]
}

const downloadedFonts = new Map<string, Promise<EmbeddedFont>>()
const localFonts = new Map<string, Promise<boolean>>()

export class FontLoadingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FontLoadingError'
  }
}

export function parseFontFamilies(value: string): string[] {
  return [...value.matchAll(/(?:^|,)\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,]+)/g)]
    .map((match) => decodeCssEscapes(match[1].trim().replace(/^(['"])(.*)\1$/, '$2')))
    .filter(Boolean)
}

export function discoverFonts(root: HTMLElement): readonly FontRequest[] {
  const view = root.ownerDocument.defaultView
  if (!view) throw new FontLoadingError('The label document has no style resolver.')
  const requests = new Map<string, FontRequest>()
  const addStyle = (style: CSSStyleDeclaration) => {
    // Only the preferred family is resolved; explicit fallback families remain fallbacks.
    const family = parseFontFamilies(style.fontFamily)[0]
    if (
      !family ||
      systemFamilies.has(family.toLowerCase()) ||
      /^Font ?Awesome(?:\s|$)/i.test(family)
    ) return
    const font: FontRequest = {
      family,
      weight: style.fontWeight || '400',
      style: /^(italic|oblique)/.test(style.fontStyle) ? 'italic' : 'normal',
    }
    requests.set(fontKey(font), font)
  }

  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (['STYLE', 'SCRIPT'].includes(element.tagName)) continue
    const style = view.getComputedStyle(element)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      element.getClientRects().length === 0
    ) continue
    if ([...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    )) {
      addStyle(style)
    }
    for (const pseudo of ['::before', '::after']) {
      const pseudoStyle = view.getComputedStyle(element, pseudo)
      if (
        pseudoStyle.display !== 'none' &&
        pseudoStyle.visibility !== 'hidden' &&
        !['', 'none', 'normal', '""', "''"].includes(pseudoStyle.content)
      ) {
        addStyle(pseudoStyle)
      }
    }
  }
  return [...requests.values()]
}

export async function resolveGoogleFonts(
  root: HTMLElement,
  options: { signal?: AbortSignal; onLoading?: (message: string) => void } = {},
): Promise<ResolvedFonts> {
  const fonts = discoverFonts(root)
  const embedded: string[] = []
  const families = new Set<string>()
  const warnings = new Set<string>()
  for (const font of fonts) {
    options.signal?.throwIfAborted()
    if (await abortable(isLocalFont(font), options.signal)) continue
    options.onLoading?.(`Loading fonts: ${font.family} (${font.style} ${font.weight})`)
    const result = await loadGoogleFont(font, options.signal)
    embedded.push(result.css)
    families.add(font.family)
    if (result.warning) warnings.add(result.warning)
  }
  return {
    css: embedded.join('\n'),
    families: [...families],
    warning: warnings.size ? [...warnings].join(' ') : undefined,
  }
}

export function loadGoogleFont(font: FontRequest, signal?: AbortSignal): Promise<EmbeddedFont> {
  signal?.throwIfAborted()
  const url = googleFontUrl(font)
  let download = downloadedFonts.get(url)
  if (!download) {
    download = downloadFont(font, url).catch((error: unknown) => {
      downloadedFonts.delete(url)
      throw new FontLoadingError(
        `Could not load Google font "${font.family}": ${errorMessage(error)}. Check your connection and the font name.`,
        { cause: error },
      )
    })
    downloadedFonts.set(url, download)
  }
  return abortable(download, signal)
}

export function googleFontUrl(font: FontRequest): string {
  const url = new URL('https://fonts.googleapis.com/css2')
  const weight = font.weight === 'bold' ? '700'
    : font.weight === 'normal' ? '400' : font.weight
  if (!/^\d+(?:\.\d+)?$/.test(weight) || Number(weight) < 1 || Number(weight) > 1000) {
    throw new FontLoadingError(`Unsupported font weight "${font.weight}" for "${font.family}".`)
  }
  url.searchParams.set(
    'family',
    `${font.family}:ital,wght@${font.style === 'italic' ? 1 : 0},${weight}`,
  )
  url.searchParams.set('display', 'block')
  return url.href
}

async function isLocalFont(font: FontRequest): Promise<boolean> {
  const key = fontKey(font)
  let local = localFonts.get(key)
  if (!local) {
    const face = new FontFace(
      `local-font-probe-${localFonts.size}`,
      `local(${JSON.stringify(font.family)})`,
      { weight: font.weight, style: font.style },
    )
    local = face.load().then(
      () => true,
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'NetworkError') {
          return false
        }
        throw new FontLoadingError(`Could not check local font "${font.family}".`, { cause: error })
      },
    )
    localFonts.set(key, local)
  }
  return local
}

async function downloadFont(font: FontRequest, url: string): Promise<EmbeddedFont> {
  let cache: Cache | undefined
  let warning: string | undefined
  if (typeof globalThis.caches !== 'undefined') {
    try {
      cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(url)
      if (cached) return { css: await cached.text() }
    } catch (error) {
      warning = `Font cache unavailable: ${errorMessage(error)}.`
      console.warn(warning)
    }
  }

  const response = await fetchFontResource(url, 'fonts.googleapis.com')
  const sheet = new CSSStyleSheet()
  const faces = (await response.text()).match(/@font-face\s*\{[^}]*\}/g)
  if (!faces?.length) {
    throw new FontLoadingError(`Google Fonts returned no font faces for "${font.family}".`)
  }
  const embedded: string[] = []
  for (const block of faces) {
    const rule = sheet.cssRules[sheet.insertRule(block, sheet.cssRules.length)]
    if (rule.type !== CSSRule.FONT_FACE_RULE) {
      throw new FontLoadingError('Google Fonts returned an invalid font face.')
    }
    const style = (rule as CSSFontFaceRule).style
    if (
      parseFontFamilies(style.getPropertyValue('font-family'))[0]?.toLowerCase() !==
      font.family.toLowerCase()
    ) {
      throw new FontLoadingError(`Google Fonts returned a different family for "${font.family}".`)
    }
    const sourceMatch = block.match(/\bsrc\s*:\s*url\(\s*["']?(https:\/\/[^"')\s]+)["']?\s*\)/i)
    if (!sourceMatch) {
      throw new FontLoadingError(`Google Fonts returned no downloadable file for "${font.family}".`)
    }
    const fontResponse = await fetchFontResource(sourceMatch[1], 'fonts.gstatic.com')
    const dataUrl = await blobToDataUrl(await fontResponse.blob())
    try {
      await new FontFace(font.family, `url("${dataUrl}")`, {
        weight: font.weight,
        style: font.style,
      }).load()
    } catch (error) {
      throw new FontLoadingError(`Could not decode font "${font.family}".`, { cause: error })
    }
    const declarations = [
      `font-family:${JSON.stringify(font.family)}`,
      `src:url("${dataUrl}")`,
      `font-style:${font.style}`,
      `font-weight:${style.getPropertyValue('font-weight') || font.weight}`,
    ]
    const unicodeRange = style.getPropertyValue('unicode-range')
    if (unicodeRange) declarations.push(`unicode-range:${unicodeRange}`)
    embedded.push(`@font-face{${declarations.join(';')}}`)
  }
  const css = embedded.join('\n')
  if (cache) {
    try {
      await cache.put(url, new Response(css, { headers: { 'Content-Type': 'text/css' } }))
    } catch (error) {
      warning = `Font cache could not be saved: ${errorMessage(error)}.`
      console.warn(warning)
    }
  }
  return { css, warning }
}

async function fetchFontResource(url: string, hostname: string): Promise<Response> {
  const parsed = new URL(url)
  if (parsed.origin !== `https://${hostname}` || parsed.username || parsed.password) {
    throw new FontLoadingError(`Blocked unexpected font resource: ${parsed.origin}.`)
  }
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new FontLoadingError(`Font download failed (HTTP ${response.status}). Check the family name, weight, and connection.`)
  }
  if (response.url && new URL(response.url).origin !== `https://${hostname}`) {
    throw new FontLoadingError('Font download redirected to an unexpected host.')
  }
  return response
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new FontLoadingError('Could not encode the downloaded font.'))
    }
    reader.onerror = () => reject(
      new FontLoadingError('Could not read the downloaded font.', { cause: reader.error }),
    )
    reader.readAsDataURL(blob)
  })
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(
      () => signal.removeEventListener('abort', onAbort),
    )
  })
}

function fontKey(font: FontRequest): string {
  return `${font.family}\0${font.weight}\0${font.style}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
import { decodeCssEscapes } from '../template/security'
