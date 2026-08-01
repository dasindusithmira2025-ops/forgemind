import React from 'react';
import { Img, staticFile } from 'remotion';
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GripVertical,
  MoreVertical,
  PanelRightOpen,
  Search,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { fleetStateLabel, waitLabel, waitPressure, type FleetCellState } from './labels';
import { PROJECT, WORKSPACES } from './scenario';

/**
 * The workspace chrome: title bar, Fleet Bar, sidebar, status bar.
 *
 * Every element below is the markup its counterpart emits in `Paralith-tauri/src`, class for
 * class — `.workspace-heading`, `.fleet-cell[data-pressure]`, `.sb-nav-search`, `.ws-row`,
 * `.app-statusbar`. Nothing is styled here; the generated product stylesheet does all of it. The
 * components are stateless because the film drives state from the timeline rather than from
 * interaction.
 *
 * Sources: components/shell/WorkspaceTitleBar.tsx, features/fleet/FleetBar.tsx,
 * features/sidebar/components/*, screens/WorkspaceScreen.tsx.
 */

/* ---- Title bar --------------------------------------------------------------------------- */

export interface FleetCellData {
  paneId: string;
  title: string;
  state: FleetCellState;
  waitedMs: number;
}

/**
 * `FleetBar.tsx`. The bar's whole argument is in two attributes: `state-*` gives the cell its
 * hue, and `data-pressure` gives the 3px bar its height — 6/9/13/17px across the four wait
 * steps — so the queue still reads for a viewer who cannot separate amber from green.
 */
export const FleetBar: React.FC<{
  cells: readonly FleetCellData[];
  total: number;
  activePaneId?: string;
  /** Cells rendered inline before the rest fold into the queue popover. `INLINE_CELLS` in the product. */
  inlineLimit?: number;
}> = ({ cells, total, activePaneId, inlineLimit = 4 }) => {
  if (total === 0) return <div className="fleet-bar-spacer" />;

  const inline = cells.slice(0, inlineLimit);
  const overflow = cells.length - inline.length;

  return (
    <div className="fleet-bar">
      <div className="fleet-cells">
        {inline.map((cell) => (
          <button
            key={cell.paneId}
            type="button"
            className={`fleet-cell state-${cell.state}${cell.paneId === activePaneId ? ' is-active' : ''}`}
            data-pressure={waitPressure(cell.waitedMs)}
          >
            <span className="fleet-cell-bar" />
            <span className="fleet-cell-title">{cell.title}</span>
            <span className="measured fleet-cell-wait">{waitLabel(cell.waitedMs)}</span>
          </button>
        ))}
      </div>

      <button type="button" className={`fleet-summary${cells.length > 0 ? ' has-attention' : ''}`}>
        {overflow > 0 ? <span className="fleet-summary-overflow measured">+{overflow}</span> : null}
        <span className="measured fleet-summary-count">{total}</span>
        <span className="fleet-summary-label">{total === 1 ? 'agent' : 'agents'}</span>
      </button>
    </div>
  );
};

/** The Fleet Bar's queue popover, opened from the summary control. */
export const FleetQueue: React.FC<{
  cells: readonly FleetCellData[];
  activePaneId?: string;
}> = ({ cells, activePaneId }) => (
  <div className="fleet-queue" role="menu" aria-label="Agent fleet">
    {cells.map((cell) => (
      <button
        key={cell.paneId}
        role="menuitem"
        className={`fleet-queue-row state-${cell.state}${cell.paneId === activePaneId ? ' is-active' : ''}`}
      >
        <span className="fleet-dot" />
        <span className="fleet-queue-title">{cell.title}</span>
        <span className="fleet-queue-state">{fleetStateLabel(cell.state)}</span>
        <span className="measured fleet-queue-wait">
          {cell.state === 'waiting' || cell.state === 'blocked' ? waitLabel(cell.waitedMs) : ''}
        </span>
      </button>
    ))}
  </div>
);

/** `WorkspaceTitleBar.tsx` — heading, Fleet Bar, running count, panel toggle, Workspace menu. */
export const TitleBar: React.FC<{
  workspaceName: string;
  branch?: string;
  fleet: readonly FleetCellData[];
  fleetTotal: number;
  activePaneId?: string;
  running: number;
  paneCount: number;
  queueOpen?: boolean;
}> = ({
  workspaceName,
  branch,
  fleet,
  fleetTotal,
  activePaneId,
  running,
  paneCount,
  queueOpen = false,
}) => (
  <>
    <div className="workspace-heading">
      <strong>{workspaceName}</strong>
      {branch ? <span className="branch-label">{branch}</span> : null}
    </div>

    <FleetBar cells={fleet} total={fleetTotal} activePaneId={activePaneId} />

    <span className="compact-count">
      <span className="measured">
        {running}/{paneCount}
      </span>{' '}
      running
    </span>

    <button className="workspace-tool-panel-toggle" aria-pressed={false}>
      <PanelRightOpen size={15} />
    </button>

    <div className="workspace-menu-wrap">
      <button className="button button-ghost">
        Workspace
        <ChevronDown size={14} />
      </button>
      {queueOpen ? <FleetQueue cells={fleet} activePaneId={activePaneId} /> : null}
    </div>
  </>
);

/* ---- Sidebar ----------------------------------------------------------------------------- */

export type RuntimeStatus = 'active' | 'partially_active' | 'waiting' | 'closed' | 'starting';

export interface WorkspaceRowData {
  id: string;
  name: string;
  panes: number;
  status: RuntimeStatus;
  detail: string;
}

/**
 * `ForgeSpaceSidebar.tsx` and its four fixed bands: nav, list header, one scrolling body, and
 * the toolbar. The rail was deleted from the product; there is nothing to the left of this.
 */
export const Sidebar: React.FC<{
  workspaces?: readonly WorkspaceRowData[];
  activeId: string;
  /** Highlights the search control, for the beat where the Orchestrator is invoked. */
  searchFocused?: boolean;
}> = ({ workspaces, activeId, searchFocused = false }) => {
  const rows: readonly WorkspaceRowData[] =
    workspaces ?? WORKSPACES.map((entry) => ({ ...entry, status: entry.status as RuntimeStatus }));

  return (
    <nav className="forge-sidebar" style={{ width: 264 }}>
      <div className="sb-nav">
        <button
          type="button"
          className="sb-nav-search"
          style={
            searchFocused
              ? { background: 'var(--surface-hover)', borderColor: 'var(--border-strong)', color: 'var(--muted)' }
              : undefined
          }
        >
          <Search size={13} className="sb-nav-search-icon" />
          <span className="sb-nav-search-label">Search</span>
          {searchFocused ? (
            <span className="sb-nav-keys" style={{ display: 'inline-flex' }}>
              <kbd>Ctrl</kbd>
              <kbd>Space</kbd>
            </span>
          ) : null}
        </button>
        <button type="button" className="sb-nav-row">
          <FolderGit2 size={16} className="sb-nav-icon" />
          <span className="sb-nav-label">Repository</span>
        </button>
      </div>

      <div className="sb-list-header">
        <span className="sb-list-title">Projects</span>
        <div className="sb-list-actions">
          <button type="button" className="sb-list-action">
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </div>

      <div className="sidebar-body">
        <div className="sb-group">
          <div className="sb-group-head">
            <button type="button" className="sb-group-toggle">
              <ChevronDown size={13} />
              <span className="section-label">{PROJECT.name}</span>
            </button>
            <span className="sb-group-count">{rows.length}</span>
          </div>

          <ul className="ws-list">
            {rows.map((row) => (
              <WorkspaceRow key={row.id} row={row} active={row.id === activeId} />
            ))}
          </ul>
        </div>

        <div className="sb-group">
          <div className="sb-group-head">
            <button type="button" className="sb-group-toggle">
              <ChevronRight size={13} />
              <span className="section-label">Swarms</span>
            </button>
            <span className="sb-group-count">2</span>
          </div>
        </div>
      </div>

      <div className="sb-toolbar">
        <div className="sb-toolbar-brand">
          <Wordmark />
        </div>
        <div className="sb-toolbar-tools">
          <button type="button" className="sb-toolbar-btn">
            <Settings size={15} />
          </button>
        </div>
      </div>
    </nav>
  );
};

/** `WorkspaceRow.tsx`. The 2px `.ws-row-accent` is the product's one state edge. */
const WorkspaceRow: React.FC<{ row: WorkspaceRowData; active: boolean }> = ({ row, active }) => (
  <li className={`ws-row ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined}>
    <span className="ws-row-accent" />
    <button type="button" className="ws-row-main">
      <span className={`ws-status ws-status-dot ws-status-${row.status}`} role="img" />
      <span className="ws-row-body">
        <span className="ws-row-title-line">
          <strong className="ws-row-name">{row.name}</strong>
          <span className="ws-pane-badge">{row.panes}</span>
        </span>
        <span className="ws-row-secondary">{row.detail}</span>
      </span>
    </button>
    <span className="ws-row-handle">
      <GripVertical size={13} />
    </span>
    <button type="button" className="ws-row-menu">
      <MoreVertical size={15} />
    </button>
  </li>
);

/**
 * The lockup the sidebar toolbar carries, at the product's ratio-locked 92x22.
 *
 * Uses the keyed `wordmark.png` rather than the older `wordmark-alpha.png`, which despite its
 * name still has the logo pack's navy plate baked in — on the sidebar's #171717 surface that
 * plate reads as a visible rectangle around the mark.
 */
const Wordmark: React.FC = () => (
  <div className="brand brand--monochrome">
    <Img
      className="brand-logo"
      src={staticFile('brand/wordmark.png')}
      style={{ width: 92, height: 22, opacity: 0.72 }}
    />
  </div>
);

/* ---- Status bar -------------------------------------------------------------------------- */

/** `WorkspaceScreen.tsx` — the status bar's exact five slots, in order. */
export const StatusBar: React.FC<{
  branch: string;
  projectName: string;
  running: number;
  paneCount: number;
  activePaneTitle: string;
}> = ({ branch, projectName, running, paneCount, activePaneTitle }) => (
  <>
    <span>{branch}</span>
    <span className="status-path">{projectName}</span>
    <span>
      <span className="measured">
        {running}/{paneCount}
      </span>{' '}
      running
    </span>
    <span>{activePaneTitle}</span>
  </>
);
