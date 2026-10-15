import { useState, type KeyboardEvent } from 'react'
import { EditorPanel, type EditorDiagnostic } from './EditorPanel'

const TEMPLATE_TABS = ['html', 'css'] as const
type TemplateTab = (typeof TEMPLATE_TABS)[number]

interface TemplatePanelProps {
  html: string
  css: string
  htmlDiagnostics: readonly EditorDiagnostic[]
  cssDiagnostics: readonly EditorDiagnostic[]
  maxColumns: number
  columnSamples?: readonly string[]
  onHtmlChange: (value: string) => void
  onCssChange: (value: string) => void
}

export function TemplatePanel({
  html,
  css,
  htmlDiagnostics,
  cssDiagnostics,
  maxColumns,
  columnSamples,
  onHtmlChange,
  onCssChange,
}: TemplatePanelProps) {
  const [activeTab, setActiveTab] = useState<TemplateTab>('html')
  const description =
    activeTab === 'html'
      ? 'Insert escaped values with {{0}}, {{1}}, ...'
      : '.label height follows the selected tape'

  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextTab: TemplateTab
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextTab = activeTab === 'html' ? 'css' : 'html'
    } else if (event.key === 'Home') {
      nextTab = 'html'
    } else if (event.key === 'End') {
      nextTab = 'css'
    } else {
      return
    }

    event.preventDefault()
    setActiveTab(nextTab)
    event.currentTarget
      .querySelector<HTMLButtonElement>(`#template-${nextTab}-tab`)
      ?.focus()
  }

  return (
    <section
      className="panel template-panel"
      aria-labelledby="template-panel-title"
    >
      <header className="panel-header template-header">
        <div>
          <h2 id="template-panel-title">Template</h2>
          <p>{description}</p>
        </div>
        <div
          role="tablist"
          aria-label="Template language"
          className="template-tabs"
          onKeyDown={navigateTabs}
        >
          {TEMPLATE_TABS.map((tab) => {
            const diagnostics =
              tab === 'html' ? htmlDiagnostics : cssDiagnostics
            return (
              <button
                key={tab}
                id={`template-${tab}-tab`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`template-${tab}-panel`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
              >
                {tab.toUpperCase()}
                {diagnostics.length > 0 && (
                  <span className="diagnostic-count">
                    {diagnostics.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </header>
      <div
        id="template-html-panel"
        role="tabpanel"
        aria-labelledby="template-html-tab"
        className="template-tab-panel"
        hidden={activeTab !== 'html'}
      >
        <EditorPanel
          id="html-editor"
          title="HTML template"
          description={description}
          value={html}
          language="html"
          diagnostics={htmlDiagnostics}
          maxColumns={maxColumns}
          columnSamples={columnSamples}
          onChange={onHtmlChange}
          embedded
        />
      </div>
      <div
        id="template-css-panel"
        role="tabpanel"
        aria-labelledby="template-css-tab"
        className="template-tab-panel"
        hidden={activeTab !== 'css'}
      >
        <EditorPanel
          id="css-editor"
          title="CSS"
          description={description}
          value={css}
          language="css"
          diagnostics={cssDiagnostics}
          onChange={onCssChange}
          embedded
        />
      </div>
    </section>
  )
}
