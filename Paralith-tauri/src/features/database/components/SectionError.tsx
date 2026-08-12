import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import type { DatabaseLoadState } from '../databaseTypes'

/**
 * The one failure surface every Database Studio section uses.
 *
 * The backend's `AppError` carries a human message *and* a concrete cause (`detail`) plus an error
 * code. Rendering only the message is what turned an id collision during discovery into an
 * unactionable "PARALITH could not access its local database" with nothing to go on. The cause is
 * shown as secondary text — present when there is one, never invented when there is not.
 */
export function SectionError({
  load,
  fallback,
  onRetry,
}: {
  load: DatabaseLoadState
  fallback: string
  onRetry?: () => void
}) {
  return (
    <div className="db-section-error" role="alert">
      <AlertTriangle size={18} />
      <span className="db-section-error-message">{load.errorMessage ?? fallback}</span>
      {load.errorDetail && <span className="db-section-error-detail mono">{load.errorDetail}</span>}
      {load.errorCode && <span className="db-section-error-code mono">{load.errorCode}</span>}
      {onRetry && (
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
