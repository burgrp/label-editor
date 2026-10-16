import { describe, expect, it } from 'vitest'
import { googleFontUrl } from './googleFonts'
import {
  materialSymbolFamily,
  materialSymbolOptions,
  MATERIAL_SYMBOLS_CSS,
} from './materialSymbols'

describe('Material Symbols', () => {
  it('recognizes all three families and supplies their standard classes', () => {
    for (const name of ['Outlined', 'Rounded', 'Sharp']) {
      const family = `Material Symbols ${name}`
      expect(materialSymbolFamily(family.toLowerCase())).toBe(family)
      expect(MATERIAL_SYMBOLS_CSS).toContain(`.material-symbols-${name.toLowerCase()}`)
    }
    expect(materialSymbolFamily('Roboto')).toBeUndefined()
    expect(MATERIAL_SYMBOLS_CSS).toContain('font-feature-settings: "liga"')
  })

  it('extracts CSS axes and sorted deduplicated icon names', () => {
    expect(materialSymbolOptions({
      fontWeight: '700',
      fontVariationSettings: '"FILL" 1, "GRAD" 50, "opsz" 32, "wght" 500',
    }, ' warning home warning ')).toEqual({
      fill: 1, grade: 50, opticalSize: 32, weight: 500,
      names: ['home', 'warning'],
    })
  })

  it.each(['', 'Hello, world!', '\ue88a', 'https://example.com'])(
    'rejects unsupported symbol content %s',
    (content) => {
      expect(() => materialSymbolOptions({
        fontWeight: '400', fontVariationSettings: 'normal',
      }, content)).toThrow(/icon names/)
    },
  )

  it.each(['"FILL" 2', '"GRAD" -100', '"opsz" 10', '"wght" 900'])(
    'rejects out-of-range axes %s',
    (fontVariationSettings) => {
      expect(() => materialSymbolOptions({
        fontWeight: '400', fontVariationSettings,
      }, 'home')).toThrow(/must be between/)
    },
  )

  it('requests a variable font subset without ital or text parameters', () => {
    const symbols = materialSymbolOptions({
      fontWeight: '400', fontVariationSettings: 'normal',
    }, 'warning home')
    const url = new URL(googleFontUrl({
      family: 'Material Symbols Rounded', weight: '400', style: 'normal', symbols,
    }))
    expect(url.searchParams.get('family')).toBe(
      'Material Symbols Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-25..200',
    )
    expect(url.searchParams.get('icon_names')).toBe('home,warning')
    expect(url.searchParams.has('text')).toBe(false)
  })
})
