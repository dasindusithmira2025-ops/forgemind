import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { useScale } from '../film/Layers';
import { DISPLAY, INK, LEADING, SIZE, TRACK, WEIGHT } from './type';
import { hold, ramp } from '../film/motion';
import type { LineSpec } from './script';

/**
 * The film's copy, in one of two presentations.
 *
 * This film has no narration, so its statements are the only words in it. That creates a real
 * question for the captioned deliverable: burning subtitles under type that is already on screen
 * would print every line twice, which is worse for a caption user than not captioning at all.
 *
 * So `captioned` is a mode rather than an overlay. In the cinematic presentation the statements sit
 * lower-left at display size, which is how the film is designed. In the captioned presentation the
 * same strings, at the same frames, are set as standard centred subtitles in a lower safe band and
 * the cinematic type is suppressed. Neither version shows a line twice, and the SRT generated from
 * `script.ts` matches both to the frame.
 *
 * The third mode is `none`, for the website hero loop. A loop sits under a headline the page has
 * already written, and a second headline inside the video competes with it.
 */

export type CopyMode = 'cinematic' | 'captioned' | 'none';

export const CopyModeContext = React.createContext<CopyMode>('cinematic');

/**
 * The basis type scales against.
 *
 * Landscape measures against the 1920-wide master. Portrait measures against 1080, because a 9:16
 * frame is 1080 wide and scaling its type by `width / 1920` renders every statement at 56% of its
 * intended size — which is how the first vertical cut ended up with 22px captions.
 */
const useCopyScale = () => {
  const { width, height } = useVideoConfig();
  return height > width ? width / 1080 : width / 1920;
};

/**
 * Where copy sits.
 *
 * Landscape puts it lower-left on a 120px margin so the eye never has to re-find where words
 * appear across a cut. Portrait centres it and lifts it clear of the bottom edge, because a
 * lower-left block in a 9:16 frame collides with the platform's own action rail.
 */
const useCopyLayout = () => {
  const { width, height } = useVideoConfig();
  const k = useCopyScale();
  const portrait = height > width;
  return {
    portrait,
    align: portrait ? ('center' as const) : ('left' as const),
    padding: portrait ? `0 ${52 * k}px ${330 * k}px` : `0 ${120 * k}px ${96 * k}px`,
  };
};

const Line: React.FC<{
  children: React.ReactNode;
  frame: number;
  spec: LineSpec;
  align: 'left' | 'center';
  size: number;
}> = ({ children, frame, spec, align, size }) => {
  const k = useCopyScale();
  const rise = 26;
  const opacity = hold(frame, { from: spec.from, rise, stay: spec.stay, fall: 18 });
  const entrance = ramp(frame, spec.from, rise);
  const lift = (1 - entrance) * 16;

  /**
   * The line is wiped up from behind its own baseline rather than simply faded in.
   *
   * A fade moves every letter's value at once and reads as a dissolve; a mask that lifts while the
   * type lifts reads as the words arriving. The clip runs slightly ahead of the translate, so the
   * descenders clear the mask edge before the line settles and nothing looks clipped at rest.
   *
   * It applies to the entrance only. Copy leaves on opacity alone — a line that exits the way it
   * arrived reads as a slide transition rather than as a statement being withdrawn.
   */
  const reveal = Math.min(1, entrance * 1.18);

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${lift * k}px)`,
        clipPath: reveal >= 1 ? undefined : `inset(-0.35em 0 ${(1 - reveal) * 100}% 0)`,
        fontFamily: DISPLAY,
        fontSize: size * k,
        fontWeight: spec.level === 2 ? WEIGHT.secondary : WEIGHT.primary,
        letterSpacing: spec.level === 2 ? TRACK.secondary : TRACK.primary,
        lineHeight: LEADING.display,
        color: spec.level === 2 ? INK.secondary : INK.primary,
        textAlign: align,
        textWrap: 'balance',
      }}
    >
      {children}
    </div>
  );
};

/** The caption presentation: centred, one line at a time, in a fixed lower band. */
const Captions: React.FC<{ frame: number; lines: readonly LineSpec[] }> = ({ frame, lines }) => {
  const k = useCopyScale();
  const { width, height } = useVideoConfig();
  const portrait = height > width;

  const veil = lines.reduce(
    (value, line) => Math.max(value, hold(frame, { from: line.from, stay: line.stay })),
    0,
  );

  return (
    <AbsoluteFill
      style={{
        padding: `0 ${(portrait ? 64 : 80) * k}px ${(portrait ? 300 : 74) * k}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 8 * k,
        pointerEvents: 'none',
      }}
    >
      {lines.map((line) => {
        const opacity = hold(frame, { from: line.from, rise: 10, stay: line.stay, fall: 10 });
        if (opacity <= 0.001) return null;
        return (
          <div
            key={line.text}
            style={{
              opacity,
              padding: `${7 * k}px ${16 * k}px`,
              borderRadius: 5 * k,
              background: `rgba(0,0,0,${0.72 * veil})`,
              fontFamily: DISPLAY,
              fontSize: (portrait ? SIZE.captionPortrait : SIZE.caption) * k,
              fontWeight: WEIGHT.caption,
              letterSpacing: TRACK.caption,
              lineHeight: LEADING.caption,
              color: INK.primary,
              textAlign: 'center',
              textWrap: 'balance',
            }}
          >
            {line.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * The copy block and the scrim that makes it readable.
 *
 * The scrim is keyed to the copy rather than always present: it rises and falls with the lines it
 * serves, so the product is never dimmed at a moment when nothing is being said over it.
 */
export const Copy: React.FC<{ frame: number; lines: readonly LineSpec[] }> = ({ frame, lines }) => {
  const mode = React.useContext(CopyModeContext);
  const k = useCopyScale();
  const { portrait, align, padding } = useCopyLayout();

  if (lines.length === 0 || mode === 'none') return null;

  const veil = lines.reduce(
    (value, line) => Math.max(value, hold(frame, { from: line.from, stay: line.stay })),
    0,
  );

  const scrim = (
    <AbsoluteFill
      style={{
        background:
          'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.82) 20%, rgba(0,0,0,0.45) 34%, rgba(0,0,0,0) 52%)',
        opacity: veil,
        pointerEvents: 'none',
      }}
    />
  );

  if (mode === 'captioned') {
    return (
      <>
        {scrim}
        <Captions frame={frame} lines={lines} />
      </>
    );
  }

  /** Long statements are set smaller in portrait, where the measure is half as wide. */
  const primary = portrait ? SIZE.primaryPortrait : SIZE.primary;
  const secondary = portrait ? SIZE.secondaryPortrait : SIZE.secondary;

  return (
    <>
      {scrim}
      <AbsoluteFill
        style={{
          padding,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: align === 'center' ? 'center' : 'flex-start',
          gap: 10 * k,
          pointerEvents: 'none',
        }}
      >
        {lines.map((line) => (
          <Line
            key={line.text}
            frame={frame}
            spec={line}
            align={align}
            size={line.level === 2 ? secondary : primary}
          >
            {line.text}
          </Line>
        ))}
      </AbsoluteFill>
    </>
  );
};
