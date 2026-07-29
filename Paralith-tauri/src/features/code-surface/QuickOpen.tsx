import { useEffect, useMemo, useRef, useState } from 'react'
import { asNativeError, native } from '../../native/commands'
import { iconForFile } from './fileIcons'
import { baseName } from './editorStore'
import { fuzzyScore } from './fuzzy'

interface QuickOpenProps {
  projectId: string
  onOpen: (path: string) => void
  onClose: () => void
}

const MAX_RESULTS = 200

export function QuickOpen({ projectId, onOpen, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>()
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    inputRef.current?.focus()
    void (async () => {
      try {
        const index = await native.searchProjectFiles(projectId)
        if (!active) return
        setFiles(index.files)
        setTruncated(index.truncated)
      } catch (caught) {
        if (active) setError(asNativeError(caught).message)
      }
    })()
    // Guard against a stale index resolving after the palette closed / project changed.
    return () => { active = false }
  }, [projectId])

  const results = useMemo(() => {
    if (!files) return []
    if (!query.trim()) return files.slice(0, MAX_RESULTS)
    return files
      .map((path) => ({ path, score: fuzzyScore(query.trim(), path) }))
      .filter((item): item is { path: string; score: number } => item.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((item) => item.path)
  }, [files, query])

  useEffect(() => { setSelected(0) }, [query])

  const commit = (path?: string) => {
    const target = path ?? results[selected]
    if (target) { onOpen(target); onClose() }
  }

  return (
    <>
      <button className="context-scrim code-quickopen-scrim" aria-label="Close quick open" onClick={onClose} />
      <div className="code-quickopen" role="dialog" aria-label="Quick open file">
        <input
          ref={inputRef}
          className="code-quickopen-input"
          placeholder="Search files by name…"
          value={query}
          aria-label="Search files by name"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); onClose() }
            else if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, results.length - 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
            else if (event.key === 'Enter') { event.preventDefault(); commit() }
          }}
        />
        <div className="code-quickopen-results" role="listbox">
          {error ? (
            <p className="code-quickopen-empty">{error}</p>
          ) : !files ? (
            <p className="code-quickopen-empty">Indexing project files…</p>
          ) : results.length === 0 ? (
            <p className="code-quickopen-empty">No matching files.</p>
          ) : (
            results.map((path, index) => {
              const Icon = iconForFile(baseName(path))
              return (
                <button
                  key={path}
                  role="option"
                  aria-selected={index === selected}
                  className={`code-quickopen-item ${index === selected ? 'is-selected' : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => commit(path)}
                >
                  <Icon size={14} />
                  <span className="code-quickopen-name">{baseName(path)}</span>
                  <span className="code-quickopen-path">{path}</span>
                </button>
              )
            })
          )}
        </div>
        {truncated && <p className="code-quickopen-note">Index truncated — refine your search for large repositories.</p>}
      </div>
    </>
  )
}
