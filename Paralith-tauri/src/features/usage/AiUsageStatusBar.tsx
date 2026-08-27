import { Gauge, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { holdNativeOverlay } from '../../stores/nativeOverlay'
import { aiUsageStore, useAiUsage } from './aiUsageStore'
import { POPOVER_WIDTH, VIEWPORT_MARGIN, placeUsagePopover, type PopoverPosition } from './usagePopoverPlacement'
import type { ProviderUsageSnapshot, UsageWindow, UsageWindowKind } from '../../native/types'

export function AiUsageStatusBar() {
  const { snapshots, isRefreshing } = useAiUsage()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const visible = snapshots.filter((snapshot) => snapshot.status !== 'unsupported')
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])
  const summary = visible.length === 0
    ? isRefreshing ? 'Loading usage' : 'Usage unavailable'
    : visible.map(providerCompactLabel).join(', ')

  return <div className="ai-usage-statusbar">
    <button
      ref={buttonRef}
      className={`ai-usage-trigger ${toneForSnapshots(visible)}`}
      aria-label={`Subscription usage. ${summary}.`}
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    >
      <Gauge size={13} aria-hidden="true" />
      <span className="ai-usage-trigger-label">Usage</span>
      {visible.length > 0
        ? <span className="ai-usage-trigger-providers" aria-hidden="true">
            {visible.map((snapshot) => <ProviderCompact key={snapshot.provider} snapshot={snapshot} />)}
          </span>
        : <span className="ai-usage-trigger-state">{isRefreshing ? '…' : '--'}</span>}
    </button>
    {open && <UsagePopover snapshots={visible} isRefreshing={isRefreshing} anchor={buttonRef.current} onClose={close} />}
  </div>
}

function ProviderCompact({ snapshot }: { snapshot: ProviderUsageSnapshot }) {
  const windows = orderedWindows(snapshot).filter(({ kind }) => kind === 'five_hour' || kind === 'weekly')
  const tightest = tightestWindow(snapshot)
  const compact = windows.length > 0
    ? windows.map((window) => `${compactWindowName(window.kind)} ${window.remainingPercent}%`).join(' · ')
    : tightest
      ? `${tightest.remainingPercent}%`
      : '--'
  return <span className={`ai-usage-compact-provider is-${snapshot.provider}`}>
    <span>{snapshot.provider === 'claude' ? 'Cl' : 'Cx'}</span>
    <strong>{compact}</strong>
  </span>
}

function UsagePopover({ snapshots, isRefreshing, anchor, onClose }: { snapshots: ProviderUsageSnapshot[]; isRefreshing: boolean; anchor: HTMLButtonElement | null; onClose: (restoreFocus?: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const [now, setNow] = useState(Date.now())
  const sorted = useMemo(() => [...snapshots].sort((a, b) => urgency(b) - urgency(a)), [snapshots])

  // The roster opens upward over the right-side tool panel, which may host the native Browser
  // webview — that is composited above all HTML, so hide it while the roster is up.
  useEffect(holdNativeOverlay, [])

  useEffect(() => {
    const place = () => {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      setPosition(placeUsagePopover(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        { width: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2), height: ref.current?.offsetHeight ?? 280 },
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return createPortal(
    <section
      ref={ref}
      className="ai-usage-popover"
      role="dialog"
      aria-labelledby="ai-usage-title"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? undefined : 'hidden' }}
    >
      <header className="ai-usage-popover-header">
        <div>
          <strong id="ai-usage-title">Subscription usage</strong>
          <small>Live provider limits</small>
        </div>
        <button className="ai-usage-refresh" aria-label="Refresh subscription usage" disabled={isRefreshing} onClick={() => void aiUsageStore.refresh()}>
          <RefreshCw className={isRefreshing ? 'is-spinning' : ''} size={13} />
        </button>
      </header>
      <div className="ai-usage-roster">
        {sorted.length === 0
          ? isRefreshing
            ? <UsageSkeleton />
            : <p className="ai-usage-message">No signed-in Claude or Codex subscription was detected.</p>
          : sorted.map((snapshot) => <ProviderUsageRow key={snapshot.provider} snapshot={snapshot} now={now} />)}
      </div>
      <footer className="ai-usage-footnote">Provider-reported limits. Local token history is never converted into quota.</footer>
    </section>,
    document.body,
  )
}

function ProviderUsageRow({ snapshot, now }: { snapshot: ProviderUsageSnapshot; now: number }) {
  const windows = orderedWindows(snapshot)
  const state = providerState(snapshot)
  return <article className={`ai-usage-provider is-${snapshot.provider}`}>
    <header>
      <span className="ai-usage-provider-mark" aria-hidden="true">{snapshot.provider === 'claude' ? 'Cl' : 'Cx'}</span>
      <div>
        <strong>{providerName(snapshot.provider)}</strong>
        <small>{sourceLabel(snapshot)} · {updatedLabel(snapshot, now)}</small>
      </div>
      <span className={`ai-usage-provider-state ${state.tone}`}>{state.label}</span>
    </header>
    {windows.length > 0
      ? <div className="ai-usage-windows">
          {windows.map((window) => <WindowRow key={window.kind} window={window} now={now} />)}
        </div>
      : <p className="ai-usage-message">{snapshot.diagnosticMessage || 'No live subscription limits were reported.'}</p>}
    {snapshot.status === 'stale' && snapshot.diagnosticMessage
      ? <p className="ai-usage-inline-note">{snapshot.diagnosticMessage}</p>
      : null}
  </article>
}

function WindowRow({ window, now }: { window: UsageWindow; now: number }) {
  const severity = window.isCritical ? 'critical' : window.isWarning ? 'caution' : ''
  return <section className={`ai-usage-window ${severity}`}>
    <div className="ai-usage-window-copy">
      <strong>{windowName(window.kind)}</strong>
      <span>{resetText(window, now)}</span>
      <b>{window.remainingPercent}% left</b>
    </div>
    <div
      className="ai-usage-track"
      role="progressbar"
      aria-label={`${windowName(window.kind)} remaining`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={window.remainingPercent}
    >
      <i style={{ width: `${window.remainingPercent}%` }} />
    </div>
  </section>
}

function UsageSkeleton() {
  return <div className="ai-usage-skeleton" aria-label="Loading subscription usage"><i /><i /></div>
}

function orderedWindows(snapshot: ProviderUsageSnapshot) {
  const order: UsageWindowKind[] = ['five_hour', 'daily', 'weekly', 'fable_weekly']
  return [...snapshot.windows].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

function tightestWindow(snapshot: ProviderUsageSnapshot) {
  return snapshot.windows.reduce<UsageWindow | undefined>((current, window) =>
    !current || window.remainingPercent < current.remainingPercent ? window : current, undefined)
}

function urgency(snapshot: ProviderUsageSnapshot) {
  const window = tightestWindow(snapshot)
  return window ? 100 - window.remainingPercent : -1
}

function toneForSnapshots(snapshots: ProviderUsageSnapshot[]) {
  const windows = snapshots.flatMap((snapshot) => snapshot.windows)
  return windows.some((window) => window.isCritical) ? 'critical' : windows.some((window) => window.isWarning) ? 'caution' : ''
}

function providerCompactLabel(snapshot: ProviderUsageSnapshot) {
  const window = tightestWindow(snapshot)
  return `${providerName(snapshot.provider)} ${window ? `${window.remainingPercent}% remaining` : providerState(snapshot).label}`
}

function providerState(snapshot: ProviderUsageSnapshot) {
  if (snapshot.status === 'unauthenticated') return { label: 'Sign in', tone: 'muted' }
  if (snapshot.status === 'error') return { label: 'Unavailable', tone: 'danger' }
  if (snapshot.status === 'stale' || snapshot.freshness === 'stale') return { label: 'Last known', tone: 'warning' }
  if (snapshot.windows.some((window) => window.isCritical)) return { label: 'Critical', tone: 'danger' }
  if (snapshot.windows.some((window) => window.isWarning)) return { label: 'Low', tone: 'warning' }
  return { label: 'Live', tone: 'live' }
}

function providerName(provider: ProviderUsageSnapshot['provider']) {
  return provider === 'claude' ? 'Claude' : 'Codex'
}

function sourceLabel(snapshot: ProviderUsageSnapshot) {
  if (snapshot.source === 'supported_endpoint') return 'Anthropic account'
  if (snapshot.source === 'provider_cli') return 'Codex CLI'
  return 'Local activity'
}

function windowName(kind: UsageWindowKind) {
  if (kind === 'five_hour') return '5-hour'
  if (kind === 'fable_weekly') return 'Fable weekly'
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function compactWindowName(kind: UsageWindowKind) {
  return kind === 'five_hour' ? '5h' : 'Wk'
}

function resetText(window: UsageWindow, now: number) {
  if (!window.resetsAt) return 'Reset unavailable'
  const reset = Date.parse(window.resetsAt)
  if (!Number.isFinite(reset)) return 'Reset unavailable'
  const minutes = Math.max(0, Math.ceil((reset - now) / 60_000))
  if (minutes >= 1440) return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 60) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `Resets in ${minutes}m`
}

function updatedLabel(snapshot: ProviderUsageSnapshot, now: number) {
  const updated = Date.parse(snapshot.sourceUpdatedAt || snapshot.collectedAt)
  if (!Number.isFinite(updated)) return 'update time unavailable'
  const age = Math.max(0, Math.floor((now - updated) / 60_000))
  return age === 0 ? 'updated now' : `updated ${age}m ago`
}
