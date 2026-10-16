export interface MaterialSymbolOptions {
  fill: number
  grade: number
  opticalSize: number
  weight: number
  names: string[]
}

const SYMBOL_FAMILIES = [
  'Material Symbols Outlined',
  'Material Symbols Rounded',
  'Material Symbols Sharp',
]

export function materialSymbolFamily(family: string): string | undefined {
  return SYMBOL_FAMILIES.find((name) => name.toLowerCase() === family.toLowerCase())
}

export const MATERIAL_SYMBOLS_CSS = SYMBOL_FAMILIES.map((family) => `
.${family.toLowerCase().replaceAll(' ', '-')} {
  font-family: "${family}";
  font-weight: 400;
  font-style: normal;
  font-size: 24px;
  display: inline-block;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
  overflow-wrap: normal;
  direction: ltr;
  font-feature-settings: "liga";
  font-variation-settings: "FILL" 0, "GRAD" 0, "opsz" 24;
}`).join('\n')

export function materialSymbolOptions(
  style: Pick<CSSStyleDeclaration, 'fontWeight' | 'fontVariationSettings'>,
  content: string,
): MaterialSymbolOptions {
  const axes = new Map(
    [...style.fontVariationSettings.matchAll(/["'](FILL|GRAD|opsz|wght)["']\s+(-?\d+(?:\.\d+)?)/g)]
      .map((match) => [match[1], Number(match[2])] as const),
  )
  const names = [...new Set(content.trim().split(/\s+/).filter(Boolean))].sort()
  if (!names.length || names.some((name) => !/^[a-z][a-z0-9_]*$/.test(name))) {
    throw new Error('Material Symbols must contain icon names such as "home" or "electrical_services".')
  }
  const result = {
    fill: axes.get('FILL') ?? 0,
    grade: axes.get('GRAD') ?? 0,
    opticalSize: axes.get('opsz') ?? 24,
    weight: axes.get('wght') ?? Number(style.fontWeight || 400),
    names,
  }
  for (const [name, value, min, max] of [
    ['FILL', result.fill, 0, 1],
    ['GRAD', result.grade, -25, 200],
    ['opsz', result.opticalSize, 20, 48],
    ['wght', result.weight, 100, 700],
  ] as const) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Material Symbols ${name} must be between ${min} and ${max}.`)
    }
  }
  return result
}
