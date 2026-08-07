import React from 'react';
import { Search, X } from 'lucide-react';
import { agentStateLabel, providerLabel, waitLabel, type AgentActivityState } from './labels';
import type { Pane } from './scenario';
import { Terminal } from './Terminal';

/**
 * The docking canvas and the panes on it.
 *
 * PARALITH's canvas is strictly tiled: panes never overlap, never float over one another, and
 * every pixel of the canvas belongs to exactly one pane. That constraint is the reason the
 * product can show ten agents at once without the window turning into a pile of cards, so the
 * film has to honour it — no scene may fan panes out, overlap them, or drop shadows between
 * them.
 *
 * Sources: features/workspace-canvas/components/{WorkspaceCanvas,TerminalPaneWindow}.tsx and
 * components/terminal/TerminalPane.tsx.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The tilings the film uses, as fractions of the canvas.
 *
 * Written out per pane count rather than derived, because the shapes carry the story: the film
 * opens on one pane and grows to six, and each step has to look like a split of the frame before
 * it — the way it does when the product splits a pane — rather than a fresh arrangement.
 *
 * Every layout stays at two columns. Three columns is legal (a 392px pane clears the product's
 * 280px docked minimum) but at that width the product's own header rules start winning against
 * each other: `.terminal-title strong` shrinks past its 160px cap and the pane's name — the
 * exact string the Fleet Bar cell refers to — disappears behind the working directory. Two
 * columns is the layout a real user lands on for the same reason, and terminal output is wide.
 */
const TILINGS: Record<number, readonly [number, number, number, number][]> = {
  1: [[0, 0, 1, 1]],
  2: [
    [0, 0, 0.5, 1],
    [0.5, 0, 0.5, 1],
  ],
  3: [
    [0, 0, 0.5, 1],
    [0.5, 0, 0.5, 0.5],
    [0.5, 0.5, 0.5, 0.5],
  ],
  4: [
    [0, 0, 0.5, 0.5],
    [0.5, 0, 0.5, 0.5],
    [0, 0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5, 0.5],
  ],
  5: [
    [0, 0, 0.5, 0.5],
    [0.5, 0, 0.5, 1 / 3],
    [0, 0.5, 0.5, 0.5],
    [0.5, 1 / 3, 0.5, 1 / 3],
    [0.5, 2 / 3, 0.5, 1 / 3],
  ],
  6: [
    [0, 0, 0.5, 1 / 3],
    [0.5, 0, 0.5, 1 / 3],
    [0, 1 / 3, 0.5, 1 / 3],
    [0.5, 1 / 3, 0.5, 1 / 3],
    [0, 2 / 3, 0.5, 1 / 3],
    [0.5, 2 / 3, 0.5, 1 / 3],
  ],
};

/** Resolves a tiling to whole pixels. Rounded so adjacent panes share an edge exactly. */
export function tile(count: number, canvas: Rect): Rect[] {
  const spec = TILINGS[count];
  if (!spec) throw new Error(`No tiling defined for ${count} panes.`);
  return spec.map(([x, y, width, height]) => ({
    x: Math.round(canvas.x + x * canvas.width),
    y: Math.round(canvas.y + y * canvas.height),
    width: Math.round(width * canvas.width),
    height: Math.round(height * canvas.height),
  }));
}

/**
 * Interpolates between two tilings so a split reads as the frame dividing rather than as panes
 * being replaced. `t` runs 0 to 1; panes present in both layouts travel, and a pane that only
 * exists in the new layout is handed its own final rect and faded in by the caller.
 */
export function tweenRects(from: Rect | undefined, to: Rect, t: number): Rect {
  if (!from) return to;
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  };
}

export interface PaneViewProps {
  pane: Pane;
  rect: Rect;
  active?: boolean;
  /** Frames since this pane's terminal started streaming. */
  frame: number;
  cadence?: number;
  /** Draws the transcript complete, for scenes that join a session already in progress. */
  complete?: boolean;
  /** Overrides the scenario state, for the beats where a pane changes state on camera. */
  state?: AgentActivityState;
  waitedMs?: number;
  opacity?: number;
  /** Dims a pane without touching its own colours, for the beats that isolate one pane. */
  recede?: number;
  searchOpen?: boolean;
}

/**
 * One pane. `.terminal-pane`'s modifiers do all the work: `.active` paints the accent state edge
 * on the header, and `.agent-needs_input` / `.agent-needs_permission` / `.agent-failed` paint the
 * warning or danger edge — which, in the product's own cascade, outranks focus, because an agent
 * that needs something has to read from across the canvas.
 */
export const PaneView: React.FC<PaneViewProps> = ({
  pane,
  rect,
  active = false,
  frame,
  cadence,
  complete = false,
  state,
  waitedMs,
  opacity = 1,
  recede = 0,
  searchOpen = false,
}) => {
  const agentState = state ?? pane.state;
  const waiting = agentState === 'needs_input' || agentState === 'needs_permission';
  const wait = waitedMs ?? pane.waitedMs;

  const className = [
    'terminal-pane',
    active ? 'active' : '',
    agentState ? `agent-${agentState}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="pane-window"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        opacity,
      }}
    >
      <article className={className}>
        <header className="terminal-header">
          <span className={`terminal-status status-${agentState}`} />
          <div className="terminal-title">
            <strong>{pane.title}</strong>
            <span>
              {providerLabel(pane.provider)}
              {` · ${agentStateLabel(agentState)}`}
            </span>
          </div>
          <span className="terminal-path">{pane.workingDirectory}</span>
          {waiting && wait !== undefined ? (
            <span className={`agent-attention-badge state-${agentStateLabel(agentState)}`}>
              waiting <span className="measured">{waitLabel(wait)}</span>
            </span>
          ) : null}
          <div className="terminal-controls">
            <button className="button button-ghost">
              <Search size={14} />
            </button>
            <button className="button button-ghost">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="xterm-host" style={{ position: 'relative' }}>
          <Terminal
            rows={pane.transcript}
            frame={frame}
            cadence={cadence}
            seed={pane.id.charCodeAt(0) + pane.id.length}
            visibleRows={Math.max(3, Math.floor((rect.height - 36 - 8) / (13 * 1.15)))}
            complete={complete}
            cursor={!waiting}
          />
          {searchOpen ? <TerminalSearch /> : null}
        </div>
      </article>

      {recede > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            // The theme's own canvas colour, so receding a pane cannot introduce a black the
            // product does not contain.
            background: 'var(--canvas)',
            opacity: recede,
          }}
        />
      ) : null}
    </div>
  );
};

const TerminalSearch: React.FC = () => (
  <div className="terminal-search">
    <input readOnly value="idempotency" />
    <button>Aa</button>
  </div>
);

/** `.workspace-canvas` + `.pane-window-layer`. */
export const Canvas: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="workspace-canvas">
    <div className="pane-window-layer">{children}</div>
  </div>
);
