import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { INK, MONO, RADIUS, SIZE, STATE, TRACK, U, useFrameBox, useScale } from './design';
import { breathe, hold, noise, ramp, snap } from './motion';
import { GATE_X, LINE_Y } from './script';

/**
 * The stage: the rail, the gates, the panels, and the light.
 *
 * Everything a sequence draws sits on this. The two rules the whole film obeys are enforced here
 * rather than by convention — `Rail` puts the travel line at exactly `LINE_Y` in every delivery
 * format, and `World` places design-space coordinates into whatever frame is actually being
 * rendered. A scene never reads `useVideoConfig()` and never knows whether it is in a 4K master or
 * a 9:16 social cut.
 */

/* ---- Coordinate space -------------------------------------------------------------------------- */

/**
 * Places design-space children into the delivered frame.
 *
 * Scale comes from width, and the rail is then recentred vertically so a frame that is taller than
 * 16:9 in design space does not push the horizon to the top. That covers 16:9 at any resolution,
 * which is every format this film is delivered in.
 *
 * It does *not* make the film work in portrait. Scaling a 1,900-wide schematic into a 1080-wide
 * canvas leaves the machine text at seven physical pixels. The recentring below is kept because it
 * is correct and cheap, not because it is sufficient — see the note in `Root.tsx` for why there is
 * no vertical composition registered.
 */
export const World: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const k = useScale();
  const box = useFrameBox();
  /** Portrait frames put the rail at 0.52 of height; landscape keeps its authored position. */
  const target = box.portrait ? box.height * 0.52 : box.height * (LINE_Y / 1080);
  const shift = target - LINE_Y;

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1920 * k,
          height: 1080 * k,
          transform: `translateY(${shift * k}px)`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Absolutely positions a child at design-space coordinates. */
export const At: React.FC<{
  x: number;
  y: number;
  width?: number;
  height?: number;
  opacity?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ x, y, width, height, opacity, style, children }) => {
  const k = useScale();
  return (
    <div
      style={{
        position: 'absolute',
        left: x * k,
        top: y * k,
        width: width === undefined ? undefined : width * k,
        height: height === undefined ? undefined : height * k,
        opacity,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/* ---- The rail ------------------------------------------------------------------------------------ */

/**
 * The travel line.
 *
 * One hairline across the full width at `LINE_Y`, present in every sequence, at the same height, at
 * the same value. It is the film's spine and it is the only element that survives every cut. The
 * brightening toward the centre is not decoration — it is what stops a 1920px hairline from reading
 * as a border on the frame rather than as a track running through it.
 */
export const Rail: React.FC<{ opacity?: number; lit?: number }> = ({ opacity = 1, lit = 0 }) => {
  const k = useScale();
  return (
    <div
      style={{
        position: 'absolute',
        left: -240 * k,
        top: LINE_Y * k,
        width: 2400 * k,
        height: Math.max(1, 1 * k),
        opacity,
        background: `linear-gradient(to right,
          rgba(255,255,255,0) 0%,
          rgba(255,255,255,${0.10 + lit * 0.16}) 14%,
          rgba(255,255,255,${0.16 + lit * 0.3}) 50%,
          rgba(255,255,255,${0.10 + lit * 0.16}) 86%,
          rgba(255,255,255,0) 100%)`,
      }}
    />
  );
};

/**
 * The ties: short vertical marks below the rail at a fixed pitch, drifting left.
 *
 * This is the only element in the film that reports speed. The rail itself is featureless, so
 * without the ties a token sliding along it has nothing to be measured against and the travel reads
 * as a fade rather than as movement. They are 8% white and 9px tall — enough to register
 * peripherally, not enough to count.
 */
export const Ties: React.FC<{ speed?: number; opacity?: number }> = ({ speed = 1, opacity = 1 }) => {
  const frame = useCurrentFrame();
  const k = useScale();
  const pitch = 64;
  const drift = (frame * speed * 1.1) % pitch;
  const marks = [];
  for (let i = -2; i < 34; i++) {
    const x = i * pitch - drift;
    marks.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: x * k,
          top: (LINE_Y + 5) * k,
          width: Math.max(1, 1 * k),
          height: 9 * k,
          background: 'rgba(255,255,255,0.085)',
        }}
      />,
    );
  }
  return <div style={{ opacity }}>{marks}</div>;
};

/* ---- The gate ------------------------------------------------------------------------------------ */

export type GateState = 'closed' | 'open' | 'holding';

/**
 * A gate: two shutters that meet on the rail, and the condition written above them.
 *
 * The mechanics carry the argument, so they are literal. The shutters are opaque and they overlap
 * the rail by a pixel, so a closed gate genuinely occludes the track rather than sitting near it.
 * `open` retracts them vertically — never horizontally, because a shutter that slides aside implies
 * it could slide back, and the film's title is that it cannot.
 *
 * `holding` is the state that only appears at gate two: the shutters stay shut and the seam between
 * them lights amber. It is deliberately not an animation. A gate that is refusing to open should
 * look like nothing is happening, because that is exactly what a failing check feels like.
 */
export const Gate: React.FC<{
  x?: number;
  state: GateState;
  /** Frames since the state was entered, for the open animation. */
  since: number;
  label: string;
  /** The condition, set in mono under the label. */
  condition?: string;
  height?: number;
  opacity?: number;
}> = ({ x = GATE_X, state, since, label, condition, height = 168, opacity = 1 }) => {
  const k = useScale();
  const open = state === 'open' ? snap(since, 0, 26) : 0;
  /**
   * Fully retracted still leaves 13px of shutter at each end, not 1.5px. At the smaller figure the
   * two plates read as stray dashes floating either side of the rail rather than as a mechanism
   * that has opened — the structure has to stay legible for the open state to mean anything.
   */
  const gap = 3 + open * (height - 29);
  const holding = state === 'holding';
  const pulse = holding ? breathe(since, 96, 0.3) : 1;

  const seamColour = holding ? STATE.fail : state === 'open' ? STATE.pass : INK.edge;
  const shutter = (top: number) => (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: top * k,
        width: 14 * k,
        height: (height / 2 - gap / 2) * k,
        background: `linear-gradient(to bottom, ${INK.surfaceLift}, ${INK.surface})`,
        border: `${Math.max(1, k)}px solid ${INK.line}`,
        borderRadius: RADIUS * k,
        boxSizing: 'border-box',
      }}
    />
  );

  return (
    <div style={{ position: 'absolute', left: (x - 7) * k, top: (LINE_Y - height / 2) * k, opacity }}>
      {shutter(0)}
      {shutter(height / 2 + gap / 2)}

      {/* The seam. Sits exactly on the rail and is the one thing that reports the gate's state. */}
      <div
        style={{
          position: 'absolute',
          left: -2 * k,
          top: (height / 2 - 1) * k,
          width: 18 * k,
          height: Math.max(1, 2 * k),
          background: seamColour,
          opacity: (state === 'closed' ? 0.5 : 1) * pulse,
          boxShadow: holding
            ? `0 0 ${16 * k}px ${STATE.fail}, 0 0 ${34 * k}px rgba(251,191,36,0.35)`
            : state === 'open'
              ? `0 0 ${14 * k}px rgba(134,239,172,0.55)`
              : 'none',
        }}
      />

      {/* The condition, written above the mechanism. */}
      <div
        style={{
          position: 'absolute',
          left: -8 * k,
          top: -46 * k,
          whiteSpace: 'nowrap',
          fontFamily: MONO,
          fontSize: SIZE.station * k,
          letterSpacing: TRACK.station,
          textTransform: 'uppercase',
          color: holding ? STATE.fail : state === 'open' ? STATE.pass : INK.muted,
        }}
      >
        {label}
      </div>
      {condition ? (
        <div
          style={{
            position: 'absolute',
            left: -8 * k,
            top: (height + 22) * k,
            whiteSpace: 'nowrap',
            fontFamily: MONO,
            fontSize: SIZE.machineSmall * k,
            letterSpacing: TRACK.machine,
            color: INK.faint,
          }}
        >
          {condition}
        </div>
      ) : null}
    </div>
  );
};

/* ---- The work ------------------------------------------------------------------------------------- */

/**
 * The token: the change itself, as an object on the rail.
 *
 * A 13px square, never a circle and never a dot. It is the only accent-coloured thing in the film
 * and it is the same object from the moment the instruction collapses in sequence one to the moment
 * the repository absorbs it in sequence six — the viewer is following one physical thing for
 * seventy-eight seconds, which is what makes the gates feel like they are happening to something.
 */
export const Token: React.FC<{
  x: number;
  y?: number;
  size?: number;
  tone?: 'accent' | 'pass' | 'fail' | 'idle';
  opacity?: number;
  /** A short trail behind it, proportional to how fast it is travelling. */
  trail?: number;
}> = ({ x, y = LINE_Y, size = 13, tone = 'accent', opacity = 1, trail = 0 }) => {
  const k = useScale();
  const colour =
    tone === 'pass'
      ? STATE.pass
      : tone === 'fail'
        ? STATE.fail
        : tone === 'idle'
          ? INK.muted
          : STATE.accent;

  return (
    <>
      {trail > 0.01 ? (
        <div
          style={{
            position: 'absolute',
            left: (x - trail) * k,
            top: (y - 0.5) * k,
            width: trail * k,
            height: Math.max(1, 1.5 * k),
            background: `linear-gradient(to right, rgba(0,0,0,0), ${colour})`,
            opacity: 0.5 * opacity,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: (x - size / 2) * k,
          top: (y - size / 2) * k,
          width: size * k,
          height: size * k,
          background: colour,
          opacity,
          boxShadow: `0 0 ${18 * k}px ${colour}66`,
        }}
      />
    </>
  );
};

/* ---- Panels ---------------------------------------------------------------------------------------- */

/**
 * A surface plate: the flat container every piece of product detail in the film sits on.
 *
 * Square corners, one hairline border, one flat fill, and a title rule at the top. There is no
 * shadow and no gradient on it. The plates are meant to read as parts of one drawing rather than as
 * cards floating over a background, and a drop shadow is the fastest way to break that.
 */
export const Plate: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  right?: React.ReactNode;
  opacity?: number;
  /** 0 flat, 1 lifted — used to bring the plate the camera is looking at forward. */
  lift?: number;
  children?: React.ReactNode;
}> = ({ x, y, width, height, title, right, opacity = 1, lift = 0, children }) => {
  const k = useScale();
  return (
    <div
      style={{
        position: 'absolute',
        left: x * k,
        top: y * k,
        width: width * k,
        height: height * k,
        opacity,
        background: lift > 0.5 ? INK.surfaceLift : INK.surface,
        border: `${Math.max(1, k)}px solid ${lift > 0.5 ? INK.line : INK.hair}`,
        borderRadius: RADIUS * k,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {title ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            height: 30 * k,
            borderBottom: `${Math.max(1, k)}px solid ${INK.hair}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `0 ${U * k}px`,
            fontFamily: MONO,
            fontSize: SIZE.machineSmall * k,
            letterSpacing: TRACK.station,
            textTransform: 'uppercase',
            color: INK.faint,
          }}
        >
          <span>{title}</span>
          {right}
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: 0, top: (title ? 30 : 0) * k, right: 0, bottom: 0 }}>
        {children}
      </div>
    </div>
  );
};

/** A line of machine text. The film's default voice for anything the product would render itself. */
export const Machine: React.FC<{
  children: React.ReactNode;
  size?: number;
  colour?: string;
  weight?: number;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({ children, size = SIZE.machine, colour = INK.text, weight = 400, opacity, style }) => {
  const k = useScale();
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: size * k,
        fontWeight: weight,
        letterSpacing: TRACK.machine,
        color: colour,
        opacity,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** The small-caps station name that sits above the rail at the head of each sequence. */
export const Station: React.FC<{ index: string; name: string; frame: number; from?: number }> = ({
  index,
  name,
  frame,
  from = 8,
}) => {
  const k = useScale();
  const on = ramp(frame, from, 22);
  // Pinned to the top-left of the frame rather than to the rail. It was authored above the rail
  // and collided with the checks plate in `verification` and the review plate in `consent`, both
  // of which have to reach that high; a slate belongs at the top of the frame anyway.
  return (
    <At x={104} y={86} opacity={on}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 * k }}>
        <Machine size={SIZE.station} colour={INK.ghost} style={{ letterSpacing: TRACK.station }}>
          {index}
        </Machine>
        <div
          style={{
            fontFamily: MONO,
            fontSize: SIZE.station * k,
            letterSpacing: TRACK.station,
            textTransform: 'uppercase',
            color: INK.muted,
            transform: `translateX(${(1 - on) * 10 * k}px)`,
          }}
        >
          {name}
        </div>
      </div>
    </At>
  );
};

/* ---- Light --------------------------------------------------------------------------------------- */

/**
 * The grade.
 *
 * Almost nothing, and that is the intent. One very slow horizontal wash keyed to the direction of
 * travel, so the frame is fractionally brighter ahead of the work than behind it, and a flat
 * elliptical vignette. There is no coloured atmosphere in this film — the earlier cuts tinted their
 * rooms with the mark's gradient, and doing it here would put chroma on the chrome, which is the one
 * rule the design system does not bend.
 */
export const Grade: React.FC<{ intensity?: number }> = ({ intensity = 1 }) => {
  const frame = useCurrentFrame();
  const drift = 44 + Math.sin(frame / 420) * 7;
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(96% 82% at ${drift}% 46%, rgba(255,255,255,${0.028 * intensity}) 0%, rgba(255,255,255,${0.008 * intensity}) 48%, rgba(0,0,0,0) 78%)`,
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(132% 112% at 50% 50%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.34) 78%, rgba(0,0,0,0.7) 100%)',
          pointerEvents: 'none',
        }}
      />
    </>
  );
};

/**
 * Sensor grain.
 *
 * A single static field at 2.2%, not an animated one. Animated grain on flat near-black panels
 * crawls visibly at 60fps and costs a surprising amount of bitrate for the privilege; a static
 * field does the one thing grain is here for, which is to stop the large flat areas of `INK.field`
 * from banding in an 8-bit H.264 encode.
 */
export const Grain: React.FC = () => {
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < 340; i++) {
    const x = noise(`gx${i}`) * 100;
    const y = noise(`gy${i}`) * 100;
    const a = 0.012 + noise(`ga${i}`) * 0.022;
    cells.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: 2,
          height: 2,
          background: `rgba(255,255,255,${a})`,
        }}
      />,
    );
  }
  return <AbsoluteFill style={{ pointerEvents: 'none' }}>{cells}</AbsoluteFill>;
};

/** The film's cursor. Only ever drawn in `consent`, and only ever moved by a person. */
export const Cursor: React.FC<{ x: number; y: number; opacity?: number; pressed?: number }> = ({
  x,
  y,
  opacity = 1,
  pressed = 0,
}) => {
  const k = useScale();
  return (
    <div
      style={{
        position: 'absolute',
        left: x * k,
        top: y * k,
        opacity,
        transform: `scale(${1 - pressed * 0.12})`,
        transformOrigin: 'top left',
      }}
    >
      <svg width={22 * k} height={30 * k} viewBox="0 0 22 30" fill="none">
        <path
          d="M2 1.6 L2 23.4 L7.6 18.1 L11.2 26.6 L14.6 25.2 L11.1 16.9 L18.6 16.5 Z"
          fill="#ffffff"
          stroke="#0a0a0a"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

/** A soft click ring, drawn once when the cursor commits. */
export const Click: React.FC<{ x: number; y: number; since: number }> = ({ x, y, since }) => {
  const k = useScale();
  const t = ramp(since, 0, 30);
  if (since < 0 || t >= 1) return null;
  const r = 8 + t * 46;
  return (
    <div
      style={{
        position: 'absolute',
        left: (x - r) * k,
        top: (y - r) * k,
        width: r * 2 * k,
        height: r * 2 * k,
        borderRadius: '50%',
        border: `${Math.max(1, 1.5 * k)}px solid ${STATE.pass}`,
        opacity: (1 - t) * 0.85,
      }}
    />
  );
};

/** Copy envelope helper shared by the scenes' own captions. */
export const useHold = (frame: number, from: number, stay: number): number =>
  hold(frame, { from, stay });
