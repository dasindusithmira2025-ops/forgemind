import React from 'react';
import './generated/paralith-ui.css';
import './twin.css';
import { PARALITH_DARK_VARS } from './generated/theme';

/**
 * The PARALITH window, at native size.
 *
 * `WINDOW` is the product's own default window size from `src-tauri/tauri.conf.json`. The window
 * is always laid out at exactly those logical pixels and then scaled as a whole, rather than
 * being rebuilt larger for a bigger canvas. That is the difference between a twin and an
 * illustration: at any output resolution the ratio of a 13px terminal row to a 36px pane header
 * to a 264px sidebar is the ratio a user sees, and no scene can quietly widen a column to make a
 * composition work.
 *
 * Scaling a DOM subtree does not soften it — the browser rasterises after the transform — so the
 * 4K master draws this same 1440x900 layout at full 4K sharpness.
 */
export const WINDOW = { width: 1440, height: 900 } as const;

export interface ProductWindowProps {
  /**
   * Magnification. The window always lays out at 1440x900 and is scaled as a whole; where it
   * sits in the frame is the `Stage`'s business, not the window's.
   */
  scale?: number;
  /** Overrides applied on top of the generated theme. Scenes use this to dim the whole surface. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export const ProductWindow: React.FC<ProductWindowProps> = ({ scale = 1, style, children }) => (
  <div
    className="paralith-window"
    style={{
      ...(PARALITH_DARK_VARS as React.CSSProperties),
      width: WINDOW.width,
      height: WINDOW.height,
      transform: `scale(${scale})`,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * The application frame: title bar, sidebar, canvas, status bar — the real `AppShell` grid from
 * `src/components/shell/AppShell.tsx`, with the same class names, so `.app-shell`'s
 * `grid-template-rows: var(--header-height) 1fr var(--status-height)` is the product's own.
 */
export const AppShell: React.FC<{
  titleBar: React.ReactNode;
  sidebar?: React.ReactNode;
  canvas: React.ReactNode;
  statusBar?: React.ReactNode;
  className?: string;
}> = ({ titleBar, sidebar, canvas, statusBar, className = '' }) => (
  <main className={`app-shell workspace-shell ${className}`}>
    <header className="app-titlebar">{titleBar}</header>
    <div className="app-workarea">
      {sidebar}
      <section className="app-canvas">{canvas}</section>
    </div>
    {statusBar ? <footer className="app-statusbar">{statusBar}</footer> : null}
  </main>
);
