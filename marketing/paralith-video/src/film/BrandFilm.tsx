import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Vignette } from './Layers';
import { Authority, Close, Command, Evidence, Handoff, Multiply, Reveal, Silence } from './scenes';
import { BEATS, DURATION, STARTS, type BeatId } from './script';

/**
 * PARALITH — "Many agents. One build."
 *
 * An 82-second brand film. The product in it is not a mock-up: every interface frame is rendered
 * by `src/product/`, which is styled by PARALITH's own stylesheet and coloured by PARALITH's own
 * theme engine, both generated from the desktop source by `scripts/sync-product-ui.mjs`. See
 * `src/product/ProductWindow.tsx` for why the window is always laid out at its native 1440x900.
 *
 * There is no narration. The film carries its copy as type over an original score, which is both
 * the register this brand should be in and the surest way to avoid the synthetic-voiceover sound
 * that marks a video as machine-assembled.
 */

const SCENES: Record<BeatId, React.FC> = {
  handoff: Handoff,
  multiply: Multiply,
  silence: Silence,
  reveal: Reveal,
  command: Command,
  evidence: Evidence,
  authority: Authority,
  close: Close,
};

/**
 * The two cuts that are not straight cuts.
 *
 * Almost every beat change in this film is a hard cut, which is what gives it its pace. The two
 * exceptions are the entry into the brand reveal and the entry into the endcard: both need the
 * screen to go completely black first, because a mark that cuts in from a busy interface reads
 * as an interruption rather than an arrival.
 */
const DIPS: readonly { at: number; length: number }[] = [
  { at: STARTS.reveal, length: 34 },
  { at: STARTS.close, length: 30 },
];

/** Full black on the cut frame itself, ramping in and out either side of it. */
const Dip: React.FC = () => {
  const frame = useCurrentFrame();
  const darkness = DIPS.reduce(
    (value, dip) =>
      Math.max(
        value,
        interpolate(frame, [dip.at - dip.length, dip.at, dip.at + dip.length], [0, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      ),
    0,
  );

  return darkness > 0.001 ? (
    <AbsoluteFill style={{ background: '#000', opacity: darkness, pointerEvents: 'none' }} />
  ) : null;
};

/** Fades the master up from and down to black, so the file never starts or ends on a hard frame. */
const Bookend: React.FC = () => {
  const frame = useCurrentFrame();
  const black = Math.max(
    interpolate(frame, [0, 30], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(frame, [DURATION - 50, DURATION], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
  return <AbsoluteFill style={{ background: '#000', opacity: black, pointerEvents: 'none' }} />;
};

export const BrandFilm: React.FC<{ score?: boolean }> = ({ score = true }) => (
  <AbsoluteFill style={{ background: '#000' }}>
    <Vignette />

    {BEATS.map((beat) => {
      const Scene = SCENES[beat.id];
      return (
        <Sequence key={beat.id} from={STARTS[beat.id]} durationInFrames={beat.duration} name={beat.id}>
          <Scene />
        </Sequence>
      );
    })}

    <Dip />
    <Bookend />

    {/*
      The brand cut's own score, written against the beat map in `script.ts` by
      `scripts/generate-brand-score.mjs` — its pulse subdivides on the canvas splits and drops
      beats through `silence`. The explainer's score is not reused here: it was composed for a
      different nine-scene shape and its swells land mid-beat over this edit.
    */}
    {score ? <Audio src={staticFile('audio/paralith-brand-score.mp3')} volume={0.95} /> : null}
  </AbsoluteFill>
);
