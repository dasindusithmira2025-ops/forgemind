import { PanelLeftClose } from 'lucide-react'
import { Brand } from '../../../components/ui/Brand'
import type { SidebarActions } from '../sidebarTypes'

/**
 * Brand header: the wordmark plus the one Collapse control, in the top-right position users
 * expect it.
 *
 * The logo used to open a menu whose four entries all existed elsewhere — Project launcher and
 * Open project folder now live in the one Project surface ([[ProjectPopover]]), Settings and
 * Diagnostics in the footer rail. A menu that only duplicates reachable controls costs a click
 * to discover and teaches nothing, so the mark is now just a mark.
 */
export function SidebarBrandHeader({ actions }: { actions: SidebarActions }) {
  return (
    <header className="sidebar-brand">
      <Brand mono />
      <button
        type="button"
        className="sidebar-collapse-btn"
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
        onClick={actions.onToggleCollapse}
      >
        <PanelLeftClose size={16} />
      </button>
    </header>
  )
}
