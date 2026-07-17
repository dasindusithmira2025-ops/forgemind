import { CircleDot, Download, RefreshCw, ShieldAlert, Tag } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime, remoteCategoryStatus } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { ConnectedPlaceholder } from './ConnectedPlaceholder'

export function IssuesSection() {
  const issues = useRepositoryStore((state) => state.remoteViews.issues)
  const meta = useRemoteMeta('issue')
  if (meta.failed && issues.length === 0) return <Diagnostic title="Issues synchronization failed" meta={meta} />
  if (meta.healthy && issues.length === 0) return <ConnectedPlaceholder title="No GitHub issues" message="This repository has no issues in the selected open and closed scope. Pull requests are synchronized separately and are not counted as issues." detail={meta.detail} onRetry={meta.refreshRemote} loading={meta.remoteLoading} />
  return <div className="repo-remote-surface"><RemoteHeader title="Issues" subtitle={`${issues.filter((issue) => issue.state === 'open').length} open · ${issues.filter((issue) => issue.state === 'closed').length} closed`} {...meta} />{meta.failed && <StaleWarning meta={meta} />}<ul className="repo-simple-list">{issues.map((issue) => <li key={issue.number}><CircleDot size={13} className={issue.state === 'open' ? 'run-pending' : 'run-success'} /><span className="repo-simple-title"><strong>{issue.title}</strong><small>#{issue.number} · {issue.author} · {issue.comments} comments · {relativeTime(issue.updatedAt)}</small></span><span className="repo-row-tags">{issue.labels.map((label) => <span key={label} className="repo-tag">{label}</span>)}</span><StatusBadge tone={issue.state === 'open' ? 'accent' : 'neutral'}>{issue.state}</StatusBadge></li>)}</ul></div>
}

export function ReleasesSection() {
  const releases = useRepositoryStore((state) => state.remoteViews.releases)
  const meta = useRemoteMeta('release')
  if (meta.failed && releases.length === 0) return <Diagnostic title="Release synchronization failed" meta={meta} />
  if (meta.healthy && releases.length === 0) return <ConnectedPlaceholder title="No releases published" message="GitHub returned no draft, prerelease or published releases for this repository." detail={meta.detail} onRetry={meta.refreshRemote} loading={meta.remoteLoading} />
  return <div className="repo-remote-surface"><RemoteHeader title="Releases" subtitle={`${releases.length} synchronized`} {...meta} />{meta.failed && <StaleWarning meta={meta} />}<ul className="repo-release-list">{releases.map((release) => <li key={release.tag}><header><Tag size={14} /><div><strong>{release.name}</strong><code>{release.tag}</code></div><div>{release.draft && <StatusBadge tone="neutral">draft</StatusBadge>}{release.prerelease && <StatusBadge tone="warning">prerelease</StatusBadge>}{!release.draft && !release.prerelease && <StatusBadge tone="success">published</StatusBadge>}</div></header><div className="repo-release-meta"><span>Target {release.target || 'default branch'}</span><span>By {release.author}</span><span>{relativeTime(release.publishedAt)}</span></div>{release.body && <p>{release.body}</p>}<div className="repo-release-assets"><strong>Assets</strong>{release.assets.length === 0 ? <span className="repo-muted">No attached assets</span> : release.assets.map((asset) => <span key={asset.id}><Download size={12} />{asset.name}<small>{formatBytes(asset.size)} · {asset.downloadCount} downloads</small></span>)}</div></li>)}</ul></div>
}

export function SecuritySection() {
  const alerts = useRepositoryStore((state) => state.remoteViews.securityAlerts)
  const meta = useRemoteMeta('dependabot_alert', 'code_scanning_alert', 'secret_scanning_alert', 'ruleset')
  const projection = useRepositoryStore((state) => state.remoteProjection)
  const categories = [
    ['Dependabot', remoteCategoryStatus(projection, 'dependabot_alert')],
    ['Code scanning', remoteCategoryStatus(projection, 'code_scanning_alert')],
    ['Secret scanning', remoteCategoryStatus(projection, 'secret_scanning_alert')],
    ['Rulesets & protection', remoteCategoryStatus(projection, 'ruleset')],
  ] as const
  return <div className="repo-remote-surface"><RemoteHeader title="Security" subtitle={`${alerts.filter((alert) => alert.state === 'open').length} open alerts`} {...meta} /><div className="repo-security-capabilities">{categories.map(([label, status]) => <div key={label}><strong>{label}</strong><StatusBadge tone={!status ? 'neutral' : status.status === 'healthy' ? 'success' : status.errorCode === 'github_permission_missing' ? 'warning' : 'danger'}>{!status ? 'not synchronized' : status.status === 'healthy' ? 'available' : status.errorCode === 'github_permission_missing' ? 'permission required' : status.status}</StatusBadge><small>{status?.errorMessage ?? (status?.lastSuccessfulSync ? `Synced ${relativeTime(status.lastSuccessfulSync)}` : 'Awaiting provider refresh')}</small></div>)}</div>{alerts.length === 0 && categories.every(([, status]) => status?.status === 'healthy') ? <ConnectedPlaceholder inline title="No open provider alerts" message="GitHub successfully returned no Dependabot, code-scanning or secret-scanning alerts." /> : <ul className="repo-simple-list">{alerts.map((alert) => <li key={alert.id}><ShieldAlert size={13} className={alert.severity === 'critical' || alert.severity === 'high' ? 'run-failure' : 'run-pending'} /><span className="repo-simple-title"><strong>{alert.summary}</strong><small>{alert.kind.replaceAll('_', ' ')} · {relativeTime(alert.updatedAt)}</small></span><StatusBadge tone={severityTone(alert.severity)}>{alert.severity}</StatusBadge><StatusBadge tone={alert.state === 'open' ? 'danger' : 'neutral'}>{alert.state}</StatusBadge></li>)}</ul>}</div>
}

function RemoteHeader({ title, subtitle, refreshRemote, remoteLoading, detail }: { title: string; subtitle: string; refreshRemote: () => void; remoteLoading: boolean; detail?: string; failed?: boolean; healthy?: boolean }) { return <header className="repo-content-header"><div><strong>{title}</strong><span>{subtitle}{detail ? ` · ${detail}` : ''}</span></div><Button variant="secondary" icon={<RefreshCw size={13} />} onClick={refreshRemote} disabled={remoteLoading}>{remoteLoading ? 'Refreshing' : 'Refresh'}</Button></header> }
function Diagnostic({ title, meta }: { title: string; meta: ReturnType<typeof useRemoteMeta> }) { return <ConnectedPlaceholder title={title} message={meta.message ?? 'GitHub did not return this data category.'} detail={meta.detail} onRetry={meta.refreshRemote} loading={meta.remoteLoading} authHint={!meta.providerStatus?.authenticated} /> }
function StaleWarning({ meta }: { meta: ReturnType<typeof useRemoteMeta> }) { return <div className="repo-sync-warning"><strong>Cached data may be stale.</strong><span>{meta.message} {meta.recoveryAction}</span></div> }
function useRemoteMeta(...categories: string[]) {
  const remoteLoading = useRepositoryStore((state) => state.remoteLoading)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)
  const projection = useRepositoryStore((state) => state.remoteProjection)
  const refresh = useRepositoryStore((state) => state.refreshRemote)
  const statuses = categories.map((category) => remoteCategoryStatus(projection, category)).filter(Boolean)
  const problem = statuses.find((status) => status?.status !== 'healthy')
  const healthy = statuses.length > 0 && statuses.every((status) => status?.status === 'healthy')
  const detail = problem ? [problem.requiredPermission && `Permission: ${problem.requiredPermission}`, problem.lastSuccessfulSync && `Last success ${relativeTime(problem.lastSuccessfulSync)}`, problem.recoveryAction].filter(Boolean).join(' · ') : projection?.lastSuccessfulSync ? `Synced ${relativeTime(projection.lastSuccessfulSync)}` : undefined
  return { remoteLoading, providerStatus, refreshRemote: () => void refresh(), failed: Boolean(problem), healthy, message: problem?.errorMessage, recoveryAction: problem?.recoveryAction, detail }
}
function severityTone(severity: string): BadgeTone { return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'accent' }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB` }
