import baseCss from '@fortawesome/fontawesome-free/css/fontawesome.min.css?raw'
import solidCss from '@fortawesome/fontawesome-free/css/solid.min.css?raw'
import regularCss from '@fortawesome/fontawesome-free/css/regular.min.css?raw'
import brandsCss from '@fortawesome/fontawesome-free/css/brands.min.css?raw'
import solidFont from '@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2?inline'
import regularFont from '@fortawesome/fontawesome-free/webfonts/fa-regular-400.woff2?inline'
import brandsFont from '@fortawesome/fontawesome-free/webfonts/fa-brands-400.woff2?inline'

const fontStyles = [
  solidCss.replaceAll('../webfonts/fa-solid-900.woff2', solidFont),
  regularCss.replaceAll('../webfonts/fa-regular-400.woff2', regularFont),
  brandsCss.replaceAll('../webfonts/fa-brands-400.woff2', brandsFont),
]

export const FONT_AWESOME_CSS = [
  baseCss,
  ...fontStyles,
  // Canvas capture needs the glyph alone, without CSS content's alternate text.
  ':is(.fa,.fas,.far,.fab,.fa-solid,.fa-regular,.fa-brands,.fa-classic)::before{content:var(--fa);}',
].join('\n')

export const FONT_AWESOME_FONT_CSS = fontStyles.map((style) => {
  const face = style.match(/@font-face\s*\{[^}]*\}/)
  if (!face) {
    throw new Error('The bundled Font Awesome stylesheet is missing its font face.')
  }
  return face[0]
}).join('\n')
