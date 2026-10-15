import DOMPurify from 'dompurify'
import type { TemplateDiagnostic } from './interpolate'

const ALLOWED_TAGS = [
  'div',
  'span',
  'p',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'small',
  'br',
  'img',
  'ol',
  'ul',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
] as const

const BLOCKED_TAGS = [
  'script',
  'style',
  'link',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'meta',
  'base',
] as const

const IMAGE_SOURCE =
  /^(?:data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+|blob:)/i
const PLACEHOLDER_SOURCE = /^{{\s*\d+\s*}}$/

export function validateTemplateSafety(
  html: string,
): readonly TemplateDiagnostic[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const diagnostics: TemplateDiagnostic[] = []

  for (const tag of BLOCKED_TAGS) {
    if (document.querySelector(tag)) {
      diagnostics.push({
        message: `<${tag}> is not allowed in label templates.`,
        from: findCaseInsensitive(html, `<${tag}`),
        to: html.length,
      })
    }
  }

  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (
        name.startsWith('on') ||
        name === 'style' ||
        name === 'srcset' ||
        name === 'href'
      ) {
        diagnostics.push({
          message: `The ${attribute.name} attribute is not allowed.`,
          from: findCaseInsensitive(html, attribute.name),
          to: html.length,
        })
      }
    }

    if (element instanceof HTMLImageElement) {
      const source = element.getAttribute('src') ?? ''
      if (
        source.length > 0 &&
        !IMAGE_SOURCE.test(source) &&
        !PLACEHOLDER_SOURCE.test(source)
      ) {
        diagnostics.push({
          message: 'Images must use an inline data URL or an application blob URL.',
          from: findCaseInsensitive(html, source),
          to: html.length,
        })
      }
    }
  }

  return deduplicateDiagnostics(diagnostics)
}

export function sanitizeLabelHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [
      'class',
      'id',
      'title',
      'alt',
      'src',
      'width',
      'height',
      'colspan',
      'rowspan',
      'role',
      'aria-label',
      'aria-hidden',
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style', 'srcset'],
    ALLOWED_URI_REGEXP: IMAGE_SOURCE,
  })

  return typeof sanitized === 'string' ? sanitized : String(sanitized)
}

export function validateCssSafety(css: string): readonly TemplateDiagnostic[] {
  const diagnostics: TemplateDiagnostic[] = []
  const decodedCss = decodeCssEscapes(css)
  const importPattern = /@import\b/gi
  let match: RegExpExecArray | null

  while ((match = importPattern.exec(decodedCss)) !== null) {
    diagnostics.push({
      message: '@import is not allowed; label styles must be self-contained.',
      from: match.index,
      to: match.index + match[0].length,
    })
  }

  const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
  while ((match = urlPattern.exec(decodedCss)) !== null) {
    const source = match[2]?.trim() ?? ''
    if (!IMAGE_SOURCE.test(source)) {
      diagnostics.push({
        message: 'CSS URLs must use inline image data or application blob URLs.',
        from: match.index,
        to: match.index + match[0].length,
      })
    }
  }

  return diagnostics
}

function decodeCssEscapes(css: string): string {
  return css.replace(
    /\\([0-9a-f]{1,6}\s?|[\s\S])/gi,
    (_escape, value: string) => {
      const hexadecimal = value.trim()
      if (/^[0-9a-f]+$/i.test(hexadecimal)) {
        const codePoint = Number.parseInt(hexadecimal, 16)
        return codePoint === 0 || codePoint > 0x10ffff
          ? '\uFFFD'
          : String.fromCodePoint(codePoint)
      }
      return value
    },
  )
}

function findCaseInsensitive(source: string, needle: string): number {
  const index = source.toLowerCase().indexOf(needle.toLowerCase())
  return Math.max(index, 0)
}

function deduplicateDiagnostics(
  diagnostics: readonly TemplateDiagnostic[],
): readonly TemplateDiagnostic[] {
  return diagnostics.filter(
    (diagnostic, index) =>
      diagnostics.findIndex(
        (candidate) => candidate.message === diagnostic.message,
      ) === index,
  )
}
