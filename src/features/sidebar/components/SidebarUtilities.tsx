import { Activity, PanelLeftClose, Settings } from 'lucide-react'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions } from '../sidebarTypes'

/** Bottom utility rows: Settings, Diagnostics, and the Collapse control. */
export function SidebarUtilities({ actions }: { actions: SidebarActions }) {
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)
  return (
    <div className="sidebar-utilities">
      <button type="button" className="sidebar-util" onClick={actions.onOpenSettings}>
        <Settings size={16} />
        <span>Settings</span>
      </button>
      <button type="button" className="sidebar-util" onClick={() => setDiagnostics(true)}>
        <Activity size={16} />
        <span>Diagnostics</span>
      </button>
      <button type="button" className="sidebar-util sidebar-collapse-row" onClick={actions.onToggleCollapse}>
        <PanelLeftClose size={16} />
        <span>Collapse</span>
      </button>
    </div>
  )
}
