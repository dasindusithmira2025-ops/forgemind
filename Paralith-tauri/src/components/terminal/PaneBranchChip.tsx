import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { holdNativeOverlay } from '../../stores/nativeOverlay'
import { placeUsagePopover, VIEWPORT_MARGIN, type PopoverPosition } from '../../features/usage/usagePopoverPlacement'
import { directoryKey, usePaneBranchStore } from '../../features/terminals/paneBranchStore'
import { relativeTime } from '../../shared/layout'

const POPOVER_WIDTH = 320

interface PaneBranchChipProps {
  projectId: string
  /** This terminal's working directory — the worktree whose branch the chip reports. */
  directory: string
  active: boolean
}

/**
 * The branch this one terminal is on, and the control that changes it.
 *
 * Branch is a property of a working directory, not of a window: two agents in two worktrees are on
 * two branches at once, so the reading and the switch are both scoped to this pane's directory.
 * Panes outside a repository render nothing rather than an apologetic empty chip.
 */
export function PaneBranchChip({ projectId, directory, active }: PaneBranchChipProps) {
  const key = directoryKey(projectId, directory)
  const reading = usePaneBranchStore((state) => state.readings[key])
  const switching = usePaneBranchStore((state) => state.switching[key])
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)

  // Read on mount, whenever this pane becomes the focused one, and when the window regains focus —
  // the three moments a developer is actually looking at this header.
  useEffect(() => { void usePaneBranchStore.getState().refresh(projectId, directory) }, [projectId, directory, active])
  useEffect(() => {
    const refresh = () => void usePaneBranchStore.getState().refresh(projectId, directory)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [projectId, directory])

  if (!reading || (reading.unavailable && !reading.branch)) return null

  const label = switching ?? reading.branch ?? 'detached'
  const title = `${label} — ${directory}${reading.error ? `\n${reading.error}` : ''}`

  return <>
    <button
      ref={setAnchor}
      type="button"
      className={`pane-branch ${open ? 'is-open' : ''} ${reading.error ? 'has-error' : ''}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Branch ${label}. Switch this terminal's branch`}
      title={title}
      disabled={Boolean(switching)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        setOpen((value) => !value)
        void usePaneBranchStore.getState().refresh(projectId, directory, true)
        void usePaneBranchStore.getState().loadBranches(projectId)
      }}
    >
      {switching ? <Loader2 className="is-spinning" size={11} aria-hidden /> : <GitBranch size={11} aria-hidden />}
      <span className="pane-branch-name">{label}</span>
      {!switching && (reading.ahead > 0 || reading.behind > 0) && <span className="pane-branch-sync">
        {reading.ahead > 0 && <em>{`↑${reading.ahead}`}</em>}
        {reading.behind > 0 && <em>{`↓${reading.behind}`}</em>}
      </span>}
      {!switching && reading.dirty > 0 && <span className="pane-branch-dirty" title={`${reading.dirty} changed file${reading.dirty === 1 ? '' : 's'}`}>{reading.dirty}</span>}
    </button>
    {open && <PaneBranchMenu projectId={projectId} directory={directory} anchor={anchor} onClose={() => { setOpen(false); anchor?.focus() }} />}
  </>
}

/**
 * The status-bar reading for whichever pane is focused. It never fetches — the pane's own chip is
 * the reader — so the bar can only ever repeat what a terminal already reported.
 */
export function PaneBranchStatus({ projectId, directory }: { projectId: string; directory?: string }) {
  const reading = usePaneBranchStore((state) => (directory ? state.readings[directoryKey(projectId, directory)] : undefined))
  return <span title={directory}>{reading?.branch ?? 'No branch'}</span>
}

function PaneBranchMenu({ projectId, directory, anchor, onClose }: { projectId: string; directory: string; anchor: HTMLElement | null; onClose: () => void }) {
  const key = directoryKey(projectId, directory)
  const reading = usePaneBranchStore((state) => state.readings[key])
  const list = usePaneBranchStore((state) => state.lists[projectId])
  const switching = usePaneBranchStore((state) => state.switching[key])
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const [filter, setFilter] = useState('')

  // The menu can overlap the right-side tool panel, which may host the native Browser webview —
  // that composites above all HTML, so hide it while the menu is up.
  useEffect(holdNativeOverlay, [])

  useEffect(() => {
    const place = () => {
      const rect = anchor?.getBoundingClientRect()
      if (!rect) return
      setPosition(placeUsagePopover(
        // Open from the chip's left edge: the shared helper anchors a popover's right edge to
        // `right`, and a pane-header chip reads best with the menu hanging below it.
        { top: rect.top, bottom: rect.bottom, right: rect.left + POPOVER_WIDTH },
        { width: window.innerWidth, height: window.innerHeight },
        { width: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2), height: ref.current?.offsetHeight ?? 320 },
      ))
    }
    place()
    const frame = window.requestAnimationFrame(place)
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('keydown', keys)
    document.addEventListener('mousedown', outside)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('keydown', keys)
      document.removeEventListener('mousedown', outside)
    }
  }, [anchor, onClose])

  const locals = useMemo(() => (list?.items ?? []).filter((branch) => branch.kind === 'local'), [list])
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? locals.filter((branch) => branch.name.toLowerCase().includes(needle)) : locals
  }, [locals, filter])

  const choose = (name: string) => {
    onClose()
    if (name === reading?.branch) return
    void usePaneBranchStore.getState().switchBranch(projectId, directory, name)
  }

  return createPortal(
    <div
      ref={ref}
      className="pane-branch-popover"
      role="menu"
      aria-label="Switch this terminal's branch"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? undefined : 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="pane-branch-popover-header">
        <div>
          <strong>{reading?.branch ?? 'Detached HEAD'}</strong>
          <small className="mono" title={directory}>{directory}</small>
        </div>
        <button
          type="button"
          className="pane-branch-refresh"
          aria-label="Refresh branches"
          onClick={() => {
            void usePaneBranchStore.getState().refresh(projectId, directory, true)
            void usePaneBranchStore.getState().loadBranches(projectId, true)
          }}
        >
          <RefreshCw className={list?.status === 'loading' ? 'is-spinning' : ''} size={12} />
        </button>
      </header>

      {reading && (reading.ahead > 0 || reading.behind > 0 || reading.dirty > 0) && <div className="pane-branch-state">
        {reading.ahead > 0 && <span><ArrowUp size={11} aria-hidden />{reading.ahead} ahead</span>}
        {reading.behind > 0 && <span><ArrowDown size={11} aria-hidden />{reading.behind} behind</span>}
        {reading.dirty > 0 && <span>{reading.dirty} changed file{reading.dirty === 1 ? '' : 's'}</span>}
      </div>}

      {reading?.error && <p className="pane-branch-error" role="alert">{reading.error}</p>}

      <input
        autoFocus
        className="pane-branch-filter"
        aria-label="Filter branches"
        placeholder="Filter branches"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && matches[0]) choose(matches[0].name) }}
      />

      <div className="pane-branch-list">
        {list?.status === 'loading' && locals.length === 0 && <p className="pane-branch-empty">Reading branches…</p>}
        {list?.status === 'error' && <p className="pane-branch-empty">{list.error}</p>}
        {list?.status === 'ready' && matches.length === 0 && <p className="pane-branch-empty">No branch matches that filter.</p>}
        {matches.map((branch) => {
          const current = branch.name === reading?.branch
          return (
            <button
              key={branch.fullRef}
              role="menuitem"
              type="button"
              className={`pane-branch-item ${current ? 'is-current' : ''}`}
              disabled={Boolean(switching)}
              onClick={() => choose(branch.name)}
            >
              <span className="pane-branch-item-mark" aria-hidden>{current ? <Check size={12} /> : <GitBranch size={12} />}</span>
              <span className="pane-branch-item-text">
                <strong>{branch.name}</strong>
                <em title={branch.latestSubject}>{branch.latestSubject || 'No commits'} · {relativeTime(branch.latestCommitAt)}</em>
              </span>
              {(branch.ahead > 0 || branch.behind > 0) && <span className="pane-branch-item-sync">
                {branch.ahead > 0 && <i>{`↑${branch.ahead}`}</i>}
                {branch.behind > 0 && <i>{`↓${branch.behind}`}</i>}
              </span>}
            </button>
          )
        })}
      </div>
      <footer className="pane-branch-footnote">Checks out in this working directory. Panes sharing it follow; isolate a pane in a worktree for a branch of its own.</footer>
    </div>,
    document.body,
  )
}
