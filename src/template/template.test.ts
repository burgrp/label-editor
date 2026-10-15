import { describe, expect, it } from 'vitest'
import {
  interpolateTemplate,
  validateTemplateSyntax,
} from './interpolate'
import {
  sanitizeLabelHtml,
  validateCssSafety,
  validateTemplateSafety,
} from './security'

describe('template interpolation', () => {
  it('escapes values and records missing columns', () => {
    const result = interpolateTemplate(
      '<b title="{{1}}">{{0}}</b>{{3}}',
      ['<Ada & Co>', '"engineer"'],
    )

    expect(result.html).toBe(
      '<b title="&quot;engineer&quot;">&lt;Ada &amp; Co&gt;</b>',
    )
    expect(result.missingColumns).toEqual([3])
  })

  it('rejects non-numeric and unclosed placeholders', () => {
    expect(validateTemplateSyntax('{{ name }} and {{2')).toHaveLength(2)
    expect(validateTemplateSyntax('{{ 0 }} {{12}}')).toEqual([])
  })
})

describe('template content policy', () => {
  it('detects active content, event handlers, and remote images', () => {
    const diagnostics = validateTemplateSafety(
      '<script>alert(1)</script><img src="https://example.com/a.png" onerror="x">',
    )

    expect(diagnostics.map((item) => item.message).join(' ')).toMatch(
      /script|onerror|inline data/i,
    )
  })

  it('allows placeholder and inline image sources', () => {
    expect(validateTemplateSafety('<img src="{{0}}" alt="logo">')).toEqual([])
    expect(
      validateTemplateSafety(
        '<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">',
      ),
    ).toEqual([])
  })

  it('sanitizes unsafe markup even when validation is bypassed', () => {
    const html = sanitizeLabelHtml(
      '<div onclick="x"><script>x()</script><strong>safe</strong></div>',
    )

    expect(html).toBe('<div><strong>safe</strong></div>')
  })

  it('blocks CSS imports and remote resources', () => {
    expect(
      validateCssSafety(
        '@import "theme.css"; .label { background: url(https://x/y.png) }',
      ),
    ).toHaveLength(2)
    expect(
      validateCssSafety(
        '.label { background: url("data:image/png;base64,aGVsbG8=") }',
      ),
    ).toEqual([])
    expect(
      validateCssSafety(
        String.raw`.label { background: u\72l(\68ttps://example.com/a.png) }`,
      ),
    ).toHaveLength(1)
  })
})
