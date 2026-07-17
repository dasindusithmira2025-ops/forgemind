import { CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'

/**
 * A connected empty/placeholder state for surfaces whose data comes from the remote projection.
 * It is not a fake card: it reflects real connection state, offers the real refresh action, and
 * never fabricates rows. Used when a provider account is missing or a projection is genuinely empty.
 */
export function ConnectedPlaceholder({ title, message, detail, onRetry, loading, authHint, inline }: {
  title: string
  message: string
  detail?: string
  onRetry?: () => void
  loading?: boolean
  authHint?: boolean
  inline?: boolean
}) {
  return (
    <div className={`repo-placeholder ${inline ? 'inline' : ''}`} role="status">
      <div className="repo-placeholder-icon">{loading ? <Loader2 size={inline ? 15 : 22} className="is-spinning" /> : <CloudOff size={inline ? 15 : 22} />}</div>
      <div className="repo-placeholder-body">
        <strong>{title}</strong>
        <p>{message}</p>
        {detail && <p className="repo-placeholder-detail">{detail}</p>}
        {authHint && <p className="repo-muted">Reconnect the GitHub provider account or run <code>gh auth login</code>. Credentials remain in the operating-system credential store and are never sent to the renderer.</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" icon={loading ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />} onClick={onRetry} disabled={loading}>
          {loading ? 'Refreshing' : 'Refresh'}
        </Button>
      )}
    </div>
  )
}
