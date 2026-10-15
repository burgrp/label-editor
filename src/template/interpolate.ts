export interface TemplateDiagnostic {
  message: string
  from: number
  to: number
}

export interface InterpolationResult {
  html: string
  classes: readonly string[]
  missingColumns: readonly number[]
}

const NUMERIC_PLACEHOLDER = /{{\s*(\d+)\s*}}/g

export function interpolateTemplate(
  template: string,
  row: readonly string[],
): InterpolationResult {
  const missing = new Set<number>()
  const classes = new Set<string>()
  for (const value of row) {
    if (value.startsWith('class:')) {
      for (const name of value.slice('class:'.length).split(/\s+/)) {
        if (name) {
          classes.add(name)
        }
      }
    }
  }
  const html = template.replace(
    NUMERIC_PLACEHOLDER,
    (_placeholder, rawIndex: string) => {
      const index = Number(rawIndex)
      if (index >= row.length) {
        missing.add(index)
        return ''
      }
      return escapeHtml(row[index] ?? '')
    },
  )

  return {
    html,
    classes: [...classes],
    missingColumns: [...missing].sort((left, right) => left - right),
  }
}

export function validateTemplateSyntax(
  template: string,
): readonly TemplateDiagnostic[] {
  const diagnostics: TemplateDiagnostic[] = []
  let searchFrom = 0

  while (searchFrom < template.length) {
    const from = template.indexOf('{{', searchFrom)
    if (from < 0) {
      break
    }
    const close = template.indexOf('}}', from + 2)
    if (close < 0) {
      diagnostics.push({
        message: 'Unclosed placeholder; expected }}.',
        from,
        to: template.length,
      })
      break
    }

    const expression = template.slice(from + 2, close).trim()
    if (!/^\d+$/.test(expression)) {
      diagnostics.push({
        message: 'Placeholders must contain a zero-based numeric column index.',
        from,
        to: close + 2,
      })
    }
    searchFrom = close + 2
  }

  return diagnostics
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}
