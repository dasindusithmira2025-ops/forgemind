import { CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'

/**
 * A connected empty/placeholder state for surfaces whose data comes from the remote projection.
 * It is not a fake card: it reflects real connection state, offers the real refresh action, and
 * never fabricates rows. Used when a provider account is missing or a projection is genuinely empty.
 */
export function ConnectedPlaceholder({ title, message, onRetry, loading, authHint, inline }: {
  title: string
  message: string
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
        {authHint && <p className="repo-muted">Sign in with the GitHub CLI (<code>gh auth login</code>) or configure a token in Settings to enable this surface.</p>}
      </div>
      {onRetry && !inline && (
        <Button variant="secondary" icon={loading ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />} onClick={onRetry} disabled={loading}>
          {loading ? 'Refreshing' : 'Refresh'}
        </Button>
      )}
    </div>
  )
}
