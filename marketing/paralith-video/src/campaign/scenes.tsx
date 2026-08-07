import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { WINDOW, ProductWindow } from '../product/ProductWindow';
import { Workspace, WorkspaceView, canvasOrigin, CHROME } from '../product/Workspace';
import { SwarmWindow } from '../product/Swarm';
import { ResumeCenter } from '../product/Resume';
import { SWARM, RESUME_RECORDS } from '../product/swarmScenario';
import { LATE_WAIT } from '../product/scenario';
import { useScale } from '../film/Layers';
import { MarkBloom, Stage } from './Cinema';
import { DISPLAY, INK, SIZE, TRACK, WEIGHT } from './type';
import { Copy } from './Copy';
import { EASE, EASE_CAMERA, between, contain, ramp, shotOn, track, type Shot } from '../film/motion';
import { ARRIVAL_CATEGORY, CLOSE, LINES } from './script';

export { Fragments } from './Fragments';

/**
 * The eight sequences.
 *
 * Every product frame in this file is a real twin surface under a camera — `Workspace` for the
 * canvas and Repository sequences, `SwarmWindow` for the mission and proof sequences,
 * `ResumeCenter` for continuity. No sequence draws its own version of the interface or arranges
 * anything the product could not produce.
 */

const SIX = ['checkout', 'retries', 'schema', 'flakes', 'client', 'dev'] as const;

/**
 * Where the window sits when the whole thing is in frame.
 *
 * Landscape centres it horizontally and lifts it 30px off centre vertically, so the copy band in
 * the lower left gets a strip of its own without shrinking the product.
 *
 * Portrait is not a centre crop of that. A 1440x900 window scaled to 95% of a 1080-wide frame
 * would sit in the middle of a 1920-tall canvas with a third of the frame empty above and below
 * it, which reads as a landscape video someone letterboxed. Instead the window is scaled to fill
 * the width and parked in the upper half, leaving the lower band for copy — which is where a
 * viewer's thumb is not, and where every platform expects text to be.
 */
const useWideShot = (): Shot => {
  const { width, height } = useVideoConfig();
  const k = useScale();
  const portrait = height > width;
  /**
   * Portrait is scaled slightly past the frame width so the window is cropped a little on each
   * side rather than floating inside it. At 0.94 the window sat 1015px wide in a 1080px frame
   * with a third of the height empty above and below it, which reads as a landscape video someone
   * letterboxed. Crossing the frame edge is what makes it read as a screen filling the phone.
   */
  const scale = portrait ? (width * 1.06) / WINDOW.width : k * 0.95;
  return {
    scale,
    offset: {
      x: (width - WINDOW.width * scale) / 2,
      y: portrait ? height * 0.36 - (WINDOW.height * scale) / 2 : (height - WINDOW.height * scale) / 2 - 30 * k,
    },
  };
};

const useFrameSize = () => {
  const { width, height } = useVideoConfig();
  return { width, height };
};

/* ---- 2. arrival ----------------------------------------------------------------------------
 * The mark, then the environment behind it.
 *
 * The wordmark is wiped in from the left rather than faded, because a geometric wordmark drawn
 * this thin dissolves into grey as it crosses 50% opacity. The sequence does not end on the logo:
 * it hands off directly into the product, which is the one transition in the film that has to
 * happen or the mark never attaches to anything.
 */
export const Arrival: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();
  const wide = useWideShot();

  const markIn = ramp(frame, 30, 80, EASE);
  const settle = interpolate(markIn, [0, 1], [1.07, 1]);
  const wipe = ramp(frame, 108, 70, EASE);
  const category = ramp(frame, 200, 60, EASE);

  /** The lockup leaves before the product arrives, so the two never share the frame. */
  const brandOut = 1 - ramp(frame, 330, 70);

  /**
   * The window rises the last few pixels into its resting place and comes up from black. It is not
   * scaled up from nothing — the product does not "appear", it is revealed to have been there.
   */
  const productIn = ramp(frame, 400, 130, EASE_CAMERA);
  const shot: Shot = {
    scale: wide.scale,
    offset: { x: wide.offset.x, y: wide.offset.y + (1 - productIn) * 26 * k },
  };

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {productIn > 0 ? (
        <Stage
          width={WINDOW.width}
          height={WINDOW.height}
          shot={shot}
          opacity={productIn}
          // The product arrives very slightly turned and settles square, which reads as an object
          // being set down rather than an image being faded up.
          tilt={(1 - productIn) * 3.2}
        >
          <Workspace
            paneIds={SIX}
            activePaneId="checkout"
            frame={frame + 300}
            cadence={24}
            scale={shot.scale}
          />
        </Stage>
      ) : null}

      {brandOut > 0.001 ? (
        <>
        <MarkBloom opacity={brandOut * markIn} />
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 34 * k,
            opacity: brandOut,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 44 * k }}>
            <Img
              src={staticFile('brand/mark.png')}
              style={{ width: 150 * k, opacity: markIn, transform: `scale(${settle})` }}
            />
            <div style={{ overflow: 'hidden', width: 470 * k * wipe }}>
              <Img src={staticFile('brand/wordmark.png')} style={{ width: 470 * k, maxWidth: 'none' }} />
            </div>
          </div>

          <div
            style={{
              opacity: category,
              fontFamily: DISPLAY,
              fontSize: SIZE.category * k,
              fontWeight: WEIGHT.category,
              letterSpacing: TRACK.category,
              textTransform: 'uppercase',
              color: INK.category,
            }}
          >
            {ARRIVAL_CATEGORY}
          </div>
        </AbsoluteFill>
        </>
      ) : null}
    </AbsoluteFill>
  );
};

/* ---- 3. direct -----------------------------------------------------------------------------
 * A described outcome becomes a staffed task graph.
 *
 * The mission is typed as an acceptance criterion — "cannot double-charge … and prove it with
 * tests" — rather than as an instruction, because that is the difference the sequence is about.
 * Then the roster staffs up one agent at a time and the dependency edges follow, and the sequence
 * ends on the Tasks list, where the graph states its own dependencies in the product's own words.
 */
export const Direct: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  /** The mission types across two seconds, then the team is staffed against it. */
  const typed = Math.floor(track(frame, [40, 190], [0, SWARM.mission.length], EASE));
  const staffed = Math.min(6, Math.floor(track(frame, [210, 430], [0, 6.99], EASE_CAMERA)));
  const edges = Math.max(0, Math.floor(track(frame, [300, 470], [0, 6.99], EASE_CAMERA)));

  /** The cut to the Tasks list at 500, where the graph is legible as a list rather than a board. */
  const onTasks = frame >= 500;
  const tasks = Math.min(5, Math.floor(track(frame, [510, 690], [0, 5.99], EASE)));

  /**
   * A slow push toward the canvas while the team assembles, then a cut to the task list held at
   * the list itself rather than pulled back to the whole window.
   *
   * Five tasks do not fill `.swarm-work-content`, so a wide shot of this route puts a third of the
   * frame on the empty canvas below the last row — which is what the product genuinely draws, and
   * is still a bad shot. The camera stays on the rows.
   */
  const board = shotOn({ x: WINDOW.width * 0.52, y: WINDOW.height * 0.55 }, wide.scale * 1.3, size);
  const rows = shotOn({ x: WINDOW.width * 0.46, y: 380 }, wide.scale * 1.4, size);
  const rowsEnd = shotOn({ x: WINDOW.width * 0.46, y: 430 }, wide.scale * 1.52, size);
  const shot = contain(
    onTasks
      ? between(rows, rowsEnd, ramp(frame, 505, 275, EASE_CAMERA))
      : between(wide, board, ramp(frame, 150, 340, EASE_CAMERA)),
    WINDOW,
    size,
  );

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <SwarmWindow
          scale={shot.scale}
          phase={onTasks ? 'building' : 'planning'}
          lifecycle={onTasks ? 'building' : 'planning'}
          elapsed={onTasks ? '4m elapsed' : 'Not started'}
          view={onTasks ? 'work' : 'canvas'}
          workTab="tasks"
          agentsRevealed={staffed}
          edgesRevealed={edges}
          tasksRevealed={tasks}
          missionTyped={typed}
        />
      </Stage>
      <Copy frame={frame} lines={LINES.direct} />
    </AbsoluteFill>
  );
};

/* ---- 4. parallel ---------------------------------------------------------------------------
 * Six agents at once, and the one thing that makes that survivable.
 *
 * The sequence has three movements: the canvas divides 1 -> 2 -> 4 -> 6, one agent quietly stops
 * and its wait timer climbs while nothing announces it, and then the Fleet Bar is read close
 * enough to see that it names the pane and reports the wait. The middle movement is the argument;
 * without those five seconds of nothing happening, the Fleet Bar is a feature rather than an
 * answer.
 */
export const Parallel: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  const STEPS = [
    { at: 0, panes: SIX.slice(0, 1) },
    { at: 60, panes: SIX.slice(0, 2) },
    { at: 150, panes: SIX.slice(0, 4) },
    { at: 250, panes: SIX.slice(0, 6) },
  ] as const;

  const index = STEPS.reduce((found, step, i) => (frame >= step.at ? i : found), 0);
  const step = STEPS[index];
  const previous = index > 0 ? STEPS[index - 1] : undefined;
  const split = previous ? ramp(frame, step.at, 32, EASE) : 1;

  /**
   * The pane stops at frame 360 and its wait timer runs from there in story time.
   *
   * The rate is 90 seconds of story per second of film, which puts the timer at 11m24s exactly
   * when the camera reaches the Fleet Bar at frame 800 — the number the product's four-step wait
   * ladder puts at its top step, and the number the film's one feature claim rests on. An earlier
   * version multiplied by frame rather than by elapsed seconds and had the bar reading 2h41m,
   * which is not a wait, it is an outage.
   */
  const stopped = frame >= 360;
  const waited = stopped ? 24_000 + ((frame - 360) / 60) * 90_000 : 0;

  /**
   * The camera holds wide while the fleet runs, then pushes into the title bar at 620 so the Fleet
   * Bar can actually be read, then pulls back out with the waiting pane focused.
   */
  const bar = shotOn({ x: 470, y: CHROME.header / 2 }, wide.scale * 1.95, size);
  const push = ramp(frame, 620, 170, EASE_CAMERA);
  const pull = ramp(frame, 850, 110, EASE_CAMERA);
  const shot = contain(between(between(wide, bar, push), wide, pull), WINDOW, size);

  /** The click lands at 850; from there the waiting pane is the active pane. */
  const focused = frame >= 850;

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <Workspace
          paneIds={step.panes}
          from={previous?.panes}
          splitProgress={split}
          activePaneId={focused ? 'retries' : 'checkout'}
          overrides={stopped ? [{ id: 'retries', state: 'needs_permission', waitedMs: waited }] : []}
          frame={frame + 480}
          cadence={22}
          scale={shot.scale}
        />
      </Stage>
      <Copy frame={frame} lines={LINES.parallel} />
    </AbsoluteFill>
  );
};

/* ---- 5. repository -------------------------------------------------------------------------
 * Every change keeps its author.
 *
 * The Repository view is a route inside the same shell, so the title bar, sidebar and status bar
 * do not change and the fleet keeps running behind the review — which is the point being made.
 * The camera settles on the file list, where the product's per-file agent attribution is what
 * turns six parallel agents from a risk into a record.
 */
export const Repository: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  const list = shotOn({ x: CHROME.sidebar + 190, y: 420 }, wide.scale * 1.72, size);
  const shot = contain(between(wide, list, ramp(frame, 50, 250, EASE_CAMERA)), WINDOW, size);

  /** The diff walks open in the second half, so the sequence ends on a change, not on a list. */
  const revealed = Math.floor(track(frame, [330, 600], [0, 12]));

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <Workspace
          paneIds={SIX}
          activePaneId="retries"
          overrides={[{ id: LATE_WAIT.paneId, state: LATE_WAIT.state, waitedMs: LATE_WAIT.waitedMs }]}
          frame={frame + 1200}
          complete
          scale={shot.scale}
          repository={{ diffRevealed: revealed }}
        />
      </Stage>
      <Copy frame={frame} lines={LINES.repository} />
    </AbsoluteFill>
  );
};

/* ---- 6. proof ------------------------------------------------------------------------------
 * Completion is a claim; evidence is not.
 *
 * Back to the Swarm, thirty-one minutes later. The sequence opens on the Tests tab — four real
 * commands with their real output — and cuts to the Evidence tab, which in the product accepts
 * only commands, tests, diffs, traces, reviews and approvals, grouped under the acceptance
 * criterion each one belongs to. It ends on the ready-for-review banner, where the last step is a
 * person.
 */
export const Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  const onEvidence = frame >= 330;

  /** Held closer than the mission sequence: this is a reading shot, and the rows are small. */
  const lists = shotOn({ x: WINDOW.width * 0.42, y: WINDOW.height * 0.55 }, wide.scale * 1.42, size);
  const shot = contain(between(wide, lists, ramp(frame, 40, 260, EASE_CAMERA)), WINDOW, size);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <SwarmWindow
          scale={shot.scale}
          phase="ready"
          lifecycle="ready_for_review"
          elapsed="31m elapsed"
          view="work"
          workTab={onEvidence ? 'evidence' : 'tests'}
          readyBanner={onEvidence}
        />
      </Stage>
      <Copy frame={frame} lines={LINES.proof} />
    </AbsoluteFill>
  );
};

/* ---- 7. continuity -------------------------------------------------------------------------
 * The machine restarts; the session does not start over.
 *
 * PARALITH has just restarted to install an update — the documented path in
 * `services/agent_resume.rs` — and the sessions that were interrupted are listed with their
 * provider session ids and the worktrees they were started in. The sequence resumes them, which is
 * a single click in the product and is shown as a single click here.
 */
export const Continuity: React.FC = () => {
  const frame = useCurrentFrame();
  const wide = useWideShot();
  const size = useFrameSize();

  /** The list fills as the recheck completes, one row at a time. */
  const revealed = Math.min(3, Math.floor(track(frame, [60, 190], [0, 3.99], EASE)));

  /** Resume all lands at 400. Every row flips to running together, which is what the button does. */
  const resumed = frame >= 400 ? RESUME_RECORDS.map((record) => record.id) : [];

  const modal = shotOn({ x: WINDOW.width / 2, y: WINDOW.height * 0.5 }, wide.scale * 1.24, size);
  const shot = contain(between(wide, modal, ramp(frame, 30, 220, EASE_CAMERA)), WINDOW, size);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <ProductWindow scale={shot.scale}>
          <>
            <WorkspaceView
              paneIds={SIX}
              activePaneId="checkout"
              frame={frame + 1500}
              complete
            />
            <ResumeCenter revealed={revealed} resumedIds={resumed} />
          </>
        </ProductWindow>
      </Stage>
      <Copy frame={frame} lines={LINES.continuity} />
    </AbsoluteFill>
  );
};

/* ---- 8. close ------------------------------------------------------------------------------
 * The environment, the statement, the mark.
 *
 * The pull-back is the only shot in the film that shows the whole thing running at once, and it is
 * held for less than three seconds — long enough to register as a system, short enough that the
 * film does not end on a screenshot. Then black, then the one slogan the script allows itself,
 * then the logo pack's own lockup rather than a retypeset PARALITH.
 */
export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();
  const wide = useWideShot();
  const size = useFrameSize();

  /** A slow pull back from slightly inside the window to the full environment. */
  const from = shotOn({ x: WINDOW.width * 0.5, y: WINDOW.height * 0.5 }, wide.scale * 1.16, size);
  const shot = contain(between(from, wide, ramp(frame, 0, 190, EASE_CAMERA)), WINDOW, size);
  const productOut = 1 - ramp(frame, 175, 45);

  const statement = Math.min(ramp(frame, 235, 46, EASE), 1 - ramp(frame, 350, 40));
  const lockup = ramp(frame, 392, 80, EASE);
  const tail = ramp(frame, 470, 60, EASE);
  const out = 1 - ramp(frame, 552, 48);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {productOut > 0.001 ? (
        <Stage
          width={WINDOW.width}
          height={WINDOW.height}
          shot={shot}
          opacity={productOut}
          // The one shot in the film that shows the whole environment at once turns a few degrees
          // as it pulls back, so the last look at the product is of an object rather than a plan.
          tilt={2.6 * (1 - ramp(frame, 0, 190, EASE_CAMERA))}
        >
          <Workspace
            paneIds={SIX}
            activePaneId="checkout"
            overrides={[{ id: LATE_WAIT.paneId, state: LATE_WAIT.state, waitedMs: LATE_WAIT.waitedMs }]}
            frame={frame + 1900}
            complete
            scale={shot.scale}
          />
        </Stage>
      ) : null}

      {statement > 0.001 ? (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: statement }}>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: SIZE.statement * k,
              fontWeight: WEIGHT.statement,
              letterSpacing: TRACK.statement,
              color: INK.primary,
            }}
          >
            {CLOSE.statement}
          </div>
        </AbsoluteFill>
      ) : null}

      {/*
        The endcard is the mark and the wordmark, not the logo pack's primary lockup.
        `brand/lockup.png` has "Many agents. One build." baked into the artwork — the previous
        cut's tagline — and using it here would end the film on two competing taglines four seconds
        apart. The mark and wordmark are the same official artwork with the tagline lifted off, so
        the statement above stands alone and the line under the wordmark states the category
        instead of selling a second time.
      */}
      {lockup > 0.001 ? (
        <>
        <MarkBloom opacity={out * lockup} />
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 40 * k,
            opacity: out,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 40 * k,
              opacity: lockup,
              transform: `scale(${interpolate(lockup, [0, 1], [1.035, 1])})`,
            }}
          >
            <Img src={staticFile('brand/mark.png')} style={{ width: 132 * k }} />
            <Img src={staticFile('brand/wordmark.png')} style={{ width: 414 * k, maxWidth: 'none' }} />
          </div>

          <div
            style={{
              opacity: tail,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 15 * k,
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: SIZE.category * k,
                fontWeight: WEIGHT.category,
                letterSpacing: TRACK.category,
                textTransform: 'uppercase',
                color: INK.category,
              }}
            >
              {CLOSE.category}
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: SIZE.fine * k,
                fontWeight: WEIGHT.fine,
                letterSpacing: TRACK.fine,
                textTransform: 'uppercase',
                color: INK.company,
              }}
            >
              {CLOSE.company}
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: SIZE.fine * k,
                fontWeight: WEIGHT.fine,
                letterSpacing: TRACK.fine,
                textTransform: 'uppercase',
                color: INK.domain,
              }}
            >
              {CLOSE.url}
            </div>
          </div>
        </AbsoluteFill>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
