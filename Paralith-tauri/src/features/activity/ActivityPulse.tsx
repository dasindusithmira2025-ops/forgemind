import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { isLive, needsAttention, pulseState, useActivityStore, type PulseState } from './activityStore'
import { ActivityDock } from './ActivityDock'
import './activity.css'

/**
 * How long a finished run keeps the tick before the control falls back to idle. Completion is
 * worth acknowledging once; a permanent ✓ would be a badge for "nothing is happening".
 */
const COMPLETE_HOLD_MS = 6000

const PULSE_TITLE: Record<PulseState, string> = {
  idle: 'Activity — nothing running',
  live: 'Activity — work in progress',
  attention: 'Activity — needs you',
  failure: 'Activity — something failed',
  complete: 'Activity — finished',
}

/**
 * The single quiet chrome control for Activity. It carries one signal (what, if anything, wants
 * the user) and opens the dock. Everything else lives inside the dock.
 */
export function ActivityPulse() {
  const threads = useActivityStore((state) => state.threads)
  const open = useActivityStore((state) => state.open)
  const setOpen = useActivityStore((state) => state.setOpen)
  const setPulseMounted = useActivityStore((state) => state.setPulseMounted)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [held, setHeld] = useState(false)

  useEffect(() => {
    setPulseMounted(true)
    return () => setPulseMounted(false)
  }, [setPulseMounted])

  const raw = pulseState(threads)
  // Re-arms the tick whenever a *newer* completion lands, not just when the bucket first fills.
  const lastComplete = threads
    .filter((thread) => thread.state === 'completed')
    .map((thread) => thread.updatedAt)
    .sort()
    .pop()

  useEffect(() => {
    if (raw !== 'complete') { setHeld(true); return }
    setHeld(true)
    const timer = window.setTimeout(() => setHeld(false), COMPLETE_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [raw, lastComplete])

  const state: PulseState = raw === 'complete' && !held ? 'idle' : raw
  const count = threads.filter((thread) => needsAttention(thread) || isLive(thread)).length
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }, [setOpen])

  return <div className="activity-pulse-wrap">
    <button
      ref={buttonRef}
      className={`activity-pulse is-${state}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={count > 0 ? `${PULSE_TITLE[state]}. ${count} active.` : PULSE_TITLE[state]}
      title={PULSE_TITLE[state]}
      onClick={() => setOpen(!open)}
    >
      {state === 'failure'
        ? <AlertTriangle size={13} aria-hidden="true" />
        : state === 'complete'
          ? <Check size={13} aria-hidden="true" />
          : <span className="activity-pulse-dot" aria-hidden="true" />}
      {count > 0 && <span className="activity-pulse-count">{count}</span>}
    </button>
    {open && <ActivityDock anchor={buttonRef.current} onClose={close} />}
  </div>
}
