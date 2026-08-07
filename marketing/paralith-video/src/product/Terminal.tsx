import React from 'react';
import { PARALITH_TERMINAL } from './generated/theme';
import type { Row, ToneKey } from './scenario';

/**
 * The terminal surface, drawn frame by frame.
 *
 * The application runs xterm.js over a real PTY. A film cannot, so this draws the same rows in
 * the same cell metrics and the same palette: `TERMINAL_FONT`, `FONT_SIZE` and `LINE_HEIGHT`
 * below are PARALITH's shipped defaults from `src-tauri/src/models/settings.rs`, and every
 * colour resolves through `PARALITH_TERMINAL`, which is generated from the theme the product
 * hands to xterm at startup. Nothing here picks a colour.
 */

/** `AppSettings::default()` — terminal_font_family / _size / _line_height. */
const TERMINAL_FONT = 'Cascadia Mono, Consolas, monospace';
const FONT_SIZE = 13;
const LINE_HEIGHT = 1.15;

const TONE: Record<ToneKey, string> = {
  fg: PARALITH_TERMINAL.foreground,
  dim: PARALITH_TERMINAL.brightBlack,
  bright: PARALITH_TERMINAL.brightWhite,
  green: PARALITH_TERMINAL.green,
  yellow: PARALITH_TERMINAL.yellow,
  red: PARALITH_TERMINAL.red,
  blue: PARALITH_TERMINAL.blue,
  magenta: PARALITH_TERMINAL.magenta,
  cyan: PARALITH_TERMINAL.cyan,
};

/**
 * Deterministic jitter. Agent output does not arrive on a metronome — a tool call lands, then
 * nothing for a beat, then three result lines at once — and a perfectly even cadence is one of
 * the things that makes reconstructed UI look synthetic. Seeded so every render of a given frame
 * produces the same terminal, which Remotion requires.
 */
const jitter = (index: number, seed: number): number => {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * When each row lands, in frames from the pane's start.
 *
 * Blank rows arrive with the row above them rather than consuming a beat of their own, so the
 * gaps in a transcript read as spacing rather than as the agent pausing.
 */
export function rowSchedule(rows: readonly Row[], cadence: number, seed: number): number[] {
  const schedule: number[] = [];
  let cursor = 0;
  rows.forEach((row, index) => {
    schedule.push(cursor);
    const blank = row.length === 1 && row[0].text === '';
    cursor += blank ? 1 : Math.round(cadence * (0.55 + jitter(index, seed) * 1.35));
  });
  return schedule;
}

export interface TerminalProps {
  rows: readonly Row[];
  /** Frames elapsed since this terminal started streaming. */
  frame: number;
  /** Average frames between rows. Lower reads as a faster agent. */
  cadence?: number;
  seed?: number;
  /**
   * Rows to keep on screen. The surface is bottom-anchored like a real terminal, so once the
   * transcript is longer than the pane the oldest rows scroll off the top.
   */
  visibleRows?: number;
  /** Draws the block cursor after the last visible row. */
  cursor?: boolean;
  /** Holds the transcript complete, ignoring `frame`. Used by scenes that open mid-session. */
  complete?: boolean;
}

export const Terminal: React.FC<TerminalProps> = ({
  rows,
  frame,
  cadence = 16,
  seed = 1,
  visibleRows,
  cursor = true,
  complete = false,
}) => {
  const schedule = React.useMemo(() => rowSchedule(rows, cadence, seed), [rows, cadence, seed]);

  const revealed = complete ? rows.length : schedule.filter((at) => at <= frame).length;
  const shown = rows.slice(0, revealed);

  // A terminal fills downward from the top of an empty viewport and only starts scrolling once
  // the buffer is taller than the pane. Anchoring to the bottom from the first row would leave a
  // blank band above the output, which is the one thing a terminal never does.
  const overflowing = visibleRows !== undefined && shown.length > visibleRows;
  const window = overflowing ? shown.slice(shown.length - visibleRows!) : shown;

  // The row that has only just landed types in, so the eye catches movement even in a pane the
  // camera is not on. Older rows are settled and fully drawn.
  const lastAt = schedule[revealed - 1] ?? 0;
  const typing = complete ? 1 : Math.min(1, Math.max(0, (frame - lastAt) / 5));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: overflowing ? 'flex-end' : 'flex-start',
        overflow: 'hidden',
        fontFamily: TERMINAL_FONT,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        color: PARALITH_TERMINAL.foreground,
        whiteSpace: 'pre',
      }}
    >
      {window.map((row, index) => {
        const last = index === window.length - 1;
        return (
          <div key={`${index}-${row[0]?.text ?? ''}`} style={{ minHeight: FONT_SIZE * LINE_HEIGHT }}>
            {row.map((span, spanIndex) => {
              const text =
                last && typing < 1
                  ? span.text.slice(0, Math.ceil(span.text.length * typing))
                  : span.text;
              return (
                <span key={spanIndex} style={{ color: TONE[span.tone ?? 'fg'] }}>
                  {text}
                </span>
              );
            })}
            {last && cursor ? <Cursor /> : null}
          </div>
        );
      })}
    </div>
  );
};

/**
 * xterm's block cursor in the theme's cursor colour. It does not blink: at 60fps a blinking
 * cursor either strobes or lands mid-phase on a still, and neither helps the film.
 */
const Cursor: React.FC = () => (
  <span
    style={{
      display: 'inline-block',
      width: FONT_SIZE * 0.6,
      height: FONT_SIZE * 1.02,
      marginLeft: 1,
      verticalAlign: 'text-bottom',
      background: PARALITH_TERMINAL.cursor,
      opacity: 0.85,
    }}
  />
);
