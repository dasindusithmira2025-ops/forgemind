import { AlertTriangle } from 'lucide-react'
import { runtimeStatusLabel } from '../sidebarSelectors'
import type { WorkspaceRuntimeStatus } from '../sidebarTypes'

/**
 * A small, non-color-only runtime indicator. Every state carries an accessible label and a
 * distinct shape/animation so it is legible without color. Active Workspaces are not
 * continuously animated; only transient states (starting/stopping) spin.
 */
export function WorkspaceRuntimeIndicator({
  status,
  className = '',
}: {
  status: WorkspaceRuntimeStatus
  className?: string
}) {
  const label = runtimeStatusLabel(status)
  if (status === 'attention' || status === 'failed') {
    return (
      <span className={`ws-status ws-status-${status} ${className}`} role="img" aria-label={label} title={label}>
        <AlertTriangle size={12} aria-hidden />
      </span>
    )
  }
  return (
    <span
      className={`ws-status ws-status-dot ws-status-${status} ${className}`}
      role="img"
      aria-label={label}
      title={label}
    />
  )
}
