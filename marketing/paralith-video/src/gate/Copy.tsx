import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import {
  DISPLAY,
  INK,
  LEADING,
  SIZE,
  TRACK,
  WEIGHT,
  useCopyScale,
  useFrameBox,
  useScale,
} from './design';
import { hold, ramp } from './motion';
import { LINE_Y, type BeatId, LINES } from './script';

/**
 * The film's copy layer.
 *
 * Two modes, and the difference between them is not styling — it is where the words are allowed to
 * be. `cinematic` sets the statements as display type on the frame, left-aligned and sitting on the
 * rail. `captioned` moves the same strings to the bottom of the frame as burned-in subtitles for
 * the sound-off social deliveries. `none` is the hero loop, which carries no words at all.
 *
 * The statements are set **left, at the rail's own height**, which is the single biggest departure
 * from the earlier films' centred display type. There is a reason beyond variety: this film's frame
 * has a horizon in it, and copy centred over a horizon competes with it for the eye. Anchored to
 * the left margin and vertically tied to the rail, the words read as labels on the machine rather
 * than as titles over it — which is what they are.
 */

export type CopyMode = 'cinematic' | 'captioned' | 'none';

export const CopyModeContext = React.createContext<CopyMode>('cinematic');

export const useCopyMode = (): CopyMode => React.useContext(CopyModeContext);

/**
 * One statement.
 *
 * It rises 12px into place and leaves on opacity alone. Copy that drifts back out the way it came
 * reads as a slide transition; copy that simply stops being there reads as having been said.
 *
 * The left rule is the detail that makes the setting work. A 2px accent-toned tick sits at the
 * statement's left edge and draws in slightly ahead of the words, which ties the line to the rail's
 * geometry instead of letting it float in the margin.
 */
const Statement: React.FC<{
  text: string;
  frame: number;
  from: number;
  stay: number;
  level: 1 | 2;
  /** Vertical slot, in design-space px from the rail. Negative is above. */
  offset: number;
}> = ({ text, frame, from, stay, level, offset }) => {
  const { k, portrait } = useCopyScale();
  const scale = useScale();
  const box = useFrameBox();
  const opacity = hold(frame, { from, rise: 18, stay, fall: 20 });
  if (opacity < 0.002) return null;

  const lift = (1 - ramp(frame, from, 18)) * 12;
  const size = portrait
    ? level === 1
      ? SIZE.primaryPortrait
      : SIZE.secondaryPortrait
    : level === 1
      ? SIZE.primary
      : SIZE.secondary;

  /** Portrait sets copy under the machinery rather than beside it; there is no left margin to use. */
  const left = portrait ? 72 * (box.width / 1920) * scale : 104 * scale;
  const top = portrait ? (LINE_Y + 250 + offset * 0.7) * scale : (LINE_Y + offset) * scale;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        maxWidth: (portrait ? 940 : 760) * k,
        opacity,
        transform: `translateY(${lift * k}px)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -18 * k,
          top: 0.24 * size * k,
          width: Math.max(1, 2 * k),
          height: size * 0.86 * k,
          background: level === 1 ? INK.edge : INK.line,
          opacity: ramp(frame, from + 4, 16),
        }}
      />
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: size * k,
          fontWeight: level === 1 ? WEIGHT.primary : WEIGHT.secondary,
          letterSpacing: level === 1 ? TRACK.primary : TRACK.secondary,
          lineHeight: LEADING.display,
          color: level === 1 ? INK.bright : INK.muted,
          textWrap: 'balance',
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** The burned-in subtitle setting. One line at a time, bottom-anchored, no plate behind it. */
const Subtitle: React.FC<{ text: string; frame: number; from: number; stay: number }> = ({
  text,
  frame,
  from,
  stay,
}) => {
  const { k, portrait } = useCopyScale();
  const box = useFrameBox();
  const scale = useScale();
  const opacity = hold(frame, { from, rise: 10, stay, fall: 12 });
  if (opacity < 0.002) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: (box.height - (portrait ? 210 : 132)) * scale,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        padding: `0 ${(portrait ? 70 : 190) * scale}px`,
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: (portrait ? SIZE.captionPortrait : SIZE.caption) * k,
          fontWeight: WEIGHT.secondary,
          letterSpacing: TRACK.caption,
          lineHeight: LEADING.caption,
          color: INK.bright,
          textAlign: 'center',
          textWrap: 'balance',
          /**
           * A shadow rather than a background plate. These cuts play over interface detail, and a
           * translucent black bar across the bottom third would cover the machinery the caption is
           * describing. Two offset shadows keep the type legible over anything the film contains.
           */
          textShadow: `0 ${2 * k}px ${12 * k}px rgba(0,0,0,0.95), 0 0 ${28 * k}px rgba(0,0,0,0.8)`,
        }}
      >
        {text}
      </div>
    </div>
  );
};

/**
 * Every statement a sequence owns, in whichever mode is active.
 *
 * A scene renders `<Copy beat="isolation" />` and nothing else — the strings, the cues and the
 * levels all come from `script.ts`, which is also what the caption generator reads. There is no
 * second copy of any line in the project.
 */
export const Copy: React.FC<{ beat: BeatId }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const mode = useCopyMode();
  const lines = LINES[beat];
  if (mode === 'none' || lines.length === 0) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {lines.map((line, index) =>
        mode === 'captioned' ? (
          <Subtitle key={index} text={line.text} frame={frame} from={line.from} stay={line.stay} />
        ) : (
          <Statement
            key={index}
            text={line.text}
            frame={frame}
            from={line.from}
            stay={line.stay}
            level={line.level ?? 1}
            /**
             * The two slots. A primary statement sits 150px below the rail and a secondary one
             * 236px, so when both are on screen the second reads as a subordinate clause rather
             * than as a second headline. Sequences with one line only ever use the first slot.
             */
            offset={(line.level ?? 1) === 1 ? 150 : 236}
          />
        ),
      )}
    </AbsoluteFill>
  );
};
