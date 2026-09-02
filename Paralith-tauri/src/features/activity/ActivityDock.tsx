import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ChevronRight, ExternalLink, X } from 'lucide-react'
import { holdNativeOverlay } from '../../stores/nativeOverlay'
import { relativeTime } from '../../shared/layout'
// The status-bar roster solved the same placement problem: prefer the gap above the anchor, flip
// below when it does not fit, clamp to the viewport. A title-bar anchor always takes the flip.
import { placeUsagePopover, VIEWPORT_MARGIN, type PopoverPosition } from '../usage/usagePopoverPlacement'
import type { ActivityThread } from '../../native/types'
import { activityStateLabel, bucketThreads, useActivityStore } from './activityStore'

const DOCK_WIDTH = 440

const NO_APPROVAL_RIGHTS = 'Your GitHub account cannot review this environment.'

interface ActivityDockProps {
  anchor: HTMLElement | null
  onClose: (restoreFocus?: boolean) => void
}

export function ActivityDock({ anchor, onClose }: ActivityDockProps) {
  const threads = useActivityStore((state) => state.threads)
  const loaded = useActivityStore((state) => state.loaded)
  const error = useActivityStore((state) => state.error)
  const ref = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const { attention, live, recent } = bucketThreads(threads)

  // The dock can overlap the right-side tool panel, which may host the native Browser webview —
  // that composites above all HTML, so hide it while the dock is up.
  useEffect(holdNativeOverlay, [])

  useEffect(() => {
    const place = () => {
      // A missing anchor still gets a position: an unplaced dock would render permanently
      // invisible, which is a worse failure than one docked to the top-right corner.
      const rect = anchor?.getBoundingClientRect() ?? { top: 0, bottom: 0, right: window.innerWidth }
      setPosition(placeUsagePopover(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: Math.min(DOCK_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2), height: ref.current?.offsetHeight ?? 320 },
      ))
    }
    place()
    const frame = window.requestAnimationFrame(place)
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose(false)
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

  const empty = attention.length === 0 && live.length === 0 && recent.length === 0

  return createPortal(
    <section
      ref={ref}
      className="activity-dock"
      role="dialog"
      aria-labelledby="activity-dock-title"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, width: DOCK_WIDTH, visibility: position ? undefined : 'hidden' }}
    >
      <header className="activity-dock-header">
        <strong id="activity-dock-title">Activity</strong>
        <button className="activity-dock-close" aria-label="Close activity" onClick={() => onClose()}><X size={13} /></button>
      </header>
      {error && <p className="activity-dock-error" role="alert">{error}</p>}
      <div className="activity-dock-body">
        {empty && <p className="activity-dock-empty">{loaded
          ? 'Nothing running. Agent runs and GitHub workflow runs appear here as they happen.'
          : 'Loading activity…'}</p>}
        <ActivitySection title="Needs you" tone="attention" threads={attention} />
        <ActivitySection title="Live" tone="live" threads={live} />
        <ActivitySection title="Recent" tone="recent" threads={recent} />
      </div>
    </section>,
    document.body,
  )
}

function ActivitySection({ title, tone, threads }: { title: string; tone: string; threads: ActivityThread[] }) {
  if (threads.length === 0) return null
  return <section className={`activity-section is-${tone}`} aria-label={title}>
    <h3>{title}<span>{threads.length}</span></h3>
    <ul>{threads.map((thread) => <ActivityRow key={thread.id} thread={thread} />)}</ul>
  </section>
}

function ActivityRow({ thread }: { thread: ActivityThread }) {
  const expanded = useActivityStore((state) => state.expanded.includes(thread.id))
  const reviewing = useActivityStore((state) => state.reviewing.includes(thread.id))
  const toggleExpanded = useActivityStore((state) => state.toggleExpanded)
  const review = useActivityStore((state) => state.review)
  const dismiss = useActivityStore((state) => state.dismiss)
  const { detail, approval } = thread
  const settled = thread.state === 'completed' || thread.state === 'failed' || thread.state === 'cancelled'
  const restriction = approval?.restriction ?? NO_APPROVAL_RIGHTS
  const facts: [string, string][] = []
  if (detail.workflowPath) facts.push(['Workflow', detail.workflowPath.split('/').pop() ?? detail.workflowPath])
  if (detail.branch) facts.push(['Branch', detail.branch])
  if (detail.commitSha) facts.push(['Commit', detail.commitSha.slice(0, 7)])
  if (detail.runNumber !== undefined) facts.push(['Run', `#${detail.runNumber}${detail.attempt && detail.attempt > 1 ? ` · attempt ${detail.attempt}` : ''}`])
  if (detail.environment) facts.push(['Environment', detail.environment])
  if (detail.provider) facts.push(['Agent', detail.provider])
  if (detail.event) facts.push(['Trigger', detail.event])

  return <li className={`activity-row is-${thread.state}`}>
    <button
      className="activity-row-main"
      aria-expanded={expanded}
      aria-label={`${thread.title} — ${activityStateLabel(thread.state)}. ${expanded ? 'Hide' : 'Show'} details`}
      onClick={() => toggleExpanded(thread.id)}
    >
      <span className="activity-row-dot" aria-hidden="true" />
      <span className="activity-row-copy">
        <strong>{thread.title}</strong>
        <span>{thread.summary}</span>
      </span>
      <span className="activity-row-meta">
        <span className="activity-row-state">{activityStateLabel(thread.state)}</span>
        <time dateTime={thread.updatedAt}>{relativeTime(thread.updatedAt)}</time>
      </span>
      <ChevronRight className="activity-row-chevron" size={13} aria-hidden="true" />
    </button>
    {thread.reason && <p className="activity-row-reason">{thread.reason}</p>}
    {approval && <div className="activity-row-approval">
      <span>{approval.environment} is waiting for a deployment decision.</span>
      <div className="activity-row-approval-actions">
        <button
          className="button button-primary"
          disabled={!approval.canApprove || reviewing}
          title={approval.canApprove ? undefined : restriction}
          onClick={() => void review(thread.id, true)}
        >{reviewing ? 'Sending…' : 'Approve'}</button>
        <button
          disabled={!approval.canApprove || reviewing}
          title={approval.canApprove ? undefined : restriction}
          onClick={() => void review(thread.id, false)}
        >Reject</button>
      </div>
      {!approval.canApprove && <small>{restriction}</small>}
    </div>}
    {expanded && <div className="activity-row-detail">
      {thread.steps.length > 0 && <ol className="activity-steps">
        {thread.steps.map((step) => <li key={step.key} className={`is-${step.state}`}>
          <span aria-hidden="true" />{step.label}<small>{activityStateLabel(step.state)}</small>
        </li>)}
      </ol>}
      {facts.length > 0 && <dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <div className="activity-row-detail-actions">
        {detail.url && <button onClick={() => void openUrl(detail.url as string).catch(() => undefined)}>
          <ExternalLink size={12} />Open on GitHub
        </button>}
        {settled && <button onClick={() => void dismiss(thread.id)}>Dismiss</button>}
      </div>
    </div>}
  </li>
}
