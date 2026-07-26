import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { aiUsageStore, useAiUsage } from './aiUsageStore'
import type { ProviderUsageSnapshot, UsageWindow, UsageWindowKind } from '../../native/types'

export function AiUsageStatusBar() {
  const snapshots = useAiUsage().filter((snapshot) => snapshot.status !== 'unsupported')
  if (snapshots.length === 0) return null
  return <div className="ai-usage-statusbar" aria-label="AI usage"><>{snapshots.map((snapshot) => <UsageChip key={snapshot.provider} snapshot={snapshot} />)}</></div>
}

function UsageChip({ snapshot }: { snapshot: ProviderUsageSnapshot }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fiveHour = usageWindow(snapshot, 'five_hour')
  const weekly = usageWindow(snapshot, 'weekly')
  const close = () => { setOpen(false); buttonRef.current?.focus() }
  const label = `${providerName(snapshot.provider)} usage. ${windowLabel(fiveHour, 'five-hour')}. ${windowLabel(weekly, 'weekly')}. ${freshnessLabel(snapshot)}.`
  return <>
    <button ref={buttonRef} className={`ai-usage-chip ${tone(fiveHour, weekly)}`} aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="ai-usage-provider-mark" aria-hidden="true">{snapshot.provider === 'claude' ? 'C' : 'O'}</span>
      <span className="ai-usage-value">{compactValue(fiveHour)} <small>5h</small></span>
      <span className="ai-usage-value">{compactValue(weekly)} <small>wk</small></span>
    </button>
    {open && <UsagePopover snapshot={snapshot} anchor={buttonRef.current} onClose={close} />}
  </>
}

function UsagePopover({ snapshot, anchor, onClose }: { snapshot: ProviderUsageSnapshot; anchor: HTMLButtonElement | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  useEffect(() => {
    const place = () => {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect(); const width = Math.min(380, window.innerWidth - 24)
      const height = ref.current?.offsetHeight ?? 220
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(height + 12, rect.top - 12) })
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose() }
    window.addEventListener('keydown', keys); document.addEventListener('mousedown', outside)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.removeEventListener('keydown', keys); document.removeEventListener('mousedown', outside) }
  }, [anchor, onClose])
  return createPortal(<section ref={ref} className="ai-usage-popover" role="dialog" aria-label={`${providerName(snapshot.provider)} usage`} style={{ left: position.left, top: position.top, transform: 'translateY(-100%)' }}>
    <header><div><span className="ai-usage-provider-mark">{snapshot.provider === 'claude' ? 'C' : 'O'}</span><strong>{providerName(snapshot.provider)}</strong><small>{updatedLabel(snapshot)}</small></div><button className="ai-usage-refresh" aria-label={`Refresh ${providerName(snapshot.provider)} usage`} onClick={() => void aiUsageStore.refresh()}><RefreshCw size={13} /></button></header>
    {snapshot.status === 'loading' ? <div className="ai-usage-skeleton"><i /><i /></div> : snapshot.status === 'unauthenticated' ? <p className="ai-usage-message">The provider CLI is not currently signed in.</p> : snapshot.status === 'error' ? <p className="ai-usage-message">{snapshot.diagnosticMessage || 'Usage could not be refreshed.'}</p> : snapshot.windows.length === 0 ? <p className="ai-usage-message">The provider has not exposed reliable limit information. Local token activity is kept separate from quota.</p> : <div className="ai-usage-windows">{snapshot.windows.map((window) => <WindowRow key={window.kind} window={window} />)}</div>}
    {snapshot.freshness === 'stale' && <footer><span>Stale data shown</span><button onClick={() => void aiUsageStore.refresh()}>Retry</button></footer>}
  </section>, document.body)
}

function WindowRow({ window }: { window: UsageWindow }) { return <section className={`ai-usage-window ${window.isCritical ? 'critical' : window.isWarning ? 'caution' : ''}`}><strong>{window.kind === 'five_hour' ? 'SESSION / 5-HOUR' : window.kind.replace('_', ' ').toUpperCase()}</strong><div className="ai-usage-track"><i style={{ width: `${window.remainingPercent}%` }} /></div><div><span>{window.remainingPercent}% left</span><span>{window.resetLabel ? `Resets in ${window.resetLabel}` : 'Reset time unavailable'}</span></div></section> }
function usageWindow(snapshot: ProviderUsageSnapshot, kind: UsageWindowKind) { return snapshot.windows.find((window) => window.kind === kind) }
function compactValue(window?: UsageWindow) { return window ? `${window.remainingPercent}%` : '--' }
function providerName(provider: ProviderUsageSnapshot['provider']) { return provider === 'claude' ? 'Claude' : 'Codex' }
function windowLabel(window: UsageWindow | undefined, label: string) { return window ? `${window.remainingPercent}% remaining ${label}${window.resetLabel ? `, resets in ${window.resetLabel}` : ''}` : `${label} limit unavailable` }
function freshnessLabel(snapshot: ProviderUsageSnapshot) { return snapshot.freshness === 'live' ? 'Updated just now' : snapshot.freshness === 'stale' ? 'Stale data' : 'Recent data' }
function updatedLabel(snapshot: ProviderUsageSnapshot) { const age = Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.collectedAt)) / 60_000)); return `${age === 0 ? 'Updated just now' : `Updated ${age}m ago`}${snapshot.freshness === 'stale' ? ' · Stale' : ''}` }
function tone(...windows: Array<UsageWindow | undefined>) { return windows.some((window) => window?.isCritical) ? 'critical' : windows.some((window) => window?.isWarning) ? 'caution' : '' }
