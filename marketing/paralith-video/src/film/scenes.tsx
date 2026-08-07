import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { WINDOW } from '../product/ProductWindow';
import { Workspace, canvasOrigin, CHROME } from '../product/Workspace';
import { LATE_WAIT } from '../product/scenario';
import { Copy, Stage, useScale } from './Layers';
import { EASE, EASE_CAMERA, between, contain, ramp, shotOn, track, type Shot } from './motion';
import { CLOSE, LINES } from './script';

/**
 * The eight beats.
 *
 * Every product frame in this file is the same `Workspace` component — the twin — under a
 * different camera and a different point in its own timeline. No scene draws its own version of
 * the interface, mocks up a panel that does not exist, or arranges panes in a way the docking
 * canvas could not produce. When the film pushes in, it is pushing in on the same DOM.
 */

/** The pane order the canvas holds for most of the film. */
const SIX = ['checkout', 'retries', 'schema', 'flakes', 'client', 'dev'] as const;

/**
 * Where the window sits when the whole thing is in frame.
 *
 * Centred horizontally, but lifted 34px off centre vertically. The copy lives in the lower left,
 * and a window centred in the frame puts its status bar exactly where the first line of type
 * wants to be — the lift buys the copy a band of its own without shrinking the product.
 */
const useWideShot = (): Shot => {
  const { width, height } = useVideoConfig();
  const k = useScale();
  const scale = k * 0.95;
  return {
    scale,
    offset: {
      x: (width - WINDOW.width * scale) / 2,
      y: (height - WINDOW.height * scale) / 2 - 30 * k,
    },
  };
};

const useFrameSize = () => {
  const { width, height } = useVideoConfig();
  return { width, height };
};

/* ---- 1. handoff ---------------------------------------------------------------------------
 * One agent, working, alone, in a window that holds nothing else. The film starts quiet and
 * slightly too dark, because the point of the next ninety seconds is that this is the state
 * everyone thinks they are still in.
 */
export const Handoff: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  /**
   * Opens close on the transcript and pulls back over the whole beat to reveal the window it is
   * in. A single pane fills the entire canvas, so a wide first frame would be one small block of
   * text in a large empty rectangle — the pull-back gives the beat somewhere to go and lets the
   * viewer read the agent's work before being told what they are looking at.
   */
  const tight = shotOn(
    { x: canvasOrigin(true).x + 430, y: CHROME.header + 190 },
    wide.scale * 1.95,
    size,
  );
  const shot = contain(between(tight, wide, ramp(frame, 20, 430, EASE_CAMERA)), WINDOW, size);
  const lift = interpolate(frame, [0, 90], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot} opacity={lift * 0.96}>
        <Workspace
          paneIds={['checkout']}
          activePaneId="checkout"
          // The session is already underway when the film joins it — the agent did not start
          // working because a camera arrived.
          frame={frame + 430}
          cadence={26}
          scale={shot.scale}
        />
      </Stage>
      <Copy frame={frame} lines={[{ text: LINES.handoff[0], from: 96, stay: 250 }]} />
    </AbsoluteFill>
  );
};

/* ---- 2. multiply --------------------------------------------------------------------------
 * The frame divides: 1 -> 2 -> 4 -> 6. Each step is a real tiling of the docking canvas, and the
 * panes that already existed travel to their new rects rather than being replaced, which is what
 * the product does when you split a pane.
 */
export const Multiply: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();

  const STEPS = [
    { at: 0, panes: SIX.slice(0, 1) },
    { at: 70, panes: SIX.slice(0, 2) },
    { at: 190, panes: SIX.slice(0, 4) },
    { at: 320, panes: SIX.slice(0, 6) },
  ] as const;

  const index = STEPS.reduce((found, step, i) => (frame >= step.at ? i : found), 0);
  const step = STEPS[index];
  const previous = index > 0 ? STEPS[index - 1] : undefined;
  const split = previous ? ramp(frame, step.at, 34, EASE) : 1;

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={wide}>
        <Workspace
          paneIds={step.panes}
          from={previous?.panes}
          splitProgress={split}
          activePaneId="checkout"
          frame={frame + 480}
          cadence={22}
          scale={wide.scale}
        />
      </Stage>
      <Copy frame={frame} lines={[{ text: LINES.multiply[0], from: 352, stay: 230 }]} />
    </AbsoluteFill>
  );
};

/* ---- 3. silence ---------------------------------------------------------------------------
 * The turn. Five panes keep streaming; one stops. Nothing in the interface announces it, which
 * is the entire problem — the film holds on the fleet with no Fleet Bar for eleven long seconds
 * and lets the viewer fail to spot it, exactly as they would at their desk.
 */
export const Silence: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  // The retries pane stops at 0:19 in story time and its timer runs from there.
  const waited = Math.max(0, (frame - 40) / 60) * 1000 * 26 + 24_000;

  // Late in the beat the camera drifts toward the pane that stopped — found, not pointed at.
  const target = shotOn(
    { x: canvasOrigin(true).x + (WINDOW.width - CHROME.sidebar) * 0.75, y: CHROME.header + 150 },
    wide.scale * 1.9,
    size,
  );
  const push = ramp(frame, 430, 250, EASE_CAMERA);
  const shot = contain(between(wide, target, push), WINDOW, size);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <Workspace
          paneIds={SIX}
          activePaneId="checkout"
          overrides={[{ id: 'retries', state: 'needs_permission', waitedMs: waited }]}
          frame={frame + 1140}
          cadence={22}
          scale={shot.scale}
        />
      </Stage>
      <Copy
        frame={frame}
        lines={[
          { text: LINES.silence[0], from: 70, stay: 190 },
          { text: LINES.silence[1], from: 330, stay: 300 },
        ]}
      />
    </AbsoluteFill>
  );
};

/* ---- 4. reveal ----------------------------------------------------------------------------
 * The mark. Black, one object, no motion but a settle. The wordmark is wiped in from the left
 * rather than faded, because a geometric wordmark drawn this thin dissolves into grey when it
 * crosses 50% opacity.
 */
export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  const markIn = ramp(frame, 40, 80, EASE);
  const settle = interpolate(markIn, [0, 1], [1.07, 1]);
  const wipe = ramp(frame, 120, 70, EASE);
  const out = 1 - ramp(frame, 430, 80);

  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', opacity: out }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 44 * k }}>
        <Img
          src={staticFile('brand/mark.png')}
          style={{
            width: 150 * k,
            opacity: markIn,
            transform: `scale(${settle})`,
          }}
        />
        <div style={{ overflow: 'hidden', width: 470 * k * wipe }}>
          <Img src={staticFile('brand/wordmark.png')} style={{ width: 470 * k, maxWidth: 'none' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---- 5. command ---------------------------------------------------------------------------
 * The answer. The Fleet Bar is already there — this beat pushes into the title bar so it can be
 * read, then pulls back out to the whole window with the waiting pane focused.
 */
export const Command: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  const waited = 11 * 60_000 + 24_000 + Math.max(0, frame - 0) * 16;

  // In on the Fleet Bar, hold, then back out to the fleet with the pane selected.
  const bar = shotOn({ x: 470, y: CHROME.header / 2 }, wide.scale * 1.95, size);
  const shot = contain(between(bar, wide, ramp(frame, 300, 230, EASE_CAMERA)), WINDOW, size);

  // The click lands at 300; from there the waiting pane is the active pane.
  const focused = frame >= 300;

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <Workspace
          paneIds={SIX}
          activePaneId={focused ? 'retries' : 'checkout'}
          overrides={[{ id: 'retries', state: 'needs_permission', waitedMs: waited }]}
          frame={frame + 1860}
          cadence={22}
          scale={shot.scale}
        />
      </Stage>
      <Copy
        frame={frame}
        lines={[
          { text: LINES.command[0], from: 40, stay: 180 },
          { text: LINES.command[1], from: 250, stay: 300, level: 2 },
        ]}
      />
    </AbsoluteFill>
  );
};

/* ---- 6. evidence --------------------------------------------------------------------------
 * What the fleet actually did. The Repository view's working tree, with the product's own
 * per-file agent attribution — the tag that turns six parallel agents from a risk into a record.
 */
export const Evidence: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  const list = shotOn({ x: CHROME.sidebar + 190, y: 420 }, wide.scale * 1.72, size);
  const shot = contain(between(wide, list, ramp(frame, 60, 260, EASE_CAMERA)), WINDOW, size);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <RepositoryWindow scale={shot.scale} frame={frame} />
      </Stage>
      <Copy frame={frame} lines={[{ text: LINES.evidence[0], from: 80, stay: 330 }]} />
    </AbsoluteFill>
  );
};

/* ---- 7. authority -------------------------------------------------------------------------
 * The decision. The diff walks, the commit message types, and the human is the last step. This
 * is the only beat in the film where the product waits for the person rather than the reverse.
 */
export const Authority: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  const diff = shotOn({ x: CHROME.sidebar + 720, y: 430 }, wide.scale * 1.62, size);
  const shot = contain(between(diff, wide, ramp(frame, 380, 220, EASE_CAMERA)), WINDOW, size);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <RepositoryWindow
          scale={shot.scale}
          frame={frame + 540}
          diffRevealed={Math.floor(track(frame, [20, 260], [0, 12]))}
          commitTyped={Math.floor(track(frame, [250, 400], [0, 64]))}
        />
      </Stage>
      <Copy frame={frame} lines={[{ text: LINES.authority[0], from: 300, stay: 230 }]} />
    </AbsoluteFill>
  );
};

/* ---- 8. close -----------------------------------------------------------------------------
 * The lockup, held. The tagline is the brand's own artwork rather than retypeset in Geist, so
 * the last frame of the film is the logo pack's primary lockup exactly as it is specified.
 */
export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  const rise = ramp(frame, 30, 90, EASE);
  const url = ramp(frame, 250, 60, EASE);
  const out = 1 - ramp(frame, 630, 90);

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: 64 * k,
        opacity: out,
      }}
    >
      <Img
        src={staticFile('brand/lockup.png')}
        style={{
          width: 880 * k,
          opacity: rise,
          transform: `scale(${interpolate(rise, [0, 1], [1.035, 1])})`,
        }}
      />
      <div
        style={{
          opacity: url,
          fontFamily: '"Geist", system-ui, sans-serif',
          fontSize: 21 * k,
          letterSpacing: '0.19em',
          textTransform: 'uppercase',
          color: '#737373',
        }}
      >
        {CLOSE.url}
      </div>
    </AbsoluteFill>
  );
};

/* ---- shared ------------------------------------------------------------------------------- */

/**
 * The window showing the Repository view. Same shell, same sidebar, same status bar — only the
 * canvas holds the Changes section instead of the pane layer, which is exactly how the route
 * behaves in the product.
 */
const RepositoryWindow: React.FC<{
  scale: number;
  frame: number;
  diffRevealed?: number;
  commitTyped?: number;
}> = ({ scale, frame, diffRevealed, commitTyped }) => (
  <Workspace
    paneIds={SIX}
    activePaneId="retries"
    overrides={[{ id: LATE_WAIT.paneId, state: LATE_WAIT.state, waitedMs: LATE_WAIT.waitedMs }]}
    frame={frame}
    complete
    scale={scale}
    repository={{ diffRevealed, commitTyped }}
  />
);
