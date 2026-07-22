import { useEffect, useRef } from 'react'
import Editor, { DiffEditor, loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Bundle Monaco and its language workers locally. The default @monaco-editor/react loader fetches
// Monaco from a CDN, which cannot work in a packaged offline desktop app, so we point the loader
// at the bundled copy and wire Vite's worker entry points.
;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}
loader.config({ monaco })

let themeDefined = false
function ensureTheme() {
  if (themeDefined) return
  themeDefined = true
  const read = (name: string, fallback: string) => {
    if (typeof document === 'undefined') return fallback
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value || fallback
  }
  monaco.editor.defineTheme('paralith-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': read('--canvas', '#0a0c10'),
      'editor.foreground': read('--text', '#e8eaf1'),
      'editorLineNumber.foreground': read('--faint', '#778094'),
      'editorLineNumber.activeForeground': read('--muted', '#a3abbd'),
      'editor.selectionBackground': '#2c2a4a',
      'editor.lineHighlightBackground': '#12141b',
      'editorCursor.foreground': read('--accent-strong', '#a89bfa'),
      'editorIndentGuide.background1': read('--border', '#262b37'),
      'editorWidget.background': read('--surface-2', '#171a23'),
      'editorGutter.background': read('--canvas', '#0a0c10'),
      focusBorder: '#00000000',
    },
  })
}

const SHARED_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  automaticLayout: true,
  renderWhitespace: 'selection',
  tabSize: 2,
  bracketPairColorization: { enabled: true },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
}

export interface MonacoEditorPaneProps {
  path: string
  value: string
  language?: string
  readOnly: boolean
  onChange: (value: string) => void
  onSave: () => void
  onSaveAll: () => void
  onQuickOpen: () => void
  onCloseTab: () => void
  onCursor?: (line: number, column: number) => void
}

/**
 * A single Monaco editor that swaps models as the active tab changes. Save shortcuts are added as
 * editor commands so they only fire when the editor itself is focused — a focused terminal never
 * sees them. View state is captured per model URI so cursor and scroll are restored on tab switch.
 */
export default function MonacoEditorPane(props: MonacoEditorPaneProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | undefined>(undefined)
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>())
  const propsRef = useRef(props)
  propsRef.current = props

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.updateOptions({ readOnly: propsRef.current.readOnly })
    editor.onDidChangeModel((event) => {
      if (event.oldModelUrl) {
        viewStates.current.set(event.oldModelUrl.toString(), editor.saveViewState())
      }
      if (event.newModelUrl) {
        const saved = viewStates.current.get(event.newModelUrl.toString())
        if (saved) editor.restoreViewState(saved)
      }
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => propsRef.current.onSave())
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
      () => propsRef.current.onSaveAll(),
    )
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => propsRef.current.onQuickOpen())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => propsRef.current.onCloseTab())
    editor.onDidChangeCursorPosition((event) =>
      propsRef.current.onCursor?.(event.position.lineNumber, event.position.column),
    )
  }

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: props.readOnly })
  }, [props.readOnly])

  return (
    <Editor
      className="code-monaco"
      theme="paralith-dark"
      path={props.path}
      language={props.language}
      value={props.value}
      keepCurrentModel
      beforeMount={ensureTheme}
      onMount={handleMount}
      onChange={(value) => props.onChange(value ?? '')}
      options={SHARED_OPTIONS}
      loading={<div className="code-editor-loading" aria-label="Loading editor" />}
    />
  )
}

export interface DiffOverlayProps {
  original: string
  modified: string
  language?: string
  originalTitle: string
  modifiedTitle: string
}

/** Two-way comparison (buffer vs. disk) used by the conflict flow. This is an explicit
 * side-by-side compare, not a three-way merge — that is a later dedicated slice. */
export function DiffOverlay(props: DiffOverlayProps) {
  return (
    <div className="code-diff">
      <div className="code-diff-titles">
        <span>{props.originalTitle}</span>
        <span>{props.modifiedTitle}</span>
      </div>
      <DiffEditor
        className="code-diff-editor"
        theme="paralith-dark"
        original={props.original}
        modified={props.modified}
        language={props.language}
        beforeMount={ensureTheme}
        options={{ ...SHARED_OPTIONS, readOnly: true, renderSideBySide: true }}
        loading={<div className="code-editor-loading" aria-label="Loading comparison" />}
      />
    </div>
  )
}
