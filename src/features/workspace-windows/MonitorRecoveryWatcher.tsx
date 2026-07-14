import { useCallback, useEffect, useState } from 'react'
import { MonitorSmartphone, X } from 'lucide-react'
import { native } from '../../native/commands'
import type { MonitorInfo, ReconnectOffer } from '../../native/types'
import { monitorLabel } from './placementSelectors'
import { buildRecoveryNotice } from './recoverySelectors'

/**
 * Live monitor-disconnect recovery, mounted in the MAIN window only. It polls the Rust
 * recovery sweep (which moves any Workspace window stranded by a removed monitor onto the
 * primary work area — terminals and preferred monitor preserved) and also re-runs on window
 * focus, since a monitor is usually plugged/unplugged while ForgeMind is in the background.
 *
 * When a preferred monitor reconnects it renders a "Move workspace back" offer. The heavy
 * lifting is in Rust; this component is a thin, self-contained banner so WorkspaceScreen stays
 * focused on the active Workspace.
 */
export function MonitorRecoveryWatcher({
  monitors,
  onChanged,
  pollMs = 5000,
}: {
  monitors: MonitorInfo[]
  onChanged: () => void
  pollMs?: number
}) {
  const [message, setMessage] = useState<string>()
  const [offers, setOffers] = useState<ReconnectOffer[]>([])

  useEffect(() => {
    let live = true
    const sweep = async () => {
      try {
        const report = await native.recoverWorkspaceWindows()
        if (!live) return
        const notice = buildRecoveryNotice(report)
        if (notice.recoveredMessage) {
          setMessage(notice.recoveredMessage)
          onChanged()
        }
        setOffers(notice.offers)
      } catch {
        /* recovery is best-effort; never surface a hard error for a background poll */
      }
    }
    void sweep()
    const timer = window.setInterval(() => void sweep(), pollMs)
    window.addEventListener('focus', sweep)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener('focus', sweep)
    }
  }, [onChanged, pollMs])

  const moveBack = useCallback(
    async (offer: ReconnectOffer) => {
      try {
        await native.moveWorkspaceToMonitor(offer.workspaceId, offer.monitorId)
        onChanged()
      } catch {
        /* the monitor may have vanished again between poll and click */
      } finally {
        setOffers((current) => current.filter((item) => item.workspaceId !== offer.workspaceId))
      }
    },
    [onChanged],
  )

  if (!message && offers.length === 0) return null

  return (
    <div className="monitor-recovery-banner" role="status">
      {message && (
        <span className="recovery-message">
          <MonitorSmartphone size={13} /> {message}
          <button type="button" aria-label="Dismiss" onClick={() => setMessage(undefined)}>
            <X size={12} />
          </button>
        </span>
      )}
      {offers.map((offer) => {
        const monitor = monitors.find((item) => item.id === offer.monitorId)
        const name = monitor ? monitorLabel(monitor) : offer.monitorAlias || 'its preferred monitor'
        return (
          <span key={offer.workspaceId} className="recovery-offer">
            A preferred monitor reconnected.
            <button type="button" onClick={() => void moveBack(offer)}>
              Move workspace back to {name}
            </button>
          </span>
        )
      })}
    </div>
  )
}
