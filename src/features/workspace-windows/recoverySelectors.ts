import type { MonitorRecoveryReport, ReconnectOffer } from '../../native/types'

/**
 * The user-facing outcome of a monitor-recovery sweep, derived purely so it can be unit-tested
 * without a GUI. `recoveredMessage` explains any windows that were rescued onto the primary
 * display; `offers` are the Workspaces whose preferred monitor has reconnected and can be sent
 * back home.
 */
export interface RecoveryNotice {
  recoveredMessage?: string
  offers: ReconnectOffer[]
}

export function buildRecoveryNotice(report: MonitorRecoveryReport): RecoveryNotice {
  const count = report.recovered.length
  const recoveredMessage =
    count > 0
      ? `${count} workspace window${count === 1 ? '' : 's'} moved to the primary display because a monitor disconnected. Terminals kept running.`
      : undefined
  return { recoveredMessage, offers: report.reconnectable }
}
