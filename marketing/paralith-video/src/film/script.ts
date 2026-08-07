/**
 * The cut, and the words.
 *
 * Two decisions shape this file, and both are about not sounding like a product video.
 *
 * The first is that there is no narration. The existing 82-second film is narrated by a
 * synthesised Windows voice, and a synthetic voice reading marketing copy is the single loudest
 * signal that nobody was in the room when a film was made. This cut carries its copy as type over
 * a score instead, which is also how the films this brand should be measured against are made.
 *
 * The second is that the copy tells one story about one morning rather than listing what the
 * product does. There is exactly one feature claim in the whole script — "PARALITH tells you
 * which one, and how long it has been waiting" — and it is the truth the Fleet Bar was built to
 * deliver. Everything before it is the problem; everything after it is the consequence.
 *
 * The timings are frame-exact at 60fps and total 4,920 frames, which is 82.0 seconds — the
 * duration of the existing original score, so the film cuts to music that already exists.
 */

export const FPS = 60;

export type BeatId =
  | 'handoff'
  | 'multiply'
  | 'silence'
  | 'reveal'
  | 'command'
  | 'evidence'
  | 'authority'
  | 'close';

export interface Beat {
  id: BeatId;
  duration: number;
}

export const BEATS: readonly Beat[] = [
  { id: 'handoff', duration: 480 }, //   0:00  one agent, working, alone
  { id: 'multiply', duration: 660 }, //  0:08  the frame splits to six
  { id: 'silence', duration: 720 }, //   0:19  one of them stops, and nothing says so
  { id: 'reveal', duration: 540 }, //    0:31  the mark
  { id: 'command', duration: 660 }, //   0:40  the Fleet Bar answers the question
  { id: 'evidence', duration: 540 }, //  0:51  what each agent actually changed
  { id: 'authority', duration: 600 }, // 1:00  the human approves
  { id: 'close', duration: 720 }, //     1:10  lockup
];

export const DURATION = BEATS.reduce((total, beat) => total + beat.duration, 0);

export const STARTS: Record<BeatId, number> = (() => {
  let cursor = 0;
  const starts = {} as Record<BeatId, number>;
  for (const beat of BEATS) {
    starts[beat.id] = cursor;
    cursor += beat.duration;
  }
  return starts;
})();

export const durationOf = (id: BeatId): number => BEATS.find((beat) => beat.id === id)!.duration;

/**
 * One line per beat, occasionally two. Written to be read at a glance at 60fps — a viewer gets
 * about two and a half seconds per line, which is roughly seven words.
 */
export const LINES: Record<BeatId, readonly string[]> = {
  handoff: ['You gave the work to an agent.'],
  multiply: ['Then you gave it to six.'],
  silence: ['At 09:41, one of them stopped.', 'You found out at 09:52.'],
  reveal: [],
  command: ['PARALITH tells you which one.', 'And how long it has been waiting.'],
  evidence: ['Every change, and who made it.'],
  authority: ['Nothing lands until you say so.'],
  close: [],
};

/** The endcard. The tagline is the brand's own, set in the official lockup rather than retypeset. */
export const CLOSE = {
  url: 'corelithtechnologies.com',
} as const;
