import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { CopyModeContext, type CopyMode } from './Copy';
import { INK } from './design';
import { Grade, Grain } from './stage';
import { Close, Consent, Instruction, Isolation, Split, Through, Verification } from './scenes';
import { BEATS, CUTS, CUT_FRAMES, DURATION, STARTS, type BeatId, type CutId } from './script';

/**
 * PARALITH — "The only way through."
 *
 * Seventy-eight seconds in seven sequences, following one change from the sentence that asked for
 * it to the commit that lands it, through the three gates the product will not let it skip.
 *
 * This is a new film rather than a re-cut of the campaign film in `src/campaign`. It shares no
 * scene, layout, motion curve, score, stem, copy line or delivered file name with it. What it does
 * share is the architecture, because that architecture was right: sequences are pure functions of
 * their own local frame, so the shorter cuts are excerpts of this timeline played through the same
 * components at the same internal frames, and no scene knows it is in a trailer.
 */

const SCENES: Record<BeatId, React.FC> = {
  instruction: Instruction,
  split: Split,
  isolation: Isolation,
  verification: Verification,
  consent: Consent,
  through: Through,
  close: Close,
};

/**
 * The two dips.
 *
 * Six of the seven sequence changes are hard cuts, which is what gives the film its forward
 * pressure. The exceptions are the entry into `verification` and the entry into `close`. The first
 * one is a dip because the sequence it opens is the one where the film stops, and cutting straight
 * from five lanes of activity into a held gate reads as a glitch rather than as a halt. The second
 * is a dip because a mark that cuts in from a running interface reads as an interruption.
 *
 * They are eight frames shorter than a beat of the score, so neither one lands on a downbeat —
 * a dip synchronised to the music draws attention to itself as an edit.
 */
const DIPS: readonly { at: number; length: number }[] = [
  { at: STARTS.verification, length: 22 },
  { at: STARTS.close, length: 34 },
];

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

/** Fades the master up from and down to black so the file never starts or ends on a hard frame. */
const Bookend: React.FC<{ duration: number; tail?: number }> = ({ duration, tail = 54 }) => {
  const frame = useCurrentFrame();
  const black = Math.max(
    interpolate(frame, [0, 34], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
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
 * scene component reads `from` on its own clock. This is the whole mechanism behind the derived
 * cuts.
 */
const Excerpted: React.FC<{ beat: BeatId; from: number; length: number; at: number }> = ({
  beat,
  from,
  length,
  at,
}) => {
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

export interface GateFilmProps {
  cut?: CutId;
  /** `captioned` sets the statements as subtitles instead of display type. See `Copy.tsx`. */
  copy?: CopyMode;
  /** The hero loop and the silent master carry no score. */
  score?: boolean;
}

export const GateFilm: React.FC<GateFilmProps> = ({ cut = 'master', copy = 'cinematic', score = true }) => {
  const duration = CUT_FRAMES[cut];

  const body =
    cut === 'master'
      ? BEATS.map((beat) => (
          <Excerpted key={beat.id} beat={beat.id} from={0} length={beat.duration} at={STARTS[beat.id]} />
        ))
      : (() => {
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
        })();

  /**
   * The dips belong to the master only. In a derived cut every sequence is entered at its own
   * excerpt boundary, which is already a hard cut, and a dip keyed to the master's frame numbers
   * would land in the middle of an unrelated sequence.
   */
  const dips = cut === 'master' ? DIPS : [];

  /**
   * The loop's bookend is short and symmetrical so its last frame matches its first: a hero loop
   * that fades out over fifty frames and cuts back to a fade-in stutters every time it repeats.
   */
  const tail = cut === 'loop' ? 26 : 54;

  return (
    <CopyModeContext.Provider value={copy}>
      <AbsoluteFill style={{ background: INK.field }}>
        {body}

        {/*
          The grade sits above the sequences and below the copy. It is two gradients and a static
          grain field — there is no coloured atmosphere in this film, because the design system
          spends chroma on meaning and a tinted room would spend it on nothing.
        */}
        <Grade />
        <Grain />

        <Dip dips={dips} />
        <Bookend duration={duration} tail={tail} />

        {score ? <Audio src={staticFile(SCORE[cut])} volume={0.95} /> : null}
      </AbsoluteFill>
    </CopyModeContext.Provider>
  );
};

/**
 * One score per cut length. Separate files rather than one file trimmed, because the generator
 * writes each cut's arrangement against that cut's own beat map — a trailer that fades out a
 * seventy-eight second arrangement thirty seconds in lands its last bar mid-phrase.
 */
const SCORE: Record<CutId, string> = {
  master: 'audio/paralith-gate-score.mp3',
  sixty: 'audio/paralith-gate-score-60.mp3',
  thirty: 'audio/paralith-gate-score-30.mp3',
  teaser: 'audio/paralith-gate-score-15.mp3',
  loop: 'audio/paralith-gate-score-loop.mp3',
};

export { DURATION };
