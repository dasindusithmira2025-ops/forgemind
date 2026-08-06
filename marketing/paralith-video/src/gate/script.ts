/**
 * PARALITH — "The only way through." The gate film.
 *
 * This is a new film, not a re-cut. It shares no scene, no layout, no score, no stem and no copy
 * line with the explainer in `src/scenes`, the brand cut in `src/film`, or the campaign cut in
 * `src/campaign`. Those three are all built on the same argument — development is fragmented,
 * PARALITH is the control plane — and they make it by touring the product. A fourth tour would
 * have been the same film with new furniture.
 *
 * So this one argues something the others never state: **not what PARALITH lets you do, but what
 * it refuses to let happen.** The product page already publishes three guarantees under the heading
 * "Three states, and only one way through" — the agent writes outside your tree, the change has to
 * pass before it moves, and a person is the one who lets it through. Those three are the film.
 *
 * Three decisions shape this file.
 *
 * The first is that the film is a single direction of travel. Seven sequences, and in every one of
 * them the work enters from the right of frame, crosses a fixed horizontal line at the same height,
 * and leaves to the left. Nothing in this film ever moves backwards, because the argument is that
 * in PARALITH nothing does. The three gates are literal: a change reaches a closed seam, and the
 * seam opens only when its condition is satisfied. In `verification` one of them does not open, and
 * the film stops there and waits, which is the single most important eight seconds in it.
 *
 * The second is that every noun on screen is one the product actually uses. The agent roles are
 * `SwarmAgentRole` (coordinator, scout, builder, debugger, reviewer, integrator). The phases are
 * `SwarmPhase` (understanding, planning, building, verifying, ready). `DECISION REQUIRED` is a real
 * `SwarmStatus` variant, not a caption someone wrote. The branch names are the format
 * `swarm_service.rs` writes: `paralith/swarm-<short>/<role>-<short>`. A viewer who has used the
 * product should recognise every string in this film, and a viewer who has not should be able to
 * find every one of them after they install it.
 *
 * The third is that there is no narration and no claim of speed. No number in this film describes
 * how much faster anything is, because the film is not about throughput. `docs/GATE_FILM.md` holds
 * the read for a narrated version; every line below is already timed as a caption cue.
 */

export const FPS = 60;

export type BeatId =
  | 'instruction'
  | 'split'
  | 'isolation'
  | 'verification'
  | 'consent'
  | 'through'
  | 'close';

export interface Beat {
  id: BeatId;
  duration: number;
}

/**
 * The cut. Frame-exact at 60fps, totalling 4,680 frames — 78.0 seconds.
 *
 * `isolation` and `verification` are the two longest sequences and they are the same length, which
 * is deliberate: they are the two halves of the same promise, and giving one of them more time
 * would say that one of them matters more. `through` is the shortest because a change landing is
 * the least interesting thing in the film — the interesting part was everything it had to survive.
 */
export const BEATS: readonly Beat[] = [
  { id: 'instruction', duration: 600 }, //  0:00  one sentence becomes an object
  { id: 'split', duration: 720 }, //        0:10  the object becomes six
  { id: 'isolation', duration: 780 }, //    0:22  gate one — it writes, but not into your project
  { id: 'verification', duration: 780 }, // 0:35  gate two — and one of them does not pass
  { id: 'consent', duration: 720 }, //      0:48  gate three — the one that only a person opens
  { id: 'through', duration: 480 }, //      1:00  it lands
  { id: 'close', duration: 600 }, //        1:08  the mark
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

/* ---- The travel line -------------------------------------------------------------------------
 *
 * Every sequence draws against these. `LINE_Y` is the height of the rail the work travels along,
 * in the 1920×1080 design space, and it is the one number in the film that never changes — the
 * whole continuity trick is that seven hard cuts all land with the rail in exactly the same place,
 * so the eye reads them as one uninterrupted move rather than as seven scenes.
 *
 * It sits at 0.567 of frame height rather than at the centre. Dead centre splits the frame into two
 * equal halves and gives the composition nothing to do; a rail slightly below centre leaves room
 * above it for the surfaces that explain the work and a narrow band below it for the ledger.
 */
export const LINE_Y = 612;

/** Where a gate seam stands, in the design space. All three gates are at the same x. */
export const GATE_X = 1246;

/* ---- Copy -------------------------------------------------------------------------------------
 *
 * At most two lines per sequence and never more than seven words in one. The copy is set left, at
 * the rail, rather than centred: a centred line is a title card, and this film has no title cards
 * until the last one. Everything before the endcard is a caption on a machine that is running.
 *
 * `from` and `stay` are frames within the sequence, and they are also the caption cues.
 * `scripts/generate-gate-captions.mjs` walks this table, offsets each line by its sequence start,
 * and writes the SRT and VTT. These strings exist in exactly one place in the project.
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
   * The premise, stated as flatly as it can be. The sentence being typed on screen is doing the
   * work here, so the copy stays out of its way until it has finished and collapsed.
   */
  instruction: [{ text: 'It starts with one instruction.', from: 400, stay: 170 }],

  /**
   * The decomposition. "Take it apart" rather than "orchestrate" or "delegate", because taking a
   * thing apart is what the coordinator literally does and the other two words are brochure verbs.
   */
  split: [
    { text: 'Six agents take it apart.', from: 300, stay: 200 },
    { text: 'Each one gets a branch of its own.', from: 530, stay: 170, level: 2 },
  ],

  /**
   * Gate one. Both halves are quoted almost exactly from the product page's own guarantee, which is
   * the point — the film is not making a claim, it is showing one that is already published.
   */
  isolation: [
    { text: 'The agent writes.', from: 150, stay: 200 },
    { text: 'Not into your project.', from: 400, stay: 300, level: 2 },
  ],

  /**
   * Gate two, and the reason this sequence exists. The second line lands at 430, which is thirty
   * frames after the failing lane has visibly stopped at the seam — so the viewer sees the stop,
   * and then reads the sentence that explains it, in that order. The other way round the line is a
   * prediction; this way it is a caption on something that just happened.
   */
  verification: [
    { text: 'Every change is checked.', from: 120, stay: 190 },
    { text: 'A failure stops where it is.', from: 430, stay: 260, level: 2 },
  ],

  /**
   * Gate three. The quiet one. The sequence holds four completely still seconds before the cursor
   * arrives, and this line sits in that stillness with nothing else on the frame moving.
   */
  consent: [
    { text: 'You are the one who lets it through.', from: 150, stay: 250 },
    { text: 'There is no override.', from: 470, stay: 190, level: 2 },
  ],

  /** The landing. One line, five words, and then the film stops talking. */
  through: [{ text: 'Then, and only then, it lands.', from: 90, stay: 250 }],

  /** The endcard sets its own type. */
  close: [],
};

/**
 * The endcard.
 *
 * The statement is the film's title and it is the only slogan in it. The lockup underneath is the
 * logo pack's own artwork rather than a retypeset wordmark, so the last frame is the mark exactly
 * as it is specified. The domain is the verified root.
 */
export const CLOSE = {
  statement: 'The only way through.',
  category: 'The Agentic Development Environment',
  company: 'By Corelith Technologies',
  url: 'corelithtechnologies.com',
} as const;

/* ---- The instruction --------------------------------------------------------------------------
 *
 * The sentence typed in the opening sequence, and the work it becomes. It is a maintenance job
 * rather than a greenfield feature, because maintenance is where isolation, verification and
 * consent actually matter, and because "build me an app" is the prompt every other agent film uses.
 */
export const INSTRUCTION =
  'retire the legacy billing webhook, keep every callback contract intact';

/** The swarm's short id, and the branch prefix it produces. Matches `swarm_service.rs`. */
export const SWARM_ID = '4f2a9c';
export const branchFor = (role: string, agent: string) =>
  `paralith/swarm-${SWARM_ID.slice(0, 4)}/${role}-${agent}`;

export interface Agent {
  role: 'coordinator' | 'scout' | 'builder' | 'debugger' | 'reviewer' | 'integrator';
  /** The agent's short id, as it appears in its branch name. */
  id: string;
  /** What this agent was given. Present tense, lower case, no full stop — as the task list shows it. */
  task: string;
}

/**
 * The fleet. Six agents, one per role, in the order `SwarmAgentRole` declares them.
 *
 * The tasks are a real decomposition of the instruction: someone has to find every caller before
 * anyone can retire anything, someone has to write the replacement, someone has to prove the
 * contract did not move, and someone has to put it together. The debugger has no task at the split
 * because a debugger is dispatched to a failure, and at the split there has not been one yet —
 * which is what makes its arrival in `verification` mean something.
 */
export const FLEET: readonly Agent[] = [
  { role: 'coordinator', id: 'a71f', task: 'hold the task graph' },
  { role: 'scout', id: 'c30e', task: 'find every webhook caller' },
  { role: 'builder', id: '91cb', task: 'write the replacement handler' },
  { role: 'reviewer', id: '2d84', task: 'check the callback contract' },
  { role: 'integrator', id: '5ea0', task: 'assemble the change' },
  { role: 'debugger', id: 'b6f3', task: 'standby' },
];

/**
 * The checks that run at gate two, in the order the sequence runs them.
 *
 * `contract` fails. It is the one that matters — the instruction's second clause was "keep every
 * callback contract intact", so the film fails the exact check that the person asked for, rather
 * than failing a lint rule for the sake of having something go red.
 */
export interface Check {
  id: string;
  label: string;
  /** Sequence-local frame at which this check resolves. */
  at: number;
  outcome: 'pass' | 'fail';
}

export const CHECKS: readonly Check[] = [
  { id: 'build', label: 'build', at: 210, outcome: 'pass' },
  { id: 'types', label: 'typecheck', at: 250, outcome: 'pass' },
  { id: 'lint', label: 'lint', at: 288, outcome: 'pass' },
  { id: 'unit', label: 'unit', at: 330, outcome: 'pass' },
  { id: 'contract', label: 'contract', at: 372, outcome: 'fail' },
  { id: 'e2e', label: 'integration', at: 414, outcome: 'pass' },
];

/** Sequence-local frame at which the debugger's re-run clears the failed check. */
export const REPAIR_AT = 640;

/**
 * The review, at gate three.
 *
 * Two columns, because the product page's own wording for this surface is "what changed, and what
 * was deliberately left alone". The second column is the unusual half and it is the honest one: a
 * review that only lists what moved cannot tell you what the agent decided not to touch.
 */
export const REVIEW = {
  changed: [
    { path: 'apps/billing/webhook/handler.ts', added: 84, removed: 210 },
    { path: 'apps/billing/webhook/contract.ts', added: 31, removed: 4 },
    { path: 'apps/billing/routes.ts', added: 6, removed: 6 },
    { path: 'tests/billing/contract.spec.ts', added: 118, removed: 0 },
  ],
  untouched: [
    { path: 'apps/billing/legacy/payloads.json', why: 'still referenced by the archive job' },
    { path: 'infra/queues/billing.tf', why: 'outside the requested change' },
    { path: 'apps/billing/README.md', why: 'no instruction to update docs' },
  ],
} as const;

/* ---- Derived cuts -----------------------------------------------------------------------------
 *
 * The short cuts are excerpts of this timeline, not re-edits of it. Each entry plays sequence
 * `beat` from its own internal frame `from` for `length` frames, and every scene is a pure function
 * of its sequence-local frame, so an excerpt renders exactly the frames the master renders at that
 * point in that sequence. No scene knows it is in a trailer.
 *
 * Excerpts start after a sequence's entry move has settled, so a cut never opens mid-transit.
 */
export interface Excerpt {
  beat: BeatId;
  from: number;
  length: number;
}

export type CutId = 'master' | 'sixty' | 'thirty' | 'teaser' | 'loop';

const lengthOf = (excerpts: readonly Excerpt[]) =>
  excerpts.reduce((total, excerpt) => total + excerpt.length, 0);

/**
 * The excerpt windows are chosen against the copy, not against a stopwatch.
 *
 * Every statement in `LINES` is legible from `from` to `from + 18 + stay + 20`, and the first draft
 * of these cuts ignored that: the thirty opened `isolation` twelve frames before "Not into your
 * project." finished fading in and cut away twenty frames later, which put a seven-word line on
 * screen for a third of a second. Each window below now either contains a statement's whole
 * readable interval or misses it entirely, so a cut never jumps mid-sentence and the generated SRT
 * never emits a cue too short to read.
 *
 * Where a sequence has two statements and there is not room for both, the cut takes the *second*.
 * "Not into your project." carries gate one on its own; "The agent writes." does not.
 */

/** The 60-second cut. Keeps all seven sequences and trims the dwell inside each. */
const SIXTY: readonly Excerpt[] = [
  { beat: 'instruction', from: 250, length: 370 }, //  L1 400-608 whole
  { beat: 'split', from: 240, length: 460 }, //        L1 300-538 whole, L2 from 530
  { beat: 'isolation', from: 120, length: 580 }, //    L1 150-388 whole, L2 from 400
  { beat: 'verification', from: 60, length: 720 }, //  the stop, the hold and the release, entire
  { beat: 'consent', from: 100, length: 600 }, //      L1 150-438 whole, the click at 566
  { beat: 'through', from: 30, length: 270 }, //       the merge at 210
  { beat: 'close', from: 0, length: 600 },
];

/**
 * The 30-second cut. Drops the decomposition and the landing, and keeps all three gates — a thirty
 * that shows two of them would be advertising two thirds of the promise.
 */
const THIRTY: readonly Excerpt[] = [
  { beat: 'instruction', from: 380, length: 240 }, //  L1 400-608 whole
  { beat: 'isolation', from: 400, length: 340 }, //    L2 400-738 whole; opens on the closed gate
  { beat: 'verification', from: 340, length: 400 }, // the failure at 372, L2 430-728 whole
  { beat: 'consent', from: 440, length: 300 }, //      L2 470-708 whole, the click at 566
  { beat: 'close', from: 0, length: 520 },
];

/**
 * The 15-second teaser. The instruction, the stop, the hand, the mark.
 *
 * Its endcard runs the mark, the category and the title but not the domain: `close` sets the
 * company and URL at local frame 300 and this excerpt ends at 340, so they would flash. A teaser
 * that ends on the mark and the line is a better teaser than one that ends on a URL nobody had time
 * to read; the domain is in every cut from thirty seconds up, and on the poster.
 */
const TEASER: readonly Excerpt[] = [
  { beat: 'instruction', from: 380, length: 180 },
  { beat: 'verification', from: 350, length: 250 }, // the failure at 372, L2 430-600
  { beat: 'consent', from: 480, length: 130 }, //     the still frame, then the click at 566
  { beat: 'close', from: 0, length: 340 },
];

/**
 * The website hero loop: silent, captionless, cut from the middle of `isolation` where five lanes
 * are running and nothing is being said over them. It carries no copy — a hero loop sits under a
 * headline the page has already written, and a second headline inside the video competes with it.
 */
const LOOP: readonly Excerpt[] = [{ beat: 'isolation', from: 200, length: 540 }];

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
