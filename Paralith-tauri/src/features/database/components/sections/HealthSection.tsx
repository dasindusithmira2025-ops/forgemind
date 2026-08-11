import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'
import { StatusBadge, type BadgeTone } from '../StatusBadge'
import type { DatabaseIssueSeverity } from '../../databaseTypes'

const SEVERITY_TONE: Record<DatabaseIssueSeverity, BadgeTone> = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'neutral',
}

export function HealthSection() {
  const load = useDatabaseStore((state) => state.issuesLoad)
  const issues = useDatabaseStore((state) => state.issues)
  const loadIssues = useDatabaseStore((state) => state.loadIssues)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)

  useEffect(() => {
    if (load.status === 'idle' && activeSourceId) void loadIssues()
  }, [load.status, activeSourceId, loadIssues])

  if (load.status === 'loading' && issues.length === 0) {
    return <div className="code-explorer-skeleton">{Array.from({ length: 6 }).map((_, index) => <span key={index} />)}</div>
  }

  if (load.status === 'error') {
    return (
      <div className="db-section-error">
        <AlertTriangle size={18} />
        <span>{load.errorMessage ?? 'Failed to load health issues.'}</span>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void loadIssues()}>Retry</Button>
      </div>
    )
  }

  if (issues.length === 0) {
    return (
      <div className="db-health-empty success">
        <CheckCircle2 size={22} />
        <span>No issues detected.</span>
      </div>
    )
  }

  return (
    <ul className="db-inspector-list db-health-list">
      {issues.map((issue) => (
        <li key={issue.id}>
          <StatusBadge tone={SEVERITY_TONE[issue.severity]} icon={<ShieldCheck size={12} />}>{issue.severity}</StatusBadge>
          <div>
            <strong>{issue.title}</strong>
            <p>{issue.explanation}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
