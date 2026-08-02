/**
 * PARALITH — "Build beyond the editor." The campaign cut.
 *
 * This is the master brand film. It supersedes the earlier eight-beat brand cut in `src/film`,
 * which stays registered so its delivered masters remain reproducible from source.
 *
 * Three decisions shape this file.
 *
 * The first is that the film is ninety-five seconds in eight sequences, and the mark lands at
 * twelve. The earlier cut held the logo back to 0:31, which is a defensible film-school choice and
 * the wrong one for a launch: a viewer who does not know the product's name by the fifteenth second
 * spends the next minute watching an interface they cannot attribute.
 *
 * The second is that there is still no narration. A synthesised voice reading marketing copy is the
 * single loudest signal that nobody was in the room when a film was made, and the only voice this
 * workstation can generate is the Windows `System.Speech` one the explainer used. The copy is
 * carried as type over an original score. `docs/VOICEOVER.md` holds the script for a real read, and
 * every line below is already timed as a caption cue, so a narrated version needs no re-timing.
 *
 * The third is that every sequence is anchored to a surface PARALITH actually ships. Two of the
 * brief's sequences named features that do not exist — a Mission Control dashboard and a Memory
 * screen, both deleted from the product on 2026-07-16 — so they are shot on the real equivalents:
 * Swarms for the mission sequence, Agent Resume for the continuity sequence. The Swarm work view's
 * Memory tab was considered for the latter and rejected: its context-pack read path is live, but
 * nothing outside migration tests writes `memory_items`, so a real install shows its empty state.
 * Filming it populated would have been the one thing this film is not allowed to do.
 */

export const FPS = 60;

export type BeatId =
  | 'fragments'
  | 'arrival'
  | 'direct'
  | 'parallel'
  | 'repository'
  | 'proof'
  | 'continuity'
  | 'close';

export interface Beat {
  id: BeatId;
  duration: number;
}

/**
 * The cut. Frame-exact at 60fps, totalling 5,700 frames — 95.0 seconds.
 *
 * The shape is deliberately asymmetric. `parallel` is the longest sequence because it is the only
 * one carrying an idea a viewer has not seen in a developer-tool film before, and `continuity` is
 * the shortest because its point lands in one gesture. Nothing here is padded to a round number.
 */
export const BEATS: readonly Beat[] = [
  { id: 'fragments', duration: 720 }, //   0:00  the workflow that already has intelligence in it
  { id: 'arrival', duration: 660 }, //     0:12  the mark, and the environment behind it
  { id: 'direct', duration: 780 }, //      0:23  a described outcome becomes a staffed task graph
  { id: 'parallel', duration: 960 }, //    0:36  six agents, six worktrees, one place that knows
  { id: 'repository', duration: 720 }, //  0:52  every change keeps its author
  { id: 'proof', duration: 720 }, //       1:04  completion is a claim; evidence is not
  { id: 'continuity', duration: 540 }, //  1:16  the session survives the restart
  { id: 'close', duration: 600 }, //       1:25  build beyond the editor
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

/* ---- Copy ----------------------------------------------------------------------------------
 *
 * One idea per line, at most two lines per sequence, and one slogan in the whole film — the last
 * one. A viewer gets roughly two and a half seconds per line at this pace, which is about seven
 * words; every line below is inside that budget.
 *
 * `from` and `stay` are frames within the sequence. They are also the caption cues: `scripts/
 * generate-captions.mjs` walks this table, offsets each line by its sequence start, and writes the
 * SRT. There is no second copy of these strings anywhere in the project.
 */

export interface LineSpec {
  text: string;
  from: number;
  stay: number;
  /** 1 is the primary statement; 2 steps down for a second, quieter line. */
  level?: 1 | 2;
}

export const LINES: Record<BeatId, readonly LineSpec[]> = {
  /**
   * The problem, stated as a contradiction rather than as a complaint. "Intelligence arrived"
   * concedes that the tools are good — the film is not arguing that agents are bad, it is arguing
   * that six of them in six windows is not a workflow.
   */
  fragments: [
    { text: 'Intelligence arrived.', from: 150, stay: 190 },
    { text: 'Coordination did not.', from: 400, stay: 240, level: 2 },
  ],

  /** The mark carries this sequence. The category line is set under the wordmark, not over the UI. */
  arrival: [],

  /**
   * The mission sequence. "Structures" is the exact verb: the Coordinator persists an adaptive task
   * graph with real dependencies, and the film shows that graph rather than asserting it.
   */
  direct: [
    { text: 'Describe the outcome.', from: 90, stay: 210 },
    { text: 'PARALITH structures the work.', from: 360, stay: 300, level: 2 },
  ],

  /**
   * The one feature claim in the film, and the reason the Fleet Bar exists. Both halves are
   * literally true of `features/fleet/FleetBar.tsx`: it names the pane and it reports the wait.
   *
   * An earlier draft read "Six agents. Six isolated worktrees." and was wrong. The panes on this
   * canvas run in project subdirectories — `orbital`, `orbital\db`, `orbital\apps\web` — not in
   * worktrees. Worktree isolation is a Swarm property (`agent.worktree`), so that claim is made in
   * the sequence that can show it and withdrawn from the one that cannot.
   */
  parallel: [
    // Timed to what is actually on the canvas. The tiling reaches six at local frame 250, so a
    // line reading "six agents" at 120 sat over a canvas holding two — the kind of mismatch that
    // costs a viewer their trust in everything else the film asserts. It now lands at 300, after
    // the last split has settled.
    { text: 'Six agents, working at once.', from: 300, stay: 210 },
    // And this one waits for the camera to reach the Fleet Bar at 620, so the claim and the thing
    // that substantiates it are on screen together.
    { text: 'One place that knows which one needs you.', from: 640, stay: 250, level: 2 },
  ],

  /** Attribution, which is what makes parallel work reviewable instead of merely fast. */
  repository: [{ text: 'Every change keeps its author.', from: 110, stay: 340 }],

  /**
   * The verification sequence. The first line is the concession and the second is the product's
   * position; splitting them across four seconds is what stops it reading as a slogan.
   */
  proof: [
    { text: 'Completion is a claim.', from: 100, stay: 200 },
    { text: 'Evidence is not.', from: 360, stay: 280, level: 2 },
  ],

  /** Continuity, stated as the thing that actually happens: the machine restarts, the work doesn't. */
  continuity: [
    { text: 'The machine restarts.', from: 70, stay: 170 },
    { text: 'The session does not start over.', from: 280, stay: 210, level: 2 },
  ],

  /** The endcard's own type is drawn by the scene, so the copy track is empty here. */
  close: [],
};

/**
 * The endcard.
 *
 * The tagline is set as type; the lockup underneath is the logo pack's own artwork rather than a
 * retypeset PARALITH, so the last frame of the film is the mark exactly as it is specified. The URL
 * is the verified root domain — the earlier explainer shipped with a product page that 404s.
 */
export const CLOSE = {
  statement: 'Build beyond the editor.',
  category: 'The Agentic Development Environment',
  company: 'By Corelith Technologies',
  url: 'corelithtechnologies.com',
} as const;

/**
 * The category line under the mark at 0:12. Held separately from `CLOSE` because the arrival states
 * what the product *is* and the endcard states what it is *for*, and the film should not say the
 * same words twice.
 */
export const ARRIVAL_CATEGORY = 'The Agentic Development Environment';

/* ---- Derived cuts --------------------------------------------------------------------------
 *
 * The short cuts are excerpts of the master timeline, not re-edits of it. Each entry plays sequence
 * `beat` from its own internal frame `from` for `length` frames, and the scenes are pure functions
 * of their sequence-local frame, so an excerpt renders exactly the frames the master renders at
 * that point in that sequence. Nothing is re-animated for a shorter runtime, which is what keeps
 * the trailer from drifting out of step with the film it is cut from.
 *
 * Excerpts start on whole sequences wherever possible. Where they start mid-sequence they start
 * after that sequence's camera move has settled, so a cut never opens on a frame that is halfway
 * through a push-in.
 */
export interface Excerpt {
  beat: BeatId;
  from: number;
  length: number;
}

export type CutId = 'master' | 'sixty' | 'thirty' | 'teaser' | 'loop';

const lengthOf = (excerpts: readonly Excerpt[]) =>
  excerpts.reduce((total, excerpt) => total + excerpt.length, 0);

/** The 60-second launch cut. Keeps all eight sequences; trims the dwell inside each. */
const SIXTY: readonly Excerpt[] = [
  { beat: 'fragments', from: 120, length: 330 },
  { beat: 'arrival', from: 60, length: 480 },
  { beat: 'direct', from: 60, length: 480 },
  { beat: 'parallel', from: 60, length: 630 },
  { beat: 'repository', from: 40, length: 420 },
  { beat: 'proof', from: 40, length: 450 },
  { beat: 'continuity', from: 20, length: 300 },
  { beat: 'close', from: 0, length: 510 },
];

/** The 30-second promotional cut. Drops the problem statement and the continuity beat. */
const THIRTY: readonly Excerpt[] = [
  { beat: 'arrival', from: 90, length: 330 },
  { beat: 'direct', from: 80, length: 330 },
  { beat: 'parallel', from: 90, length: 420 },
  { beat: 'repository', from: 60, length: 240 },
  { beat: 'proof', from: 60, length: 300 },
  { beat: 'close', from: 0, length: 180 },
];

/** The 15-second teaser. Problem, mark, scale, name. */
const TEASER: readonly Excerpt[] = [
  { beat: 'fragments', from: 330, length: 150 },
  { beat: 'arrival', from: 60, length: 270 },
  { beat: 'parallel', from: 420, length: 240 },
  { beat: 'close', from: 30, length: 240 },
];

/**
 * The website hero loop: silent, captionless, and cut from the middle of `parallel` where the
 * canvas is dense and nothing is being said over it. It carries no copy at all — a hero loop sits
 * under a headline the page has already written, and a second headline inside the video competes
 * with it.
 */
const LOOP: readonly Excerpt[] = [{ beat: 'parallel', from: 180, length: 720 }];

export const CUTS: Record<Exclude<CutId, 'master'>, readonly Excerpt[]> = {
  sixty: SIXTY,
  thirty: THIRTY,
  teaser: TEASER,
  loop: LOOP,
};

export const CUT_FRAMES: Record<CutId, number> = {
  master: DURATION,
  sixty: lengthOf(SIXTY),
  thirty: lengthOf(THIRTY),
  teaser: lengthOf(TEASER),
  loop: lengthOf(LOOP),
};
