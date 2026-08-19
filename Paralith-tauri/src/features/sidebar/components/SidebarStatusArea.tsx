import type { CSSProperties } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  Download,
  FolderGit2,
  BrainCircuit,
  PanelLeftClose,
  RotateCw,
  Settings,
} from 'lucide-react'
import { requestUpdateNow, updateActionable, useUpdateController } from '../../updates/updateController'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions } from '../sidebarTypes'

/**
 * The pinned bottom band: the destinations that are not Workspaces, and — below them, as its own
 * footer action — the update state.
 *
 * The update action is the *durable* half of the update surface. The toast announces a new build
 * once and can be dismissed; this stays for as long as the build is actually available, reading
 * the same controller — so a dismissed toast no longer means the update disappears until restart.
 * It renders nothing at all when there is nothing to install: a permanently disabled "Update Now"
 * would be exactly the kind of dead control this sidebar is meant to be free of.
 */
export function SidebarStatusArea({ actions }: { actions: SidebarActions }) {
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)

  return (
    <div className="sb-status">
      <div className="sb-status-tools">
        {actions.onOpenRepository && (
          <button
            type="button"
            className="sb-status-btn"
            aria-label="Repository"
            title="Repository"
            onClick={actions.onOpenRepository}
          >
            <FolderGit2 size={15} />
          </button>
        )}
        {actions.onOpenDatabase && (
          <button
            type="button"
            className="sb-status-btn"
            aria-label="Database"
            title="Database"
            onClick={actions.onOpenDatabase}
          >
            <Database size={15} />
          </button>
        )}
        {actions.onOpenMemory && (
          <button
            type="button"
            className="sb-status-btn"
            aria-label="Memory"
            title="Memory"
            onClick={actions.onOpenMemory}
          >
            <BrainCircuit size={15} />
          </button>
        )}
        {actions.onOpenUsage && (
          <button
            type="button"
            className="sb-status-btn"
            aria-label="Usage"
            title="Usage"
            onClick={actions.onOpenUsage}
          >
            <BarChart3 size={15} />
          </button>
        )}
        <span className="sb-status-gap" />
        <button
          type="button"
          className="sb-status-btn"
          aria-label="Diagnostics"
          title="Diagnostics"
          onClick={() => setDiagnostics(true)}
        >
          <Activity size={15} />
        </button>
        <button
          type="button"
          className="sb-status-btn"
          aria-label="Settings"
          title="Settings"
          onClick={actions.onOpenSettings}
        >
          <Settings size={15} />
        </button>
        <button
          type="button"
          className="sb-status-btn"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={actions.onToggleCollapse}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
      <UpdateAction />
    </div>
  )
}

/**
 * The one reading of the updater state that both the expanded capsule and the collapsed rail
 * render from, so the two can never disagree about the phase or about how the install is invoked.
 * Returns `undefined` whenever there is nothing installable.
 */
function useUpdateAction() {
  const status = useUpdateController((state) => state.status)
  const operation = useUpdateController((state) => state.operation)
  const updateNow = useUpdateController((state) => state.updateNow)
  const retry = useUpdateController((state) => state.retry)

  if (!updateActionable(status) || !status) return undefined
  const journal = status.journal
  const version = journal.available?.version
  const percent = journal.downloadTotal
    ? Math.min(100, Math.round((journal.downloadReceived / journal.downloadTotal) * 100))
    : undefined
  const downloading = journal.phase === 'downloading' || operation === 'downloading'
  const failed = journal.phase === 'failed'
  const installing = operation === 'installing'
  const ready = journal.phase === 'downloaded' && journal.signatureVerified

  return {
    failed,
    percent: downloading ? percent : undefined,
    label: downloading
      ? `Downloading…${percent === undefined ? '' : ` ${percent}%`}`
      : installing
        ? 'Installing…'
        : ready
          ? 'Restart to Update'
          : failed
            ? 'Update Failed'
            : 'Update Now',
    Icon: failed ? AlertTriangle : ready ? RotateCw : Download,
    // Disabled while a download or install is in flight, whether this renderer started it or the
    // backend reported one — re-entering `updateNow` there would queue a second download of the
    // build that is already arriving.
    busy: Boolean(operation) || downloading,
    // Detail belongs in the tooltip; the capsule itself carries no version and no error text.
    title: failed
      ? journal.error || 'The update could not be installed. Select to retry.'
      : `Install PARALITH ${version ?? ''}`.trim(),
    run: () => void (failed ? retry() : requestUpdateNow(updateNow)),
  }
}

/**
 * The footer capsule: prominence from a bright edge and a soft neutral bloom against a near-black
 * interior, not from a colour fill — it must read as an exceptional application-level state
 * without outranking the Workspace the user is choosing.
 */
function UpdateAction() {
  const update = useUpdateAction()
  if (!update) return null
  const { Icon } = update

  return (
    <button
      type="button"
      className={`sb-update ${update.failed ? 'is-failed' : ''}`}
      // A real percentage or nothing: the fill tracks `downloadReceived`, it never animates on its own.
      style={update.percent === undefined ? undefined : ({ '--update-progress': `${update.percent}%` } as CSSProperties)}
      disabled={update.busy}
      title={update.title}
      onClick={update.run}
    >
      <Icon size={14} aria-hidden />
      <span className="sb-update-label">{update.label}</span>
    </button>
  )
}

/** The collapsed rail's stand-in: same flow, same controller, one icon wide. */
export function CollapsedUpdateAction() {
  const update = useUpdateAction()
  if (!update) return null
  const { Icon } = update

  return (
    <button
      type="button"
      className={`collapsed-update ${update.failed ? 'is-failed' : ''}`}
      disabled={update.busy}
      aria-label={`Update PARALITH — ${update.label}`}
      title={`Update PARALITH · ${update.title}`}
      onClick={update.run}
    >
      <Icon size={16} aria-hidden />
      <span className="collapsed-update-dot" aria-hidden />
    </button>
  )
}
