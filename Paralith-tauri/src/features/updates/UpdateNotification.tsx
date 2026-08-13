import { AlertTriangle, Download, RotateCcw, ShieldCheck } from 'lucide-react'
import type { SafeRestartAssessment, UpdateDownloadProgress, UpdateStatus } from '../../native/types'
import { requestUpdateNow, updateActionable, useUpdateController } from './updateController'

interface UpdateNotificationViewProps {
  status: UpdateStatus
  progress?: UpdateDownloadProgress
  assessment?: SafeRestartAssessment
  operation?: string
  error?: string
  deferred: boolean
  dismissed: boolean
  onUpdateNow: () => void
  onRetry: () => void
  onLater: () => void
}

const formatBytes = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(0, Math.round(bytes / 1024))} KB`

export function UpdateNotificationView({
  status,
  progress,
  assessment,
  operation,
  error,
  deferred,
  dismissed,
  onUpdateNow,
  onRetry,
  onLater,
}: UpdateNotificationViewProps) {
  const update = status.journal.available
  if (!updateActionable(status) || !update || dismissed) return null

  const received = progress?.received ?? status.journal.downloadReceived
  const total = progress?.total ?? status.journal.downloadTotal
  const percent = total ? Math.min(100, Math.round(received / total * 100)) : undefined
  const downloading = status.journal.phase === 'downloading' || operation === 'downloading'
  const verified = status.journal.phase === 'downloaded' && status.journal.signatureVerified
  const hardBlocked = Boolean(assessment?.hardBlocked)
  const summary = update.releaseNotes.trim().split(/\r?\n/).find(Boolean) || 'Signed update ready for this PARALITH edition.'
  const actionLabel = downloading
    ? `Downloading${percent === undefined ? '…' : ` ${percent}%`}`
    : verified
      ? 'Install & restart'
      : status.journal.phase === 'failed'
        ? 'Retry update'
        : 'Update now'

  return <aside className={`update-toast update-toast-progressive${error || hardBlocked ? ' attention' : ''}`} role="status" aria-label="Update available">
    <div className="update-toast-icon">{error || hardBlocked ? <AlertTriangle size={17} /> : verified ? <ShieldCheck size={17} /> : <Download size={17} />}</div>
    <div className="update-toast-copy">
      <strong>PARALITH {update.version}</strong>
      <span>{summary}</span>
      {downloading && <div className="update-download" aria-label="Update download progress">
        <div className="update-progress"><span style={{ width: percent === undefined ? '20%' : `${percent}%` }} /></div>
        <small>{formatBytes(received)}{total ? ` of ${formatBytes(total)} · ${percent}%` : ' downloaded'}</small>
      </div>}
      {verified && !assessment && <small>Signature verified with PARALITH’s bundled updater key.</small>}
      {assessment && !assessment.safe && <small className={hardBlocked ? 'update-hard-block' : ''}>
        {hardBlocked ? assessment.hardBlockers.join(' ') : assessment.blockers.join(' ')}
      </small>}
      {deferred && !hardBlocked && <small>Update deferred. Your active work was left running.</small>}
      {error && <small className="update-hard-block">{error}</small>}
    </div>
    <div className="update-toast-actions">
      <button
        className="button button-primary"
        disabled={Boolean(operation) || hardBlocked}
        onClick={status.journal.phase === 'failed' ? onRetry : onUpdateNow}
      >
        {status.journal.phase === 'failed' && !operation ? <RotateCcw size={13} /> : null}
        {operation === 'installing' ? 'Preparing restart…' : actionLabel}
      </button>
      <button onClick={onLater}>Later</button>
      <a href="#/settings?section=updates">Details</a>
    </div>
  </aside>
}

export function UpdateNotification() {
  const {
    status,
    progress,
    assessment,
    operation,
    error,
    deferred,
    dismissedVersion,
    updateNow,
    retry,
    dismiss,
  } = useUpdateController()
  if (!status) return null
  return <UpdateNotificationView
    status={status}
    progress={progress}
    assessment={assessment}
    operation={operation}
    error={error}
    deferred={deferred}
    dismissed={dismissedVersion === status.journal.available?.version}
    onUpdateNow={() => void requestUpdateNow(updateNow)}
    onRetry={() => void retry()}
    onLater={dismiss}
  />
}
