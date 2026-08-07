import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { hold, ramp } from './motion';

/**
 * The film's non-product layers: type, grade, and the plinth the window sits on.
 *
 * The restraint here is deliberate and it is the whole difference between a brand film and a
 * template. There is no glow, no particle field, no gradient sweep, no floating 3D window, no
 * grain plate, no lens flare, no chromatic aberration. PARALITH's own design system spends
 * chroma only on meaning and keeps its chrome achromatic; a film wrapped around that product in
 * neon and bloom would be advertising a different, worse product.
 *
 * What is left is: black, one typeface, one weight relationship, and time.
 */

/** Everything scales off the 1920-wide master, so 4K and social formats stay in proportion. */
export const useScale = () => {
  const { width } = useVideoConfig();
  return width / 1920;
};

export const FILM_FONT = '"Geist", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';

/**
 * A line of copy.
 *
 * Rises 14px as it fades in and holds still. It does not fade *out* by drifting — a line that
 * leaves the way it arrived reads as a slide transition, so copy exits on opacity alone.
 */
export const Line: React.FC<{
  children: React.ReactNode;
  frame: number;
  from: number;
  stay: number;
  rise?: number;
  fall?: number;
  /** 1 is the primary statement; 2 steps down for a second, quieter line. */
  level?: 1 | 2;
  align?: 'left' | 'center';
}> = ({ children, frame, from, stay, rise = 24, fall = 18, level = 1, align = 'left' }) => {
  const k = useScale();
  const opacity = hold(frame, { from, rise, stay, fall });
  // The rise is tied to the entrance only. Reusing the fade for it would drift the line back
  // down as it leaves, which reads as a slide transition rather than as copy being withdrawn.
  const lift = (1 - ramp(frame, from, rise)) * 14;

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${lift * k}px)`,
        fontFamily: FILM_FONT,
        fontSize: (level === 1 ? 54 : 40) * k,
        fontWeight: level === 1 ? 560 : 420,
        letterSpacing: `${-0.021}em`,
        lineHeight: 1.22,
        color: level === 1 ? '#fafafa' : '#a1a1a1',
        textAlign: align,
        textWrap: 'balance',
      }}
    >
      {children}
    </div>
  );
};

export interface LineSpec {
  text: string;
  from: number;
  stay: number;
  level?: 1 | 2;
}

/**
 * The copy block: the lines, and the scrim that makes them readable.
 *
 * Copy sits on the lower-left at a fixed margin so the eye never has to re-find where words
 * appear across a cut. Over a wide shot it lands on empty black and needs nothing; over a
 * pushed-in shot it lands on a terminal full of 13px monospace, where near-white text on
 * near-white text is simply unreadable.
 *
 * The scrim solves that, and it is keyed to the copy rather than always present: it rises and
 * falls with the lines it serves, so the product is never dimmed at a moment when nothing is
 * being said over it. A permanently graded lower third would darken the status bar for the whole
 * film to solve a problem that exists in four shots.
 */
export const Copy: React.FC<{
  frame: number;
  lines: readonly LineSpec[];
  align?: 'left' | 'center';
}> = ({ frame, lines, align = 'left' }) => {
  const k = useScale();

  const veil = lines.reduce(
    (value, line) => Math.max(value, hold(frame, { from: line.from, stay: line.stay })),
    0,
  );

  return (
    <>
      <AbsoluteFill
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.72) 22%, rgba(0,0,0,0) 46%)',
          opacity: veil,
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill
        style={{
          padding: `0 ${120 * k}px ${96 * k}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: align === 'center' ? 'center' : 'flex-start',
          gap: 10 * k,
          pointerEvents: 'none',
        }}
      >
        {lines.map((line) => (
          <Line key={line.text} frame={frame} from={line.from} stay={line.stay} level={line.level} align={align}>
            {line.text}
          </Line>
        ))}
      </AbsoluteFill>
    </>
  );
};

/**
 * The grade: a vignette and a floor.
 *
 * The vignette is very slight — enough to stop a 1440px window of near-black UI from dissolving
 * into a 1920px field of the same near-black, not enough to read as an effect. It sits *under*
 * the product so it never tints the interface, which has to stay colour-accurate.
 */
export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(120% 105% at 50% 42%, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 42%, rgba(0,0,0,0) 72%)',
    }}
  />
);

/**
 * The stage: where the product window sits in the frame, and what makes it read as a window.
 *
 * A real window on a real desktop is a lit object — it has a hairline edge and a soft contact
 * shadow. Without them a near-black interface on a black field has no boundary at all and reads
 * as a full-bleed graphic rather than as software running on a machine.
 *
 * The camera lives here rather than inside the window: this element carries the translation and
 * the clip, and hands the magnification down so the window lays itself out at its native 1440x900
 * and scales as one object. Corner radius, shadow and hairline all scale with it, so a push-in
 * magnifies the window instead of sliding a differently-proportioned window into frame.
 */
export const Stage: React.FC<{
  width: number;
  height: number;
  shot: { scale: number; offset: { x: number; y: number } };
  radius?: number;
  opacity?: number;
  children: React.ReactNode;
}> = ({ width, height, shot, radius = 10, opacity = 1, children }) => {
  const { scale, offset } = shot;
  const edge = Math.max(1, scale);

  return (
    <div
      style={{
        position: 'absolute',
        left: offset.x,
        top: offset.y,
        width: width * scale,
        height: height * scale,
        borderRadius: radius * scale,
        overflow: 'hidden',
        opacity,
        boxShadow: `0 ${40 * scale}px ${110 * scale}px rgba(0,0,0,0.72), 0 ${6 * scale}px ${22 * scale}px rgba(0,0,0,0.5)`,
        outline: `${edge}px solid rgba(255,255,255,0.085)`,
        outlineOffset: -edge,
      }}
    >
      {children}
    </div>
  );
};
