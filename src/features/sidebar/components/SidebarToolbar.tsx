import { Activity, Crosshair, PanelLeftClose, Settings } from 'lucide-react'
import { Brand } from '../../../components/ui/Brand'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions } from '../sidebarTypes'

/**
 * The pinned bottom bar: identity on the left, tools on the right.
 *
 * It absorbed both the old brand header and the old footer icon rail. Those cost two horizontal
 * bands — one at each end of the sidebar — to show a wordmark and three buttons, and the header
 * band sat directly above the list, pushing the rows people actually use further down. Collapsing
 * them into one bar returns that height to the list, and puts the app's least-used controls at
 * the furthest point from where the eye starts.
 */
export function SidebarToolbar({
  actions,
  onScrollToActive,
}: {
  actions: SidebarActions
  /** Scrolls the focused Workspace back into view; omitted when nothing is focused. */
  onScrollToActive?: () => void
}) {
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)

  return (
    <div className="sb-toolbar">
      {/* Identity only, deliberately not a control. `Brand` renders a <div>, which is flow content
          and invalid inside a <button>'s phrasing-content model — and the Project launcher this
          used to open is already reachable from the one Project popover, so making it a control
          also reintroduced exactly the second entry point this sidebar was rebuilt to remove. */}
      <div className="sb-toolbar-brand">
        <Brand mono />
      </div>

      <div className="sb-toolbar-tools">
        {onScrollToActive && (
          <button
            type="button"
            className="sb-toolbar-btn"
            aria-label="Scroll to current Workspace"
            title="Scroll to current Workspace"
            onClick={onScrollToActive}
          >
            <Crosshair size={15} />
          </button>
        )}
        <button
          type="button"
          className="sb-toolbar-btn"
          aria-label="Diagnostics"
          title="Diagnostics"
          onClick={() => setDiagnostics(true)}
        >
          <Activity size={15} />
        </button>
        <button
          type="button"
          className="sb-toolbar-btn"
          aria-label="Settings"
          title="Settings"
          onClick={actions.onOpenSettings}
        >
          <Settings size={15} />
        </button>
        <button
          type="button"
          className="sb-toolbar-btn"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={actions.onToggleCollapse}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>
    </div>
  )
}
