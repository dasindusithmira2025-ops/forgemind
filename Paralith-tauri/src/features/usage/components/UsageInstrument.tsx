import { GitBranch, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ContributionDay, GithubActivitySnapshot, ProviderUsageSnapshot, SystemTelemetrySnapshot, TelemetryState, UsageTelemetrySnapshot, UsageWindow } from '../../../native/types'
import { formatDay } from '../usageFormat'

const providerName = (provider: ProviderUsageSnapshot['provider']) => provider === 'claude' ? 'Claude Code' : 'Codex'
const windowName = (kind: UsageWindow['kind']) => ({ five_hour: '5-HOUR', daily: 'DAILY', weekly: 'WEEKLY', fable_weekly: 'FABLE WEEKLY' })[kind]

function stateLabel(state: TelemetryState | ProviderUsageSnapshot['status'], freshness?: ProviderUsageSnapshot['freshness']) {
  if (state === 'ready') return freshness === 'stale' ? 'STALE CACHE' : 'ONLINE'
  return ({ loading: 'SYNCING', unsupported: 'UNAVAILABLE', unauthenticated: 'AUTH REQUIRED', stale: 'STALE CACHE', error: 'ERROR', unavailable: 'UNAVAILABLE' } as Record<string, string>)[state] ?? 'UNAVAILABLE'
}

function formatCountdown(resetAt: string | undefined, now: number) {
  if (!resetAt) return 'RESET UNKNOWN'
  const seconds = Math.max(0, Math.floor((new Date(resetAt).getTime() - now) / 1000))
  if (!Number.isFinite(seconds)) return 'RESET UNKNOWN'
  if (seconds >= 86_400) return `IN ${Math.floor(seconds / 86_400)}D ${Math.floor((seconds % 86_400) / 3_600)}H`
  return `IN ${Math.floor(seconds / 3_600)}H ${Math.floor((seconds % 3_600) / 60)}M`
}

function formatExact(resetAt: string | undefined) {
  if (!resetAt) return 'Provider did not report a reset time.'
  const date = new Date(resetAt)
  return Number.isNaN(date.getTime()) ? 'Provider reported an invalid reset time.' : `Reset ${date.toLocaleString()}`
}

function QuotaRing({ remaining, unavailable, label }: { remaining?: number; unavailable: boolean; label: string }) {
  const radius = 43
  const circumference = 2 * Math.PI * radius
  const value = remaining === undefined ? 0 : Math.max(0, Math.min(100, remaining))
  return <div className={`usage-quota-ring ${unavailable ? 'is-unavailable' : ''}`} title={remaining === undefined ? 'Quota value unavailable' : `${label}: ${remaining}% remaining`}>
    <svg viewBox="0 0 112 112" aria-hidden="true">
      <circle className="usage-quota-ring-track" cx="56" cy="56" r={radius} />
      <circle className="usage-quota-ring-value" cx="56" cy="56" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} />
    </svg>
    <span className="usage-quota-ring-copy"><strong>{remaining === undefined ? '—' : `${remaining}%`}</strong><small>LEFT</small></span>
  </div>
}

function QuotaWindowMeter({ window }: { window: UsageWindow }) {
  return <div className="usage-window-meter" title={formatExact(window.resetsAt)}>
    <div className="usage-window-meter-head"><span>{windowName(window.kind)}</span><b>{window.remainingPercent}% LEFT</b></div>
    <div className="usage-meter-track"><i style={{ width: `${window.remainingPercent}%` }} /></div>
    <div className="usage-window-meter-meta"><span>{window.usedPercent}% USED</span><span>{formatCountdown(window.resetsAt, Date.now())}</span></div>
  </div>
}

function ProviderQuota({ snapshot }: { snapshot?: ProviderUsageSnapshot }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer) }, [])
  const windows = snapshot?.windows ?? []
  const primary = windows[0]
  const unavailable = !snapshot || !['ready', 'stale'].includes(snapshot.status) || windows.length === 0
  return <article className={`usage-provider-instrument is-${snapshot?.provider ?? 'unknown'}`}>
    <header className="usage-provider-instrument-head">
      <div><span className="usage-label">PROVIDER</span><h3>{snapshot ? providerName(snapshot.provider) : 'Provider'}</h3></div>
      <span className={`usage-status usage-status-${snapshot?.status ?? 'loading'}`}><i />{stateLabel(snapshot?.status ?? 'loading', snapshot?.freshness)}</span>
    </header>
    <div className="usage-provider-instrument-body">
      <QuotaRing remaining={primary?.remainingPercent} unavailable={unavailable} label={snapshot ? providerName(snapshot.provider) : 'Provider'} />
      <div className="usage-provider-instrument-copy">
        <span className="usage-label">{primary ? windowName(primary.kind) : 'SUBSCRIPTION WINDOW'}</span>
        <strong>{primary ? `${primary.remainingPercent}% remaining` : 'No live quota reported'}</strong>
        <span className="usage-reset" title={formatExact(primary?.resetsAt)}>{formatCountdown(primary?.resetsAt, now)}</span>
        <span className="usage-sync">{primary?.confidence.toUpperCase() ?? 'UNAVAILABLE'} · SYNC {snapshot?.collectedAt ? new Date(snapshot.collectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
      </div>
    </div>
    {windows.length > 0 ? <div className="usage-window-list">{windows.map((window) => <QuotaWindowMeter key={window.kind} window={window} />)}</div> : <p className="usage-instrument-message">{snapshot?.diagnosticMessage ?? 'Waiting for provider-reported limits.'}</p>}
  </article>
}

function AIUsagePanel({ snapshots, isRefreshing, onRefresh }: { snapshots: ProviderUsageSnapshot[]; isRefreshing: boolean; onRefresh: () => void }) {
  return <section className="usage-instrument-section usage-ai-instrument" aria-labelledby="usage-ai-title">
    <header className="usage-section-head"><div><span className="usage-label">01 / CAPACITY</span><h2 id="usage-ai-title">AI subscription usage</h2></div><div className="usage-instrument-actions"><span className="usage-section-meta">{isRefreshing ? 'SYNC IN PROGRESS' : 'PROVIDER REPORTED'}</span><button type="button" className="usage-source-refresh" onClick={onRefresh} disabled={isRefreshing} aria-label="Refresh AI provider usage"><RefreshCw size={12} className={isRefreshing ? 'is-spinning' : undefined} aria-hidden /> REFRESH SOURCES</button></div></header>
    <div className="usage-provider-instrument-grid">
      <ProviderQuota snapshot={snapshots.find((snapshot) => snapshot.provider === 'claude')} />
      <ProviderQuota snapshot={snapshots.find((snapshot) => snapshot.provider === 'codex')} />
    </div>
  </section>
}

function ContributionGrid({ days }: { days: ContributionDay[] }) {
  const max = Math.max(...days.map((day) => day.count), 1)
  return <div className="usage-contribution-grid" aria-label="90 day GitHub contribution activity">{days.map((day) => <span key={day.date} className="usage-contribution-cell" style={{ opacity: day.count === 0 ? .18 : .3 + day.count / max * .7 }} title={`${formatDay(day.date)} · ${day.count} contributions`} />)}</div>
}

function ActivityStat({ label, value, detail }: { label: string; value?: string; detail?: string }) {
  return <div className="usage-activity-stat"><span className="usage-label">{label}</span><strong>{value ?? '—'}</strong>{detail && <small>{detail}</small>}</div>
}

function DeveloperActivity({ github, onRefresh, isRefreshing }: { github?: GithubActivitySnapshot; onRefresh: () => void; isRefreshing: boolean }) {
  const ready = github?.state === 'ready' || github?.state === 'stale'
  return <section className="usage-instrument-section usage-github-instrument" aria-labelledby="usage-github-title">
    <header className="usage-section-head"><div><span className="usage-label">02 / SIGNAL</span><h2 id="usage-github-title"><GitBranch size={15} aria-hidden /> GitHub activity</h2></div><button type="button" className="usage-source-refresh" onClick={onRefresh} disabled={isRefreshing}><RefreshCw size={12} className={isRefreshing ? 'is-spinning' : undefined} aria-hidden /> {isRefreshing ? 'SYNCING' : 'REFRESH'}</button></header>
    {ready ? <>
      <div className="usage-github-identity"><strong>{github?.login ? `GITHUB / ${github.login}` : 'GITHUB'}</strong><span>{github?.name ?? 'Name not reported'}</span></div>
      <div className="usage-github-window"><span className="usage-label">90D ACTIVITY</span><ContributionGrid days={github?.contributions ?? []} /></div>
      <div className="usage-activity-stats"><ActivityStat label="CONTRIBUTIONS" value={github?.totalContributions?.toLocaleString()} /><ActivityStat label="AVG / ACTIVE DAY" value={github?.averageContributionsPerActiveDay?.toFixed(1)} /><ActivityStat label="BEST DAY" value={github?.bestDay?.count.toLocaleString()} detail={github?.bestDay ? formatDay(github.bestDay.date) : undefined} /><ActivityStat label="REPOSITORIES" value={github?.repositories?.toLocaleString()} /></div>
      {github?.state === 'stale' && <p className="usage-instrument-note">{github.diagnosticMessage ?? 'Showing the last successful GitHub activity sync.'}</p>}
    </> : <div className="usage-source-empty"><span className={`usage-status usage-status-${github?.state ?? 'loading'}`}><i />{stateLabel(github?.state ?? 'loading')}</span><p>{github?.diagnosticMessage ?? 'Connect GitHub with gh auth login to load developer activity.'}</p></div>}
  </section>
}

function formatBytes(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let scaled = value
  while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1 }
  return `${scaled.toFixed(index >= 3 ? 1 : 0)} ${units[index]}`
}

function TelemetryMeter({ label, percent, detail }: { label: string; percent?: number; detail?: string }) {
  return <div className="usage-telemetry-meter"><div className="usage-telemetry-meter-head"><span className="usage-label">{label}</span><strong>{percent === undefined ? '—' : `${Math.round(percent)}%`}</strong></div><div className="usage-meter-track"><i style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }} /></div>{detail && <span className="usage-telemetry-detail">{detail}</span>}</div>
}

function SystemTelemetry({ system }: { system?: SystemTelemetrySnapshot }) {
  const memoryPercent = system?.memoryUsedBytes !== undefined && system.memoryTotalBytes ? system.memoryUsedBytes / system.memoryTotalBytes * 100 : undefined
  const diskPercent = system?.diskUsedBytes !== undefined && system.diskTotalBytes ? system.diskUsedBytes / system.diskTotalBytes * 100 : undefined
  return <section className="usage-instrument-section usage-system-instrument" aria-labelledby="usage-system-title">
    <header className="usage-section-head"><div><span className="usage-label">03 / MACHINE</span><h2 id="usage-system-title">System telemetry</h2></div><span className="usage-live-dot"><i /> LIVE SAMPLE</span></header>
    <div className="usage-system-status"><span className={`usage-status usage-status-${system?.state ?? 'unavailable'}`}><i />{system ? stateLabel(system.state) : 'WAITING'}</span><span>{system?.sampledAt ? `SAMPLED ${new Date(system.sampledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'NO SAMPLE'}</span></div>
    <div className="usage-telemetry-list"><TelemetryMeter label="CPU" percent={system?.cpuPercent} /><TelemetryMeter label="MEM" percent={memoryPercent} detail={system?.memoryUsedBytes !== undefined && system.memoryTotalBytes ? `${formatBytes(system.memoryUsedBytes)} / ${formatBytes(system.memoryTotalBytes)}` : undefined} /><TelemetryMeter label="DISK USED" percent={diskPercent} detail={system?.diskUsedBytes !== undefined && system.diskTotalBytes ? `${formatBytes(system.diskUsedBytes)} / ${formatBytes(system.diskTotalBytes)}` : undefined} /></div>
    {system?.diagnosticMessage && <p className="usage-instrument-note">{system.diagnosticMessage}</p>}
  </section>
}

export function UsageInstrument({ snapshots, telemetry, isRefreshing, onRefreshAI, onRefreshGitHub, onRefreshAll }: { snapshots: ProviderUsageSnapshot[]; telemetry?: UsageTelemetrySnapshot; isRefreshing: boolean; onRefreshAI: () => void; onRefreshGitHub: () => void; onRefreshAll: () => void }) {
  const status = useMemo(() => snapshots.some((snapshot) => snapshot.status === 'ready') || telemetry?.system.state === 'ready' ? 'PARTIAL' : telemetry?.system.state === 'unavailable' ? 'WAITING FOR SOURCES' : 'SYNCING', [snapshots, telemetry])
  return <div className="usage-instrument">
    <header className="usage-instrument-header"><div><span className="usage-label">RUNTIME TELEMETRY / LIVE</span><p>Capacity, activity, and machine state from the sources Paralith can verify.</p></div><div className="usage-instrument-actions"><span className="usage-section-meta"><i /> {status}</span><button type="button" className="usage-refresh-all" onClick={onRefreshAll} disabled={isRefreshing}><RefreshCw size={13} className={isRefreshing ? 'is-spinning' : undefined} aria-hidden /> {isRefreshing ? 'REFRESHING' : 'REFRESH ALL'}</button></div></header>
    <div className="usage-instrument-grid"><AIUsagePanel snapshots={snapshots} isRefreshing={isRefreshing} onRefresh={onRefreshAI} /><div className="usage-instrument-side"><DeveloperActivity github={telemetry?.github} onRefresh={onRefreshGitHub} isRefreshing={isRefreshing} /><SystemTelemetry system={telemetry?.system} /></div></div>
  </div>
}
