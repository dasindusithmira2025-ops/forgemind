import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileWarning, Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { diffStat, parseUnifiedDiff, type DiffLine } from '../repositorySelectors'
import type { RepositoryDiff } from '../../../native/types'

const ROW_HEIGHT = 18
const OVERSCAN = 12
const CHUNK_BYTES = 96 * 1024

export type DiffMode = 'unified' | 'split'

interface SplitRow {
  kind: 'hunk' | 'meta' | 'pair'
  text?: string
  left?: { num?: number; text: string; kind: 'del' | 'context' | 'empty' }
  right?: { num?: number; text: string; kind: 'add' | 'context' | 'empty' }
}

/**
 * A diff viewer safe for real repositories. It requests the diff in bounded byte chunks (never
 * the whole file at once), reports binary and truncated states honestly, and virtualizes the
 * rendered rows so a 50k-line diff mounts only the handful of rows on screen.
 */
export function DiffViewer({ path, staged, mode, emptyLabel = 'No diff to display.' }: {
  path: string | undefined
  staged: boolean
  mode: DiffMode
  emptyLabel?: string
}) {
  const fetchDiff = useRepositoryStore((state) => state.fetchDiff)
  const [diff, setDiff] = useState<RepositoryDiff>()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setText(''); setDiff(undefined)
    void fetchDiff(path, staged, 0, CHUNK_BYTES)
      .then((result) => { if (live) { setDiff(result); setText(result.text) } })
      .catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Failed to load diff.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [path, staged, fetchDiff])

  const loadMore = async () => {
    if (!diff || !diff.truncated || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await fetchDiff(path, staged, diff.offset + diff.text.length, CHUNK_BYTES)
      setText((current) => current + next.text)
      setDiff(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load more.')
    } finally {
      setLoadingMore(false)
    }
  }

  const lines = useMemo(() => parseUnifiedDiff(text), [text])
  const stat = useMemo(() => diffStat(lines), [lines])
  const rows = useMemo<Array<DiffLine | SplitRow>>(() => mode === 'split' ? buildSplitRows(lines) : lines, [lines, mode])

  if (loading) return <div className="repo-diff-state"><Loader2 size={16} className="is-spinning" /> Loading diff…</div>
  if (error) return <div className="repo-diff-state error" role="alert"><AlertTriangle size={16} /> {error}</div>
  if (diff?.binary) return <div className="repo-diff-state"><FileWarning size={16} /> Binary file — {formatBytes(diff.totalBytes)}. No textual diff is shown.</div>
  if (lines.length === 0) return <div className="repo-diff-state">{emptyLabel}</div>

  return (
    <div className="repo-diff">
      <div className="repo-diff-toolbar">
        <span className="repo-diff-stat"><span className="add">+{stat.added}</span> <span className="del">−{stat.removed}</span></span>
        <span className="repo-diff-mode-label">{mode === 'split' ? 'Side-by-side' : 'Unified'}</span>
        {diff?.truncated && <span className="repo-diff-truncated">Showing {formatBytes(diff.offset + diff.text.length)} of {formatBytes(diff.totalBytes)}</span>}
      </div>
      <VirtualRows rows={rows} mode={mode} />
      {diff?.truncated && <div className="repo-diff-more"><Button variant="secondary" icon={loadingMore ? <Loader2 size={14} className="is-spinning" /> : undefined} onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading' : 'Load more of this diff'}</Button></div>}
    </div>
  )
}

function VirtualRows({ rows, mode }: { rows: Array<DiffLine | SplitRow>; mode: DiffMode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => setHeight(element.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const total = rows.length
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(total, start + visibleCount)
  const slice = rows.slice(start, end)

  return (
    <div className="repo-diff-scroll" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} tabIndex={0} role="region" aria-label="Diff contents">
      <div className="repo-diff-canvas" style={{ height: total * ROW_HEIGHT }}>
        <div className="repo-diff-window" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
          {mode === 'split'
            ? (slice as SplitRow[]).map((row, index) => <SplitRowView key={start + index} row={row} />)
            : (slice as DiffLine[]).map((line, index) => <UnifiedRowView key={start + index} line={line} />)}
        </div>
      </div>
    </div>
  )
}

function UnifiedRowView({ line }: { line: DiffLine }) {
  return (
    <div className={`repo-diff-row kind-${line.kind}`} style={{ height: ROW_HEIGHT }}>
      <span className="repo-diff-gutter">{line.kind === 'del' ? line.oldLine : line.kind === 'add' ? line.newLine : line.kind === 'context' ? line.newLine : ''}</span>
      <span className="repo-diff-sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
      <code className="repo-diff-text">{line.text || ' '}</code>
    </div>
  )
}

function SplitRowView({ row }: { row: SplitRow }) {
  if (row.kind !== 'pair') {
    return <div className={`repo-diff-row kind-${row.kind}`} style={{ height: ROW_HEIGHT }}><code className="repo-diff-text repo-diff-span">{row.text || ' '}</code></div>
  }
  return (
    <div className="repo-diff-row repo-diff-split" style={{ height: ROW_HEIGHT }}>
      <span className="repo-diff-gutter">{row.left?.num ?? ''}</span>
      <code className={`repo-diff-text half kind-${row.left?.kind ?? 'empty'}`}>{row.left ? (row.left.text || ' ') : ''}</code>
      <span className="repo-diff-gutter">{row.right?.num ?? ''}</span>
      <code className={`repo-diff-text half kind-${row.right?.kind ?? 'empty'}`}>{row.right ? (row.right.text || ' ') : ''}</code>
    </div>
  )
}

/** Pair consecutive delete/add runs into aligned side-by-side rows. */
function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === 'hunk' || line.kind === 'meta') { rows.push({ kind: line.kind, text: line.text }); index += 1; continue }
    if (line.kind === 'context') {
      rows.push({ kind: 'pair', left: { num: line.oldLine, text: line.text, kind: 'context' }, right: { num: line.newLine, text: line.text, kind: 'context' } })
      index += 1; continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (index < lines.length && lines[index].kind === 'del') { dels.push(lines[index]); index += 1 }
    while (index < lines.length && lines[index].kind === 'add') { adds.push(lines[index]); index += 1 }
    const pairCount = Math.max(dels.length, adds.length)
    for (let offset = 0; offset < pairCount; offset += 1) {
      const del = dels[offset]
      const add = adds[offset]
      rows.push({
        kind: 'pair',
        left: del ? { num: del.oldLine, text: del.text, kind: 'del' } : { text: '', kind: 'empty' },
        right: add ? { num: add.newLine, text: add.text, kind: 'add' } : { text: '', kind: 'empty' },
      })
    }
  }
  return rows
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
