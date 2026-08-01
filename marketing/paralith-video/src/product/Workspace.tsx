import React from 'react';
import { AppShell, ProductWindow, WINDOW } from './ProductWindow';
import { Canvas, PaneView, tile, tweenRects, type Rect } from './Canvas';
import {
  Sidebar,
  StatusBar,
  TitleBar,
  type FleetCellData,
  type RuntimeStatus,
  type WorkspaceRowData,
} from './Shell';
import { fleetStateOf, type AgentActivityState } from './labels';
import { CHANGES, PROJECT, REVIEW_HUNK, WORKSPACES, paneById } from './scenario';
import { RepositoryChanges, type ChangeRow } from './Repository';

/**
 * The assembled workspace: the view almost every product beat in the film is a crop of.
 *
 * The canvas size is derived, not measured — `--header-height` is 40 and `--status-height` is 26
 * at `--ui-scale: 1` in the product's standard density, and the sidebar is 264 — so a scene can
 * work out where a pane will land and push the camera to it without reading the DOM, which
 * Remotion cannot do reliably mid-render anyway.
 */

export const CHROME = { header: 40, status: 26, sidebar: 264 } as const;

/**
 * The working tree, derived from the same `CHANGES` the transcripts produced, so the file that a
 * pane is seen editing is the file the Repository view later attributes to it. One file is
 * attributed to "you" — the product distinguishes agent-owned changes from local ones, and a
 * working tree in which the human has touched nothing would be a fiction.
 */
const CHANGE_ROWS: ChangeRow[] = CHANGES.map((change, index) => ({
  path: change.path,
  glyph: change.status,
  kind: change.status === 'A' ? 'untracked' : index < 4 ? 'staged' : 'changed',
  statusWord: change.status === 'A' ? 'added' : 'modified',
  agent: index === 5 ? undefined : ['Checkout API', 'Checkout API', 'Checkout API', 'Payment retries', 'Schema migration'][index],
}));

const DIFF_ROWS = REVIEW_HUNK.map((row, index) => {
  const text = row.map((span) => span.text).join('');
  const kind = text.startsWith('@@')
    ? ('hunk' as const)
    : text.startsWith('+')
      ? ('add' as const)
      : text.startsWith('-')
        ? ('del' as const)
        : ('context' as const);
  return { kind, line: 118 + index, text: text.replace(/^[+-]/, '') };
});

const COMMIT_MESSAGE = 'checkout: make session reservation idempotent via the ledger';

/**
 * The canvas in its *own* coordinates. Panes are absolutely positioned inside
 * `.pane-window-layer`, which already sits below the title bar and to the right of the sidebar,
 * so pane rects start at 0,0 — offsetting them by the chrome again would push the whole tiling
 * off the bottom-right of the window.
 */
export const canvasSize = (sidebar: boolean): Rect => ({
  x: 0,
  y: 0,
  width: WINDOW.width - (sidebar ? CHROME.sidebar : 0),
  height: WINDOW.height - CHROME.header - CHROME.status,
});

/** The same rect in window coordinates, for scenes aiming the camera at a pane. */
export const canvasOrigin = (sidebar: boolean) => ({
  x: sidebar ? CHROME.sidebar : 0,
  y: CHROME.header,
});

export interface PaneState {
  id: string;
  state?: AgentActivityState;
  waitedMs?: number;
}

export interface WorkspaceViewProps {
  /** Pane ids on the canvas, in tiling order. */
  paneIds: readonly string[];
  /** The previous tiling, and how far the transition has run. Drives the split animation. */
  from?: readonly string[];
  splitProgress?: number;
  /** Per-pane state overrides for the beats where an agent changes state on camera. */
  overrides?: readonly PaneState[];
  activePaneId?: string;
  /** Frames since the session started streaming. */
  frame: number;
  cadence?: number;
  complete?: boolean;
  /** Fades individual panes back so one pane can carry a beat. Keyed by pane id, 0 to 1. */
  recede?: Record<string, number>;
  showSidebar?: boolean;
  queueOpen?: boolean;
  searchFocused?: boolean;
  workspaceName?: string;
  /**
   * Swaps the canvas for the Repository view's Changes section. The title bar, sidebar and status
   * bar are unchanged, because in the product this is a route inside the same shell rather than a
   * different window — the fleet keeps running while you review it.
   */
  repository?: { diffRevealed?: number; commitTyped?: number };
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  paneIds,
  from,
  splitProgress = 1,
  overrides = [],
  activePaneId,
  frame,
  cadence,
  complete = false,
  recede = {},
  showSidebar = true,
  queueOpen = false,
  searchFocused = false,
  workspaceName = 'checkout-rewrite',
  repository,
}) => {
  const canvas = canvasSize(showSidebar);
  const rects = tile(paneIds.length, canvas);
  const previous = from ? tile(from.length, canvas) : undefined;

  const stateOf = (id: string): AgentActivityState =>
    overrides.find((entry) => entry.id === id)?.state ?? paneById(id).state;
  const waitOf = (id: string): number | undefined =>
    overrides.find((entry) => entry.id === id)?.waitedMs ?? paneById(id).waitedMs;

  /** The Fleet Bar shows only what needs a human, longest wait first — `attentionCells`. */
  const fleet: FleetCellData[] = paneIds
    .map((id) => ({ id, state: stateOf(id), waited: waitOf(id) ?? 0 }))
    .filter((entry) => entry.state === 'needs_input' || entry.state === 'needs_permission' || entry.state === 'failed')
    .sort((a, b) => b.waited - a.waited)
    .map((entry) => ({
      paneId: entry.id,
      title: paneById(entry.id).title,
      state: fleetStateOf(entry.state),
      waitedMs: entry.waited,
    }));

  const running = paneIds.filter((id) => stateOf(id) !== 'failed').length;
  const activeTitle = activePaneId ? paneById(activePaneId).title : 'No active pane';

  /**
   * The open Workspace's own row reports the same thing the Fleet Bar and the status bar do — its
   * real pane count, its real runtime, and, when an agent is waiting, `waiting` rather than
   * `active`. A signal in this product is never allowed to exist in only one place, and a film
   * whose sidebar claims six panes over a canvas holding one would be caught in a single frame.
   */
  const sidebarRows: WorkspaceRowData[] = WORKSPACES.map((entry, index) => {
    if (index !== 0) return { ...entry, status: entry.status as RuntimeStatus };
    return {
      ...entry,
      panes: paneIds.length,
      status: (fleet.length > 0 ? 'waiting' : 'active') as RuntimeStatus,
      detail:
        fleet.length > 0 ? `${fleet.length} waiting · ${running} running` : `${running} running`,
    };
  });

  return (
    <AppShell
      titleBar={
        <TitleBar
          workspaceName={workspaceName}
          branch={PROJECT.branch}
          fleet={fleet}
          fleetTotal={paneIds.length}
          activePaneId={activePaneId}
          running={running}
          paneCount={paneIds.length}
          queueOpen={queueOpen}
        />
      }
      sidebar={
        showSidebar ? (
          <Sidebar activeId={WORKSPACES[0].id} searchFocused={searchFocused} workspaces={sidebarRows} />
        ) : undefined
      }
      canvas={
        repository ? (
          <RepositoryChanges
            files={CHANGE_ROWS}
            selectedPath="services/checkout/reserve.ts"
            diff={DIFF_ROWS}
            diffRevealed={repository.diffRevealed}
            commitMessage={COMMIT_MESSAGE}
            commitTyped={repository.commitTyped}
            stagedCount={4}
          />
        ) : (
          <Canvas>
            {paneIds.map((id, index) => {
            const target = rects[index];
            const previousIndex = from?.indexOf(id) ?? -1;
            const source = previousIndex >= 0 ? previous?.[previousIndex] : undefined;
            const rect = tweenRects(source, target, splitProgress);
            // A pane that did not exist in the previous tiling fades in as its slot opens.
            const entering = from ? previousIndex < 0 : false;
            return (
              <PaneView
                key={id}
                pane={paneById(id)}
                rect={rect}
                active={id === activePaneId}
                state={stateOf(id)}
                waitedMs={waitOf(id)}
                frame={frame}
                cadence={cadence}
                complete={complete}
                opacity={entering ? Math.max(0, (splitProgress - 0.35) / 0.65) : 1}
                recede={recede[id] ?? 0}
              />
              );
            })}
          </Canvas>
        )
      }
      statusBar={
        <StatusBar
          branch={PROJECT.branch}
          projectName={PROJECT.name}
          running={running}
          paneCount={paneIds.length}
          activePaneTitle={activeTitle}
        />
      }
    />
  );
};

/** The whole window at a given magnification. Scenes place it with `Stage`. */
export const Workspace: React.FC<WorkspaceViewProps & { scale?: number; style?: React.CSSProperties }> = ({
  scale,
  style,
  ...view
}) => (
  <ProductWindow scale={scale} style={style}>
    <WorkspaceView {...view} />
  </ProductWindow>
);
