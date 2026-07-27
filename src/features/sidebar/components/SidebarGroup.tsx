import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useSidebarStore } from '../sidebarStore'

interface SidebarGroupProps {
  /** Stable identity used to persist the open/closed state across sessions. */
  id: string
  label: string
  /** Optional count shown as a pill next to the label; hidden when 0 or undefined. */
  count?: number
  /** Right-aligned header controls (e.g. a "＋ New" button). Clicks never toggle the group. */
  actions?: ReactNode
  /** Collapsed on first run, before the user has expressed a preference for this group. */
  defaultCollapsed?: boolean
  /**
   * Temporarily overrides the persisted collapsed state without writing to it — used while the
   * sidebar filter is active, so a matching row can never hide inside a collapsed group.
   */
  forceExpanded?: boolean
  className?: string
  children: ReactNode
}

/**
 * The one canonical collapsible sidebar section. Every primary region (Workspaces, Swarms, Other
 * Monitors) renders through this so headers, disclosure, spacing, and the persisted open/closed
 * state stay identical. The body is never given its own scroll container — the sidebar has a
 * single scroll region — so groups simply flow and the whole list scrolls.
 *
 * Headers stick to the top of that scroll region: with a long Workspace list the section a row
 * belongs to stays on screen, and the group's own actions stay reachable without scrolling back.
 */
export function SidebarGroup({
  id,
  label,
  count,
  actions,
  defaultCollapsed = false,
  forceExpanded = false,
  className = '',
  children,
}: SidebarGroupProps) {
  const collapsedGroups = useSidebarStore((state) => state.collapsedGroups)
  const setGroupCollapsed = useSidebarStore((state) => state.setGroupCollapsed)
  const persistedCollapsed = id in collapsedGroups ? collapsedGroups[id] : defaultCollapsed
  const collapsed = forceExpanded ? false : persistedCollapsed

  return (
    <section className={`sb-group ${collapsed ? 'is-collapsed' : ''} ${className}`.trim()} aria-label={label}>
      <div className="sb-group-head">
        <button
          type="button"
          className="sb-group-toggle"
          aria-expanded={!collapsed}
          onClick={() => setGroupCollapsed(id, !persistedCollapsed)}
        >
          <ChevronRight size={13} className="sb-group-chevron" aria-hidden />
          <span className="section-label">{label}</span>
          {count != null && count > 0 && <span className="sb-group-count">{count}</span>}
        </button>
        {actions && <div className="sb-group-actions">{actions}</div>}
      </div>
      {!collapsed && <div className="sb-group-body">{children}</div>}
    </section>
  )
}
