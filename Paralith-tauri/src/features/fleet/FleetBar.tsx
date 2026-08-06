import { useEffect, useMemo, useRef, useState } from 'react'
import {
  attentionCells,
  buildFleet,
  fleetStateLabel,
  waitLabel,
  waitPressure,
  waitedMs,
  type FleetCell,
  type FleetPaneInput,
} from './fleetSelectors'

/** How many waiting agents get their own cell before the rest fold into the queue popover. */
const INLINE_CELLS = 4

/**
 * Ticks once a second, but only while something is actually waiting. A fleet with nothing to
 * report must not re-render the title bar every second for the life of the session.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

interface FleetBarProps {
  panes: FleetPaneInput[]
  activePaneId?: string
  onFocusPane: (paneId: string) => void
}

/**
 * The Fleet Bar: one cell per pane that needs a human, ordered by how long it has been waiting.
 *
 * It lives in the dead space the workspace title bar was already spending on a flex spacer, so the
 * most valuable readout in the product costs no vertical room. It replaces both the old title-bar
 * "N agents waiting" chip and the status-bar "N agent attention" text — two surfaces that named the
 * same thing differently and neither of which said *which* agent or *how long*.
 *
 * An empty Fleet Bar is the reward state: when nothing needs you, only the quiet fleet summary
 * remains.
 */
export function FleetBar({ panes, activePaneId, onFocusPane }: FleetBarProps) {
  const [queueOpen, setQueueOpen] = useState(false)
  const cells = useMemo(() => buildFleet(panes), [panes])
  const attention = useMemo(() => attentionCells(cells), [cells])
  const now = useNow(attention.length > 0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!queueOpen) return
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setQueueOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setQueueOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [queueOpen])

  if (cells.length === 0) return <div className="fleet-bar-spacer" />

  const inline = attention.slice(0, INLINE_CELLS)
  const overflow = attention.length - inline.length

  const focus = (paneId: string) => { setQueueOpen(false); onFocusPane(paneId) }

  return <div className="fleet-bar" ref={wrapRef}>
    <div className="fleet-cells" role="group" aria-label="Agents needing attention">
      {inline.map((cell) => <FleetCellButton
        key={cell.paneId}
        cell={cell}
        now={now}
        active={cell.paneId === activePaneId}
        onClick={() => focus(cell.paneId)}
      />)}
    </div>

    {/* One control opens the full fleet, whether or not anything is waiting — so the whole roster
        is always reachable and the bar never grows a second disclosure. */}
    <button
      type="button"
      className={`fleet-summary${attention.length > 0 ? ' has-attention' : ''}`}
      aria-expanded={queueOpen}
      aria-haspopup="menu"
      // Explicit, because the visible label is split across spans that carry no separating
      // whitespace — the computed name would otherwise read "6agents".
      aria-label={`Open agent fleet, ${cells.length} agent${cells.length === 1 ? '' : 's'}`}
      onClick={() => setQueueOpen((open) => !open)}
    >
      {overflow > 0 && <span className="fleet-summary-overflow measured">+{overflow}</span>}
      <span className="measured fleet-summary-count">{cells.length}</span>
      <span className="fleet-summary-label">{cells.length === 1 ? 'agent' : 'agents'}</span>
    </button>

    {/* Screen readers get the queue depth, not the individual timers: a per-second live region
        would be unusable. */}
    <span className="sr-only" aria-live="polite">
      {attention.length === 0 ? 'No agents waiting' : `${attention.length} agent${attention.length === 1 ? '' : 's'} waiting`}
    </span>

    {queueOpen && <div className="fleet-queue" role="menu" aria-label="Agent fleet">
      {cells.map((cell) => {
        const ms = waitedMs(cell, now)
        return <button
          key={cell.paneId}
          role="menuitem"
          className={`fleet-queue-row state-${cell.state}${cell.paneId === activePaneId ? ' is-active' : ''}`}
          title={cell.reason}
          onClick={() => focus(cell.paneId)}
        >
          <span className="fleet-dot" aria-hidden />
          <span className="fleet-queue-title">{cell.title}</span>
          <span className="fleet-queue-state">{fleetStateLabel(cell.state)}</span>
          <span className="measured fleet-queue-wait">{cell.waitingSince ? waitLabel(ms) : ''}</span>
        </button>
      })}
    </div>}
  </div>
}

function FleetCellButton({ cell, now, active, onClick }: {
  cell: FleetCell
  now: number
  active: boolean
  onClick: () => void
}) {
  const ms = waitedMs(cell, now)
  const label = fleetStateLabel(cell.state)
  return <button
    type="button"
    className={`fleet-cell state-${cell.state}${active ? ' is-active' : ''}`}
    data-pressure={waitPressure(ms)}
    title={cell.reason ? `${cell.title} — ${label} ${waitLabel(ms)}: ${cell.reason}` : `${cell.title} — ${label} ${waitLabel(ms)}`}
    aria-label={`Focus ${cell.title}, ${label} ${waitLabel(ms)}`}
    onClick={onClick}
  >
    {/* The bar is the non-colour carrier: its height encodes wait pressure, so the state still
        reads without relying on green-versus-amber at a 7px scale. */}
    <span className="fleet-cell-bar" aria-hidden />
    <span className="fleet-cell-title">{cell.title}</span>
    <span className="measured fleet-cell-wait">{waitLabel(ms)}</span>
  </button>
}
