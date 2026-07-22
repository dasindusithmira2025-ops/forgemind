import { useEffect, useRef } from 'react'
import Editor, { DiffEditor, loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { allConcreteThemes } from '../../theme/registry'
import { monacoThemeName, toMonacoColors } from '../../theme/tokens'
import { useThemeStore } from '../../theme/themeStore'
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

let themesDefined = false
/**
 * Register a Monaco theme for every PARALITH theme, derived from the same tokens the rest of the app
 * uses so the editor can never drift from the applied theme. Runs once (idempotent) before the first
 * editor mounts. Switching between them later is a cheap `setTheme` that preserves models, cursor,
 * selection, and undo history.
 */
function ensureThemesRegistered() {
  if (themesDefined) return
  themesDefined = true
  for (const theme of allConcreteThemes()) {
    monaco.editor.defineTheme(monacoThemeName(theme.id), {
      base: theme.editor.base,
      inherit: true,
      rules: [],
      colors: toMonacoColors(theme),
    })
  }
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
  const monacoTheme = useThemeStore((state) => monacoThemeName(state.resolved.id))
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
      theme={monacoTheme}
      path={props.path}
      language={props.language}
      value={props.value}
      keepCurrentModel
      beforeMount={ensureThemesRegistered}
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
  const monacoTheme = useThemeStore((state) => monacoThemeName(state.resolved.id))
  return (
    <div className="code-diff">
      <div className="code-diff-titles">
        <span>{props.originalTitle}</span>
        <span>{props.modifiedTitle}</span>
      </div>
      <DiffEditor
        className="code-diff-editor"
        theme={monacoTheme}
        original={props.original}
        modified={props.modified}
        language={props.language}
        beforeMount={ensureThemesRegistered}
        options={{ ...SHARED_OPTIONS, readOnly: true, renderSideBySide: true }}
        loading={<div className="code-editor-loading" aria-label="Loading comparison" />}
      />
    </div>
  )
}
