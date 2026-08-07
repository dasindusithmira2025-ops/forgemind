import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Atmosphere, KeyLight, Vignette } from './Cinema';
import { CopyModeContext, type CopyMode } from './Copy';
import { Arrival, Close, Continuity, Direct, Fragments, Parallel, Proof, Repository } from './scenes';
import { BEATS, CUTS, CUT_FRAMES, DURATION, STARTS, type BeatId, type CutId } from './script';

/**
 * PARALITH — "Build beyond the editor."
 *
 * Ninety-five seconds in eight sequences. Every interface frame is rendered by `src/product/`,
 * which is styled by PARALITH's own stylesheet and coloured by PARALITH's own theme engine, both
 * generated from the desktop source by `scripts/sync-product-ui.mjs` and checked for drift by
 * `npm run sync:product:check`.
 *
 * The shorter cuts are not re-edits. They are excerpts of this timeline, played through the same
 * scene components at the same internal frames, which is what keeps the trailer from drifting out
 * of step with the film it is cut from. See the note on `Excerpt` in `script.ts`.
 */

const SCENES: Record<BeatId, React.FC> = {
  fragments: Fragments,
  arrival: Arrival,
  direct: Direct,
  parallel: Parallel,
  repository: Repository,
  proof: Proof,
  continuity: Continuity,
  close: Close,
};

/**
 * The one cut in the film that is not a straight cut.
 *
 * Almost every sequence change is a hard cut, which is what gives the film its pace. The exception
 * is the entry into the brand reveal: the screen goes completely black first, because a mark that
 * cuts in from a busy interface reads as an interruption rather than as an arrival. The endcard
 * does not need one — the close sequence dips itself, from the product it is already showing.
 */
const DIPS: readonly { at: number; length: number }[] = [{ at: STARTS.arrival, length: 36 }];

const Dip: React.FC<{ dips: readonly { at: number; length: number }[] }> = ({ dips }) => {
  const frame = useCurrentFrame();
  const darkness = dips.reduce(
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
const Bookend: React.FC<{ duration: number; tail?: number }> = ({ duration, tail = 50 }) => {
  const frame = useCurrentFrame();
  const black = Math.max(
    interpolate(frame, [0, 30], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(frame, [duration - tail, duration], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  return <AbsoluteFill style={{ background: '#000', opacity: black, pointerEvents: 'none' }} />;
};

/**
 * Plays one sequence from an arbitrary point in its own timeline.
 *
 * The inner `Sequence` starts at a negative offset, so at the excerpt's first output frame the
 * scene component reads `from` on its own clock. That is the whole mechanism behind the derived
 * cuts: no scene knows it is in a trailer.
 */
const Excerpted: React.FC<{
  beat: BeatId;
  from: number;
  length: number;
  at: number;
}> = ({ beat, from, length, at }) => {
  const Scene = SCENES[beat];
  return (
    <Sequence from={at} durationInFrames={length} name={`${beat}@${from}`} layout="none">
      <Sequence from={-from} durationInFrames={from + length} layout="none">
        <AbsoluteFill>
          <Scene />
        </AbsoluteFill>
      </Sequence>
    </Sequence>
  );
};

export interface CampaignFilmProps {
  cut?: CutId;
  /** `captioned` sets the statements as subtitles instead of display type. See `Copy.tsx`. */
  copy?: CopyMode;
  /** The hero loop and the silent master carry no score. */
  score?: boolean;
}

export const CampaignFilm: React.FC<CampaignFilmProps> = ({
  cut = 'master',
  copy = 'cinematic',
  score = true,
}) => {
  const duration = CUT_FRAMES[cut];

  const body =
    cut === 'master' ? (
      BEATS.map((beat) => (
        <Excerpted
          key={beat.id}
          beat={beat.id}
          from={0}
          length={beat.duration}
          at={STARTS[beat.id]}
        />
      ))
    ) : (
      (() => {
        let cursor = 0;
        return CUTS[cut].map((excerpt, index) => {
          const at = cursor;
          cursor += excerpt.length;
          return (
            <Excerpted
              key={`${excerpt.beat}-${index}`}
              beat={excerpt.beat}
              from={excerpt.from}
              length={excerpt.length}
              at={at}
            />
          );
        });
      })()
    );

  /**
   * The dip only belongs to the master. In the derived cuts the arrival sequence is entered at its
   * own excerpt boundary, which is already a hard cut from black-adjacent material, and a dip
   * keyed to the master's frame numbers would land in the middle of an unrelated sequence.
   */
  const dips = cut === 'master' ? DIPS : [];

  /**
   * The loop's bookend is short and symmetrical so the last frame matches the first: a hero loop
   * that fades out over fifty frames and cuts back to a fade-in reads as a stutter every time it
   * repeats.
   */
  const tail = cut === 'loop' ? 24 : 50;

  return (
    <CopyModeContext.Provider value={copy}>
      <AbsoluteFill style={{ background: '#000' }}>
        {/* The room the product stands in. Under everything, so it never tints the interface. */}
        <Atmosphere />

        {body}

        {/* The key, above the product — the one thing the film puts on top of the interface. */}
        <KeyLight />
        <Vignette />

        <Dip dips={dips} />
        <Bookend duration={duration} tail={tail} />

        {score ? <Audio src={staticFile(SCORE[cut])} volume={0.95} /> : null}
      </AbsoluteFill>
    </CopyModeContext.Provider>
  );
};

/**
 * One score per cut length. They are separate files rather than one file trimmed, because the
 * generator writes each cut's rhythm against that cut's own beat map — a trailer that fades out an
 * eighty-second arrangement thirty seconds in lands its last bar in the middle of a phrase.
 */
const SCORE: Record<CutId, string> = {
  master: 'audio/paralith-campaign-score.mp3',
  sixty: 'audio/paralith-campaign-score-60.mp3',
  thirty: 'audio/paralith-campaign-score-30.mp3',
  teaser: 'audio/paralith-campaign-score-15.mp3',
  loop: 'audio/paralith-campaign-score.mp3',
};

export { DURATION };
