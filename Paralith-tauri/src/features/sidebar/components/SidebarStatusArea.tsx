import type { CSSProperties } from 'react'
import { AlertTriangle, Download, PanelLeftClose, RotateCw } from 'lucide-react'
import { useWorkspacePanelStore } from '../../code-surface/workspacePanelStore'
import { requestUpdateNow, updateActionable, useUpdateController } from '../../updates/updateController'
import { destinationTitle, sidebarDestinations, sidebarUtilities } from '../sidebarDestinations'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions } from '../sidebarTypes'

/**
 * The pinned bottom band: the destinations that are not Workspaces, the application utilities
 * beneath them, and — as its own footer action — the update state.
 *
 * The destinations are named, not guessed. They were previously nine identical 16px glyphs packed
 * into one strip, so every one of them cost a hover-and-wait to identify and the project *places you
 * can go* were indistinguishable from the three *things the app does*. They are now a labelled
 * grid (which reflows to one column on a narrow sidebar) over a quieter utility row, with the
 * keyboard route in each tooltip. Colour is stable per destination rather than appearing only on
 * hover, so it reads as identity instead of decoration — and never as the only cue, since every
 * tile carries its name.
 *
 * The update action is the *durable* half of the update surface. The toast announces a new build
 * once and can be dismissed; this stays for as long as the build is actually available, reading
 * the same controller — so a dismissed toast no longer means the update disappears until restart.
 * It renders nothing at all when there is nothing to install: a permanently disabled "Update Now"
 * would be exactly the kind of dead control this sidebar is meant to be free of.
 */
export function SidebarStatusArea({ actions }: { actions: SidebarActions }) {
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)
  // Source Control is the one destination that is a panel rather than a screen, so it is the one
  // that can be *currently open* while this sidebar is still on screen. Read from the panel store
  // it actually toggles, so the tile can never claim a state the panel disagrees with.
  const panelOpen = useWorkspacePanelStore((state) => state.open)
  const activeSurface = useWorkspacePanelStore((state) => state.activeSurface)
  const sourceControlOpen = panelOpen && activeSurface === 'diff'

  return (
    <div className="sb-status">
      <nav className="sb-dest" aria-label="Project tools">
        {sidebarDestinations(actions).map((destination) => {
          const { id, label, Icon, run } = destination
          const active = id === 'source' && sourceControlOpen
          return (
            <button
              key={id}
              type="button"
              className="sb-dest-btn"
              data-surface={id}
              data-active={active ? 'true' : undefined}
              aria-current={active ? 'page' : undefined}
              title={destinationTitle(destination)}
              onClick={run}
            >
              <Icon size={15} aria-hidden />
              <span className="sb-dest-label">{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sb-utils">
        {sidebarUtilities(actions, () => setDiagnostics(true)).map((utility) => {
          const { id, label, Icon, run } = utility
          return (
            <button
              key={id}
              type="button"
              className="sb-util-btn"
              aria-label={label}
              title={destinationTitle(utility)}
              onClick={run}
            >
              <Icon size={15} aria-hidden />
            </button>
          )
        })}
        <button
          type="button"
          className="sb-util-btn sb-util-end"
          aria-label="Collapse sidebar"
          title="Collapse sidebar — show the icon rail · Ctrl+B"
          onClick={actions.onToggleCollapse}
        >
          <PanelLeftClose size={15} aria-hidden />
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
