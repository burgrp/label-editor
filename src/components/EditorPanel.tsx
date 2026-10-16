import { useMemo, type ReactNode } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import {
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { css } from '@codemirror/lang-css'
import { html, htmlLanguage } from '@codemirror/lang-html'
import {
  linter,
  type Diagnostic as CodeMirrorDiagnostic,
} from '@codemirror/lint'
import { EditorView } from '@codemirror/view'

export interface EditorDiagnostic {
  message: string
  from: number
  to: number
  severity: 'error' | 'warning'
}

interface EditorPanelProps {
  id: string
  title: string
  description: ReactNode
  value: string
  language: 'csv' | 'html' | 'css'
  diagnostics?: readonly EditorDiagnostic[]
  maxColumns?: number
  columnSamples?: readonly string[]
  headerActions?: ReactNode
  onChange: (value: string) => void
  onCursorChange?: (offset: number) => void
}

export function EditorPanel({
  id,
  title,
  description,
  value,
  language,
  diagnostics = [],
  maxColumns = 0,
  columnSamples = [],
  headerActions,
  onChange,
  onCursorChange,
}: EditorPanelProps) {
  const extensions = useMemo(() => {
    const result = [
      EditorView.lineWrapping,
      EditorView.theme(
        {
          '&': {
            height: '100%',
            backgroundColor: 'transparent',
            color: 'var(--editor-text)',
            fontSize: '13px',
          },
          '.cm-scroller': {
            fontFamily: 'var(--font-mono)',
            lineHeight: '1.55',
          },
          '.cm-content': {
            padding: '10px 0 18px',
            caretColor: 'var(--accent)',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--panel-muted)',
            color: 'var(--text-dim)',
            border: 'none',
          },
          '.cm-activeLine, .cm-activeLineGutter': {
            backgroundColor: 'var(--active-line)',
          },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            backgroundColor: 'var(--selection) !important',
          },
          '&.cm-focused': {
            outline: 'none',
          },
        },
        { dark: true },
      ),
      linter(
        (view): readonly CodeMirrorDiagnostic[] =>
          diagnostics.map((diagnostic) => {
            const from = Math.min(diagnostic.from, view.state.doc.length)
            const to = Math.min(
              Math.max(diagnostic.to, from),
              view.state.doc.length,
            )
            return { ...diagnostic, from, to }
          }),
        { delay: 0 },
      ),
    ]

    if (language === 'html') {
      result.push(
        html(),
        htmlLanguage.data.of({
          autocomplete: placeholderCompletion(maxColumns, columnSamples),
        }),
      )
    } else if (language === 'css') {
      result.push(css())
    }
    return result
  }, [columnSamples, diagnostics, language, maxColumns])

  return (
    <section
      className="panel editor-panel"
      aria-labelledby={`${id}-title`}
    >
      <header className="panel-header">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="panel-actions">
          {diagnostics.length > 0 && (
            <span className="diagnostic-count" role="status">
              {diagnostics.length}{' '}
              {diagnostics.length === 1 ? 'issue' : 'issues'}
            </span>
          )}
          {headerActions}
        </div>
      </header>
      <div className="editor-region">
        <CodeMirror
          id={id}
          aria-label={title}
          value={value}
          height="100%"
          theme="dark"
          extensions={extensions}
          basicSetup={{
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            foldGutter: language !== 'csv',
            indentOnInput: language !== 'csv',
            lineNumbers: true,
            searchKeymap: true,
          }}
          onChange={onChange}
          onUpdate={(update) => {
            if (update.selectionSet || update.docChanged) {
              onCursorChange?.(update.state.selection.main.head)
            }
          }}
        />
      </div>
      {diagnostics.length > 0 && (
        <ul className="diagnostic-list" aria-label={`${title} diagnostics`}>
          {diagnostics.slice(0, 3).map((diagnostic, index) => (
            <li key={`${diagnostic.from}-${diagnostic.message}-${index}`}>
              <span className={`severity-dot ${diagnostic.severity}`} />
              {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function placeholderCompletion(
  maxColumns: number,
  samples: readonly string[],
) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/{{\s*\d*$/)
    if (!match && !context.explicit) {
      return null
    }

    return {
      from: match?.from ?? context.pos,
      options: Array.from({ length: maxColumns }, (_, index) => ({
        label: `{{${index}}}`,
        type: 'variable',
        detail: samples[index] ? `Example: ${samples[index]}` : `Column ${index}`,
        apply: `{{${index}}}`,
      })),
      validFor: /{{\s*\d*$/,
    }
  }
}
