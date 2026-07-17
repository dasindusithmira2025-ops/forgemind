import { CircleDot, ShieldAlert, Tag } from 'lucide-react'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { ConnectedPlaceholder } from './ConnectedPlaceholder'

export function IssuesSection() {
  const issues = useRepositoryStore((state) => state.remoteViews.issues)
  const { remoteLoading, remoteError, providerStatus, refreshRemote } = useRemoteMeta()
  if (issues.length === 0) return <ConnectedPlaceholder title="Issues" message={remoteError ?? 'No issues in the current projection. Issues sync from the connected provider.'} onRetry={refreshRemote} loading={remoteLoading} authHint={!providerStatus?.authenticated} />
  return (
    <ul className="repo-simple-list">
      {issues.map((issue) => (
        <li key={issue.number}>
          <CircleDot size={13} className={issue.state === 'open' ? 'run-pending' : 'run-success'} />
          <span className="repo-simple-title">{issue.title}</span>
          <span className="repo-muted">#{issue.number} · {issue.author} · {relativeTime(issue.updatedAt)}</span>
          {issue.labels.map((label) => <span key={label} className="repo-tag">{label}</span>)}
          <StatusBadge tone={issue.state === 'open' ? 'accent' : 'neutral'}>{issue.state}</StatusBadge>
        </li>
      ))}
    </ul>
  )
}

export function ReleasesSection() {
  const releases = useRepositoryStore((state) => state.remoteViews.releases)
  const { remoteLoading, remoteError, providerStatus, refreshRemote } = useRemoteMeta()
  if (releases.length === 0) return <ConnectedPlaceholder title="Releases" message={remoteError ?? 'No releases in the current projection. Publish a tag to create one.'} onRetry={refreshRemote} loading={remoteLoading} authHint={!providerStatus?.authenticated} />
  return (
    <ul className="repo-simple-list">
      {releases.map((release) => (
        <li key={release.tag}>
          <Tag size={13} />
          <span className="repo-simple-title">{release.name}</span>
          <code>{release.tag}</code>
          <span className="repo-muted">{release.author} · {relativeTime(release.publishedAt)}</span>
          {release.draft && <StatusBadge tone="neutral">draft</StatusBadge>}
          {release.prerelease && <StatusBadge tone="warning">pre-release</StatusBadge>}
        </li>
      ))}
    </ul>
  )
}

export function SecuritySection() {
  const alerts = useRepositoryStore((state) => state.remoteViews.securityAlerts)
  const { remoteLoading, remoteError, providerStatus, refreshRemote } = useRemoteMeta()
  if (alerts.length === 0) return <ConnectedPlaceholder title="Security" message={remoteError ?? 'No open security alerts in the current projection. Secret-scanning and dependency alerts sync from the provider.'} onRetry={refreshRemote} loading={remoteLoading} authHint={!providerStatus?.authenticated} />
  return (
    <ul className="repo-simple-list">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <ShieldAlert size={13} className={alert.severity === 'critical' || alert.severity === 'high' ? 'run-failure' : 'run-pending'} />
          <span className="repo-simple-title">{alert.summary}</span>
          <span className="repo-muted">{alert.kind.replaceAll('_', ' ')} · {relativeTime(alert.updatedAt)}</span>
          <StatusBadge tone={severityTone(alert.severity)}>{alert.severity}</StatusBadge>
          <StatusBadge tone={alert.state === 'open' ? 'danger' : 'neutral'}>{alert.state}</StatusBadge>
        </li>
      ))}
    </ul>
  )
}

function useRemoteMeta() {
  const remoteLoading = useRepositoryStore((state) => state.remoteLoading)
  const remoteError = useRepositoryStore((state) => state.remoteError)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)
  const refreshRemote = useRepositoryStore((state) => state.refreshRemote)
  return { remoteLoading, remoteError, providerStatus, refreshRemote: () => void refreshRemote() }
}

function severityTone(severity: string): BadgeTone {
  return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'accent'
}
