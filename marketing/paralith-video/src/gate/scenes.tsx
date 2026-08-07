import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { Copy } from './Copy';
import {
  DISPLAY,
  INK,
  LEADING,
  MONO,
  RADIUS,
  SIZE,
  STATE,
  TRACK,
  U,
  WEIGHT,
  useCopyScale,
  useFrameBox,
  useScale,
} from './design';
import { Ledger, type Entry } from './Ledger';
import { breathe, hold, noise, ramp, snap, travel } from './motion';
import { At, Click, Cursor, Gate, Machine, Plate, Rail, Station, Ties, Token, World } from './stage';
import {
  CHECKS,
  CLOSE,
  FLEET,
  GATE_X,
  INSTRUCTION,
  LINE_Y,
  REPAIR_AT,
  REVIEW,
  SWARM_ID,
  branchFor,
} from './script';

/**
 * The seven sequences.
 *
 * Every one of them is a pure function of its own local frame. Nothing reads the master timeline,
 * nothing reads the delivery format, and nothing holds state between frames — which is what lets
 * `GateFilm` play any sequence from any internal frame for any length and get exactly the frames
 * the master would show at that point. The derived cuts are excerpts, not re-edits, and this is the
 * property that makes that true.
 *
 * They also share one piece of geometry and one piece of grammar. The geometry is the rail at
 * `LINE_Y`, which is in the same place in all seven. The grammar is that work travels left to
 * right and never the other way. Between sequences the camera has moved forward along the line, so
 * a hard cut puts the work back at the left of frame — the same object, further down the same
 * track.
 */

/* ---- Shared furniture ---------------------------------------------------------------------------- */

const Scene: React.FC<{
  index: string;
  name: string;
  entries: readonly Entry[];
  beat: Parameters<typeof Copy>[0]['beat'];
  /** Fades the rail in at the top of the film and out at the end of it. */
  rail?: number;
  railLit?: number;
  tieSpeed?: number;
  children: React.ReactNode;
}> = ({ index, name, entries, beat, rail = 1, railLit = 0, tieSpeed = 0, children }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: INK.field }}>
      <World>
        <Rail opacity={rail} lit={railLit} />
        <Ties speed={tieSpeed} opacity={rail * 0.9} />
        <Station index={index} name={name} frame={frame} />
        {children}
      </World>
      <Copy beat={beat} />
      <Ledger frame={frame} entries={entries} />
    </AbsoluteFill>
  );
};

/** A state chip. The product renders its statuses this way, so the film does too. */
const Chip: React.FC<{ label: string; tone?: 'idle' | 'accent' | 'pass' | 'fail'; opacity?: number }> = ({
  label,
  tone = 'idle',
  opacity = 1,
}) => {
  const k = useScale();
  const colour =
    tone === 'pass' ? STATE.pass : tone === 'fail' ? STATE.fail : tone === 'accent' ? STATE.accent : INK.muted;
  const fill =
    tone === 'pass'
      ? STATE.passSoft
      : tone === 'fail'
        ? STATE.failSoft
        : tone === 'accent'
          ? STATE.accentSoft
          : 'rgba(255,255,255,0.05)';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: `${3 * k}px ${8 * k}px`,
        background: fill,
        border: `${Math.max(1, k)}px solid ${colour}44`,
        borderRadius: RADIUS * k,
        fontFamily: MONO,
        fontSize: SIZE.machineSmall * k,
        letterSpacing: TRACK.station,
        textTransform: 'uppercase',
        color: colour,
        opacity,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
};

/** The role colour rule: roles are not colour-coded. They are ordered, and order is enough. */
const RoleLabel: React.FC<{ role: string; id: string; muted?: boolean }> = ({ role, id, muted }) => (
  <>
    <Machine size={SIZE.machineSmall} colour={muted ? INK.faint : INK.text} weight={500}
      style={{ letterSpacing: TRACK.station, textTransform: 'uppercase' }}>
      {role}
    </Machine>
    <Machine size={SIZE.machineSmall} colour={INK.ghost}>
      {id}
    </Machine>
  </>
);

/* ================================================================================================
 * 01 — INSTRUCTION
 *
 * One sentence is typed, and then it stops being a sentence. The collapse at 300 is the film's
 * thesis stated in three quarters of a second: everything after this point is that instruction,
 * as an object, moving.
 * ============================================================================================== */

const INSTRUCTION_ENTRIES: readonly Entry[] = [
  { at: 318, event: 'swarm.created', detail: SWARM_ID, tone: 'accent' },
  { at: 352, event: 'swarm.phase', detail: 'understanding' },
  { at: 470, event: 'coordinator.claimed', detail: branchFor('coordinator', FLEET[0].id) },
];

export const Instruction: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  /** The type-on. 2.2 characters a frame — fast enough to be a person who knows what they want. */
  const typed = Math.min(INSTRUCTION.length, Math.max(0, Math.floor((frame - 66) * 2.2)));
  const finished = typed >= INSTRUCTION.length;
  const text = INSTRUCTION.slice(0, typed);

  /**
   * The collapse. The line compresses to nothing against its own left edge over eighteen frames
   * while the token comes up in its place. Both curves are the same `snap`, so the sentence does
   * not finish disappearing before the object exists — for six frames they are both there, which
   * is what makes it read as one thing becoming another rather than as a cut.
   */
  const collapse = snap(frame, 300, 18);
  const born = snap(frame, 306, 16);

  /** The caret. Blinks only while the line is being written, then holds solid and goes with it. */
  const caretOn = finished ? (Math.floor(frame / 26) % 2 === 0 ? 1 : 0.25) : 1;

  /** After the collapse the token idles, then starts down the rail toward the next station. */
  const depart = travel(frame, 430, 200);
  const x = 128 + depart * 1180;

  return (
    <Scene index="01" name="instruction" entries={INSTRUCTION_ENTRIES} beat="instruction" rail={ramp(frame, 10, 40)}>
      {/* The prompt, sitting above the rail where the work will be. */}
      <At x={104} y={LINE_Y - 96} opacity={ramp(frame, 40, 26) * (1 - collapse)}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 * k }}>
          <Machine colour={STATE.accent} size={SIZE.instruction} weight={500}>
            ›
          </Machine>
          <div
            style={{
              transform: `scaleX(${1 - collapse})`,
              transformOrigin: 'left center',
              opacity: 1 - collapse * 0.9,
              display: 'flex',
              alignItems: 'baseline',
            }}
          >
            <Machine colour={INK.bright} size={SIZE.instruction}>
              {text}
            </Machine>
            <span
              style={{
                display: 'inline-block',
                width: 11 * k,
                height: 2 * k,
                marginLeft: 3 * k,
                background: STATE.accent,
                opacity: caretOn * (1 - collapse),
              }}
            />
          </div>
        </div>
      </At>

      {/* What the instruction is being given to. Two lines, no plate: this is not a screen yet. */}
      <At x={104} y={LINE_Y - 42} opacity={hold(frame, { from: 120, rise: 20, stay: 150, fall: 24 }) * (1 - collapse)}>
        <Machine size={SIZE.machineSmall} colour={INK.faint}>
          swarm · orbital · {FLEET.length} agents available
        </Machine>
      </At>

      {/* The object. */}
      <Token x={x} opacity={born} trail={depart > 0.01 && depart < 0.99 ? 46 : 0} />

      {/*
        The one measurement in the sequence: the distance the object has left to travel. It is
        drawn as a hairline running ahead of the token to the edge of frame, and it exists so the
        first thing the film establishes is that this object is going somewhere.
      */}
      <At x={0} y={0} opacity={born * 0.5 * ramp(frame, 400, 40)}>
        <div
          style={{
            position: 'absolute',
            left: (x + 22) * k,
            top: (LINE_Y - 0.5) * k,
            width: Math.max(0, 1860 - x) * k,
            height: Math.max(1, 1 * k),
            background: `linear-gradient(to right, ${STATE.accentEdge}, rgba(255,255,255,0))`,
          }}
        />
      </At>
    </Scene>
  );
};

/* ================================================================================================
 * 02 — SPLIT
 *
 * The instruction becomes six. The lanes fan upward rather than symmetrically around the rail,
 * because the rail has to stay clear: it is the coordinator's own lane and it is the one that will
 * still be there in the next sequence.
 * ============================================================================================== */

/** Lane 0 is the rail itself. Lanes 1-5 stack above it at a 58px pitch. */
const laneY = (index: number) => LINE_Y - index * 58;

const SPLIT_ENTRIES: readonly Entry[] = [
  { at: 130, event: 'swarm.phase', detail: 'planning' },
  { at: 196, event: 'task.proposed', detail: '6 tasks' },
  { at: 268, event: 'worktree.created', detail: `${FLEET.length} branches`, tone: 'accent' },
  { at: 372, event: 'swarm.phase', detail: 'building' },
  { at: 520, event: 'agent.status', detail: 'active · active · active · active · queued' },
];

export const Split: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  /** The phase chip walks the real `SwarmPhase` sequence at the frames the ledger reports it. */
  const phase = frame >= 372 ? 'building' : frame >= 130 ? 'planning' : 'understanding';

  return (
    <Scene index="02" name="decomposition" entries={SPLIT_ENTRIES} beat="split">
      {/* The graph the coordinator is holding. Sits above the fan, out of the lanes' way. */}
      <Plate x={104} y={LINE_Y - 470} width={520} height={100} title={`swarm ${SWARM_ID}`}
        right={<Chip label={phase} tone={phase === 'building' ? 'accent' : 'idle'} />}
        opacity={ramp(frame, 30, 30)}>
        <div style={{ padding: `${14 * k}px ${U * k}px`, display: 'grid', gap: 9 * k }}>
          <Machine size={SIZE.machineSmall} colour={INK.muted}>
            {INSTRUCTION.length > 52 ? `${INSTRUCTION.slice(0, 52)}…` : INSTRUCTION}
          </Machine>
          <div style={{ display: 'flex', gap: 6 * k, alignItems: 'center' }}>
            {FLEET.map((agent, index) => {
              const on = snap(frame, 196 + index * 18, 14);
              return (
                <div
                  key={agent.id}
                  style={{
                    width: 62 * k,
                    height: 5 * k,
                    background: index === 5 ? INK.hair : `rgba(167,139,250,${0.25 + on * 0.6})`,
                    opacity: 0.3 + on * 0.7,
                  }}
                />
              );
            })}
          </div>
        </div>
      </Plate>

      {/*
        The fan. Each lane is drawn as a hairline that grows from the split point outward, and the
        vertical connector between the rail and the lane draws first — so the eye sees the branch
        leave the trunk before it sees where it goes.
      */}
      {FLEET.map((agent, index) => {
        if (index === 0) return null;
        const start = 120 + index * 26;
        const rise = snap(frame, start, 20);
        const run = travel(frame, start + 12, 60);
        const y = laneY(index);
        return (
          <React.Fragment key={agent.id}>
            <div
              style={{
                position: 'absolute',
                left: 336 * k,
                top: y * k,
                width: Math.max(1, 1 * k),
                height: (LINE_Y - y) * rise * k,
                background: INK.line,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 336 * k,
                top: y * k,
                width: (1500 * run) * k,
                height: Math.max(1, 1 * k),
                background: `linear-gradient(to right, rgba(255,255,255,0.14), rgba(255,255,255,0.05))`,
              }}
            />
          </React.Fragment>
        );
      })}

      {/* The agents, on their lanes. */}
      {FLEET.map((agent, index) => {
        const start = 120 + index * 26;
        const on = ramp(frame, start + 40, 24);
        const y = laneY(index);
        const standby = agent.task === 'standby';
        return (
          // 54px above the lane, not 30. The block is two rows deep, and at 30 the second row
          // sat exactly on the hairline — every task in the sequence was struck through.
          <At key={agent.id} x={392} y={y - 56} opacity={on * (standby ? 0.55 : 1)}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 * k }}>
              <RoleLabel role={agent.role} id={agent.id} muted={standby} />
              <Machine size={SIZE.machineSmall} colour={INK.ghost}>
                {standby ? '—' : branchFor(agent.role, agent.id)}
              </Machine>
            </div>
            <div style={{ marginTop: 5 * k }}>
              <Machine size={SIZE.machineSmall} colour={standby ? INK.ghost : INK.faint}>
                {agent.task}
              </Machine>
            </div>
          </At>
        );
      })}

      {/* Six objects where there was one. The standby lane's token stays grey — it has no work. */}
      {FLEET.map((agent, index) => {
        const start = 120 + index * 26;
        const run = travel(frame, start + 30, 150);
        const standby = agent.task === 'standby';
        const x = 336 + run * (standby ? 120 : 620 + noise(agent.id) * 240);
        return (
          <Token
            key={`t-${agent.id}`}
            x={x}
            y={laneY(index)}
            size={index === 0 ? 13 : 10}
            tone={standby ? 'idle' : 'accent'}
            opacity={snap(frame, start + 24, 14) * (standby ? 0.5 : 1)}
            trail={run > 0.02 && run < 0.98 ? 34 : 0}
          />
        );
      })}
    </Scene>
  );
};

/* ================================================================================================
 * 03 — ISOLATION · GATE ONE
 *
 * The first gate is closed for the entire sequence and never opens, which is the only sequence in
 * the film where that is true. The work runs on the near side of it and the project sits on the
 * far side, unchanged and provably so: the tree's head hash is on screen for thirteen seconds and
 * it does not move a character.
 * ============================================================================================== */

const TREE: readonly { path: string; depth: number }[] = [
  { path: 'apps/', depth: 0 },
  { path: 'billing/', depth: 1 },
  { path: 'webhook/', depth: 2 },
  { path: 'handler.ts', depth: 3 },
  { path: 'contract.ts', depth: 3 },
  { path: 'routes.ts', depth: 2 },
  { path: 'infra/', depth: 0 },
  { path: 'tests/', depth: 0 },
];

const ISOLATION_ENTRIES: readonly Entry[] = [
  { at: 90, event: 'worktree.attached', detail: 'off-tree', tone: 'accent' },
  { at: 250, event: 'fs.write', detail: 'worktree only' },
  { at: 400, event: 'working_tree.status', detail: 'clean', tone: 'pass' },
  { at: 560, event: 'fs.write', detail: 'worktree only' },
  { at: 690, event: 'working_tree.status', detail: 'clean', tone: 'pass' },
];

export const Isolation: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  /** Diff counters, ticking. Deterministic per agent so a re-render is frame-identical. */
  const counted = (agent: (typeof FLEET)[number], index: number) => {
    const t = ramp(frame, 140 + index * 22, 460);
    const total = 40 + Math.floor(noise(`add${agent.id}`) * 180);
    const removed = 8 + Math.floor(noise(`del${agent.id}`) * 120);
    return { added: Math.floor(total * t), removed: Math.floor(removed * t) };
  };

  return (
    <Scene index="03" name="isolation" entries={ISOLATION_ENTRIES} beat="isolation">
      {/* The five working lanes, on the near side of the gate. */}
      {FLEET.filter((agent) => agent.task !== 'standby').map((agent, index) => {
        const y = laneY(index);
        const on = ramp(frame, 20 + index * 16, 26);
        const counts = counted(agent, index);
        const active = frame > 100 + index * 22;
        return (
          <React.Fragment key={agent.id}>
            <div
              style={{
                position: 'absolute',
                left: 104 * k,
                top: y * k,
                width: (GATE_X - 128) * k,
                height: Math.max(1, 1 * k),
                background: 'rgba(255,255,255,0.07)',
                opacity: on,
              }}
            />
            <At x={104} y={y - 34} opacity={on}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 * k }}>
                <RoleLabel role={agent.role} id={agent.id} />
                <Machine size={SIZE.machineSmall} colour={INK.ghost}>
                  {branchFor(agent.role, agent.id)}
                </Machine>
                <Machine size={SIZE.machineSmall} colour={STATE.pass} opacity={active ? 0.9 : 0.2}>
                  +{counts.added}
                </Machine>
                <Machine size={SIZE.machineSmall} colour={INK.faint} opacity={active ? 0.9 : 0.2}>
                  −{counts.removed}
                </Machine>
              </div>
            </At>
            {/*
              The work itself: a short accent segment shuttling along the lane. It never reaches
              the gate. That is the whole sequence — five lanes of visible activity, none of which
              arrives anywhere.
            */}
            <Token
              x={220 + (0.5 + Math.sin(frame / (72 + index * 9) + index) * 0.5) * 840}
              y={y}
              size={9}
              opacity={on * (active ? 1 : 0)}
              trail={26}
            />
          </React.Fragment>
        );
      })}

      {/* Gate one. Closed at frame zero, closed at frame 780. */}
      <Gate
        state="closed"
        since={frame}
        label="isolation"
        condition="working tree · not writable by agents"
        opacity={ramp(frame, 30, 30)}
      />

      {/*
        The project, on the far side. Deliberately inert: no highlight, no animation, no counter.
        The head hash below it is the sequence's evidence, and it is the same eight characters at
        frame 780 as at frame 60.
      */}
      {/*
        Placed to clear the gate's own labelling rather than centred by eye: the condition line
        runs to x≈1560 under the seam and the label to x≈1355 over it, so the plate starts right of
        the label and stops above the condition.
      */}
      <Plate
        x={GATE_X + 130}
        y={LINE_Y - 250}
        width={440}
        height={330}
        title="your project"
        right={<Chip label="clean" tone="pass" />}
        opacity={ramp(frame, 60, 34)}
      >
        <div style={{ padding: `${14 * k}px ${U * k}px`, display: 'grid', gap: 11 * k }}>
          {TREE.map((node) => (
            <div key={node.path} style={{ paddingLeft: node.depth * 16 * k }}>
              <Machine size={SIZE.machineSmall} colour={node.path.endsWith('/') ? INK.faint : INK.muted}>
                {node.path}
              </Machine>
            </div>
          ))}
          <div style={{ marginTop: 6 * k, borderTop: `${Math.max(1, k)}px solid ${INK.hair}`, paddingTop: 12 * k }}>
            <Machine size={SIZE.machineSmall} colour={INK.ghost}>
              head 7c41e0b · 0 files changed
            </Machine>
          </div>
        </div>
      </Plate>
    </Scene>
  );
};

/* ================================================================================================
 * 04 — VERIFICATION · GATE TWO
 *
 * The sequence the film exists for. Five checks pass, the sixth does not, and then nothing happens
 * for four and a half seconds. Holding a frame that still, that long, in a marketing film is the
 * riskiest thing in this project and it is the only way to show what a stop actually feels like.
 * ============================================================================================== */

const VERIFICATION_ENTRIES: readonly Entry[] = [
  { at: 120, event: 'swarm.phase', detail: 'verifying' },
  { at: 210, event: 'check.passed', detail: 'build', tone: 'pass' },
  { at: 330, event: 'check.passed', detail: 'unit', tone: 'pass' },
  { at: 372, event: 'check.failed', detail: 'contract', tone: 'fail' },
  { at: 384, event: 'gate.held', detail: 'change stopped', tone: 'fail' },
  { at: 470, event: 'debugger.claimed', detail: branchFor('debugger', FLEET[5].id) },
  { at: REPAIR_AT, event: 'check.passed', detail: 'contract', tone: 'pass' },
  { at: REPAIR_AT + 14, event: 'gate.released', detail: '6 / 6', tone: 'pass' },
];

export const Verification: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  const failed = frame >= 372 && frame < REPAIR_AT;
  const released = frame >= REPAIR_AT;
  const state = released ? 'open' : failed ? 'holding' : 'closed';
  const since = released ? frame - REPAIR_AT : failed ? frame - 372 : frame;

  /**
   * The object's path. It converges from the five lanes, runs to the seam, and stops dead — not
   * eased to a halt. A change that decelerates into a failing gate looks like it chose to wait.
   */
  const approach = travel(frame, 120, 240);
  const held = GATE_X - 58;
  const through = released ? travel(frame, REPAIR_AT + 18, 150) : 0;
  const x = failed || !released ? 180 + approach * (held - 180) : held + through * 700;

  return (
    <Scene index="04" name="verification" entries={VERIFICATION_ENTRIES} beat="verification">
      {/* The five lanes, converging. They fold into the rail as the object crosses. */}
      {FLEET.filter((agent) => agent.task !== 'standby').map((agent, index) => {
        if (index === 0) return null;
        const merge = travel(frame, 60 + index * 14, 120);
        const y = laneY(index) + (LINE_Y - laneY(index)) * merge;
        return (
          <div
            key={agent.id}
            style={{
              // Right of the checks plate, not under it: the convergence is the point of the shot
              // and a panel drawn on top of it would hide the only thing this geometry says.
              position: 'absolute',
              left: 762 * k,
              top: y * k,
              width: 404 * k,
              height: Math.max(1, 1 * k),
              background: 'rgba(255,255,255,0.07)',
              opacity: (1 - merge) * 0.9,
            }}
          />
        );
      })}

      {/* The checks. */}
      <Plate
        x={104}
        y={LINE_Y - 366}
        width={620}
        height={236}
        title="verification"
        right={
          <Chip
            label={released ? 'passed' : failed ? 'stopped' : 'running'}
            tone={released ? 'pass' : failed ? 'fail' : 'idle'}
          />
        }
        opacity={ramp(frame, 24, 30)}
      >
        <div style={{ padding: `${12 * k}px ${U * k}px`, display: 'grid', gap: 10 * k }}>
          {CHECKS.map((check) => {
            const resolved = frame >= check.at;
            const repaired = check.outcome === 'fail' && frame >= REPAIR_AT;
            const passing = resolved && (check.outcome === 'pass' || repaired);
            const failing = resolved && check.outcome === 'fail' && !repaired;
            const mark = passing ? '✓' : failing ? '✕' : '·';
            const colour = passing ? STATE.pass : failing ? STATE.fail : INK.ghost;
            return (
              <div key={check.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12 * k }}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: SIZE.machine * k,
                    color: colour,
                    width: 14 * k,
                    opacity: resolved ? snap(frame, check.at, 8) : 0.5,
                  }}
                >
                  {mark}
                </span>
                <Machine
                  size={SIZE.machine}
                  colour={failing ? STATE.fail : resolved ? INK.text : INK.faint}
                  weight={failing ? 500 : 400}
                >
                  {check.label}
                </Machine>
                {failing ? (
                  <Machine size={SIZE.machineSmall} colour={INK.faint}>
                    callback shape changed · payments.v2
                  </Machine>
                ) : null}
              </div>
            );
          })}
        </div>
      </Plate>

      {/*
        The debugger. It is not on screen until there is something for it to do, arriving 98 frames
        after the failure — long enough for the stop to have registered as a stop.
      */}
      <At x={104} y={LINE_Y + 44} opacity={hold(frame, { from: 470, rise: 22, stay: 320, fall: 30 })}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 * k }}>
          <RoleLabel role="debugger" id={FLEET[5].id} />
          <Machine size={SIZE.machineSmall} colour={INK.ghost}>
            {branchFor('debugger', FLEET[5].id)}
          </Machine>
          <Machine size={SIZE.machineSmall} colour={frame >= REPAIR_AT ? STATE.pass : STATE.fail}>
            {frame >= REPAIR_AT ? 'contract restored' : 'reproducing'}
          </Machine>
        </div>
      </At>

      <Gate
        state={state}
        since={since}
        label="verification"
        condition={released ? '6 / 6 checks passed' : 'all checks must pass'}
      />

      <Token
        x={x}
        tone={failed ? 'fail' : released ? 'pass' : 'accent'}
        opacity={ramp(frame, 100, 20)}
        trail={approach > 0.02 && approach < 0.98 ? 52 : through > 0.02 ? 64 : 0}
      />

      {/*
        The stop, marked. A single hairline dropped from the object to a short rule beneath it,
        drawn only while the gate is holding. It is the visual equivalent of a full stop and it is
        what keeps four seconds of stillness from reading as a dropped frame.
      */}
      {failed ? (
        <At x={0} y={0} opacity={snap(frame - 372, 20, 24) * breathe(frame, 110, 0.12)}>
          <div
            style={{
              position: 'absolute',
              left: (held - 1) * k,
              top: (LINE_Y + 12) * k,
              width: Math.max(1, 1 * k),
              height: 34 * k,
              background: STATE.failSoft,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: (held - 46) * k,
              top: (LINE_Y + 46) * k,
              width: 92 * k,
              height: Math.max(1, 1 * k),
              background: STATE.fail,
              opacity: 0.6,
            }}
          />
          <div style={{ position: 'absolute', left: (held - 46) * k, top: (LINE_Y + 58) * k }}>
            <Machine size={SIZE.machineSmall} colour={STATE.fail}>
              held
            </Machine>
          </div>
        </At>
      ) : null}
    </Scene>
  );
};

/* ================================================================================================
 * 05 — CONSENT · GATE THREE
 *
 * The review, and the four seconds of nothing before a person arrives. The control is deliberately
 * unremarkable — a small outlined button with three words in it. The film's one chance to overstate
 * itself is here, and the way it is refused is by making the most important interaction in the
 * product look exactly as ordinary as it is.
 * ============================================================================================== */

const CONSENT_ENTRIES: readonly Entry[] = [
  { at: 60, event: 'swarm.status', detail: 'ready_for_review' },
  { at: 130, event: 'review.assembled', detail: '4 changed · 3 untouched' },
  { at: 240, event: 'swarm.status', detail: 'decision_required', tone: 'accent' },
  { at: 566, event: 'human.approved', detail: 'you', tone: 'pass' },
  { at: 580, event: 'gate.released', detail: 'consent', tone: 'pass' },
];

/** The cursor's path. It arrives from off the bottom right, which is where a hand comes from. */
const CURSOR_FROM = { x: 1720, y: 980 };
const CURSOR_TO = { x: 1052, y: LINE_Y + 66 };
const CLICK_AT = 566;

export const Consent: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  const approved = frame >= CLICK_AT;
  const arrive = travel(frame, 470, 84);
  const cursorX = CURSOR_FROM.x + (CURSOR_TO.x - CURSOR_FROM.x) * arrive;
  const cursorY = CURSOR_FROM.y + (CURSOR_TO.y - CURSOR_FROM.y) * arrive;
  const pressed = frame >= CLICK_AT - 6 && frame < CLICK_AT + 8 ? 1 : 0;

  const through = approved ? travel(frame, CLICK_AT + 20, 130) : 0;
  const x = GATE_X - 58 + through * 700;

  return (
    <Scene index="05" name="consent" entries={CONSENT_ENTRIES} beat="consent">
      {/* What changed, and what was deliberately left alone. */}
      <Plate x={104} y={LINE_Y - 386} width={1042} height={252} title="review"
        right={<Chip label={approved ? 'approved' : 'decision required'} tone={approved ? 'pass' : 'accent'} />}
        opacity={ramp(frame, 30, 34)}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ flex: '1 1 58%', padding: `${14 * k}px ${U * k}px`, display: 'grid', gap: 12 * k, alignContent: 'start' }}>
            <Machine size={SIZE.machineSmall} colour={INK.faint} style={{ letterSpacing: TRACK.station, textTransform: 'uppercase' }}>
              changed
            </Machine>
            {REVIEW.changed.map((file, index) => (
              <div key={file.path} style={{ display: 'flex', alignItems: 'baseline', gap: 12 * k, opacity: ramp(frame, 130 + index * 14, 20) }}>
                <Machine size={SIZE.machineSmall} colour={INK.text}>
                  {file.path}
                </Machine>
                <Machine size={SIZE.machineSmall} colour={STATE.pass}>
                  +{file.added}
                </Machine>
                <Machine size={SIZE.machineSmall} colour={INK.faint}>
                  −{file.removed}
                </Machine>
              </div>
            ))}
          </div>

          <div style={{ width: Math.max(1, k), background: INK.hair }} />

          <div style={{ flex: '1 1 42%', padding: `${14 * k}px ${U * k}px`, display: 'grid', gap: 12 * k, alignContent: 'start' }}>
            <Machine size={SIZE.machineSmall} colour={INK.faint} style={{ letterSpacing: TRACK.station, textTransform: 'uppercase' }}>
              left alone
            </Machine>
            {REVIEW.untouched.map((file, index) => (
              <div key={file.path} style={{ opacity: ramp(frame, 200 + index * 16, 20) }}>
                <Machine size={SIZE.machineSmall} colour={INK.muted}>
                  {file.path}
                </Machine>
                <div style={{ marginTop: 3 * k }}>
                  <Machine size={SIZE.machineSmall} colour={INK.ghost}>
                    {file.why}
                  </Machine>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Plate>

      {/* The control. Three words, one hairline border, and no colour until it has been used. */}
      <At x={982} y={LINE_Y + 40} opacity={ramp(frame, 240, 30)}>
        <div
          style={{
            padding: `${9 * k}px ${16 * k}px`,
            border: `${Math.max(1, k)}px solid ${approved ? STATE.pass : INK.edge}`,
            borderRadius: RADIUS * k,
            background: approved ? STATE.passSoft : 'rgba(255,255,255,0.03)',
            transform: `scale(${1 - pressed * 0.03})`,
          }}
        >
          <Machine
            size={SIZE.machineSmall}
            colour={approved ? STATE.pass : INK.text}
            weight={500}
            style={{ letterSpacing: TRACK.station, textTransform: 'uppercase' }}
          >
            let it through
          </Machine>
        </div>
      </At>

      <Gate
        state={approved ? 'open' : 'closed'}
        since={approved ? frame - CLICK_AT - 8 : frame}
        label="consent"
        condition={approved ? 'approved by you' : 'requires a person'}
      />

      <Token x={x} tone={approved ? 'pass' : 'accent'} opacity={ramp(frame, 40, 24)} trail={through > 0.02 ? 64 : 0} />

      <Click x={CURSOR_TO.x + 6} y={CURSOR_TO.y + 10} since={frame - CLICK_AT} />
      <Cursor x={cursorX} y={cursorY} opacity={hold(frame, { from: 462, rise: 14, stay: 240, fall: 40 })} pressed={pressed} />
    </Scene>
  );
};

/* ================================================================================================
 * 06 — THROUGH
 *
 * The landing, and the only sequence in which the camera itself moves — the ties drift, so the
 * frame is travelling with the object rather than watching it pass. Eight seconds, one event.
 * ============================================================================================== */

const THROUGH_ENTRIES: readonly Entry[] = [
  { at: 60, event: 'integrator.assembled', detail: '4 files' },
  { at: 210, event: 'merge.completed', detail: 'main', tone: 'pass' },
  { at: 300, event: 'record.sealed', detail: `swarm ${SWARM_ID} · 6 attempts · 6 checks` },
];

export const Through: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();

  const run = travel(frame, 20, 200);
  const x = 180 + run * 1080;
  const landed = frame >= 210;

  return (
    <Scene index="06" name="landed" entries={THROUGH_ENTRIES} beat="through" tieSpeed={1} railLit={ramp(frame, 20, 120) * 0.5}>
      {/*
        The branch graph. `main` is the horizontal at the rail's own height and the swarm branches
        arrive into it from above — so the object is not landing on a new surface, it is landing on
        the line it has been travelling this whole time.
      */}
      {FLEET.filter((agent) => agent.task !== 'standby').map((agent, index) => {
        if (index === 0) return null;
        const y = laneY(index);
        /**
         * Ninety per cent of the way, not all of it. An earlier version drove `converge` to 1 and
         * faded the lanes out as they arrived, which meant that by the frame the commit landed
         * there was nothing on screen but a single square — the payoff shot was the emptiest in
         * the film. Stopping short leaves a visible funnel feeding the node.
         */
        const converge = travel(frame, 40 + index * 12, 170) * 0.9;
        const left = 1180 + index * 22;
        return (
          <div
            key={agent.id}
            style={{
              position: 'absolute',
              left: left * k,
              top: (y + (LINE_Y - y) * converge) * k,
              width: (1466 - left) * k,
              height: Math.max(1, 1 * k),
              background: 'rgba(255,255,255,0.09)',
              opacity: 0.25 + converge * 0.4,
            }}
          />
        );
      })}

      <At x={1300} y={LINE_Y - 116} opacity={ramp(frame, 150, 30)}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 * k }}>
          <Machine size={SIZE.machineSmall} colour={INK.faint} style={{ letterSpacing: TRACK.station, textTransform: 'uppercase' }}>
            main
          </Machine>
          <Machine size={SIZE.machineSmall} colour={landed ? STATE.pass : INK.ghost}>
            {landed ? 'e91d34a · merged' : 'awaiting'}
          </Machine>
        </div>
      </At>

      {/* The commit node. The one moment in the film where the object stops being a moving thing. */}
      <Token
        x={landed ? 1466 : x}
        tone={landed ? 'pass' : 'accent'}
        size={landed ? 15 : 13}
        trail={landed ? 0 : 70}
      />
      {landed ? (
        <At x={0} y={0} opacity={snap(frame, 210, 22)}>
          <div
            style={{
              position: 'absolute',
              left: (1466 - 22) * k,
              top: (LINE_Y - 22) * k,
              width: 44 * k,
              height: 44 * k,
              border: `${Math.max(1, k)}px solid rgba(134,239,172,0.35)`,
              borderRadius: RADIUS * k,
            }}
          />
        </At>
      ) : null}

      {/*
        The record.
        
        The film's closing argument, and the only place it is ever stated as a list: everything the
        previous five sequences did is still attached to the task after the change has landed. Each
        row is a count of something the viewer watched happen, including the failure — a record that
        quietly drops the one check that failed would be the exact dishonesty this film is about.
      */}
      <Plate
        x={104}
        y={LINE_Y - 296}
        width={604}
        height={212}
        title={`record · swarm ${SWARM_ID}`}
        right={<Chip label="sealed" tone="pass" />}
        opacity={ramp(frame, 96, 34)}
      >
        <div style={{ padding: `${13 * k}px ${U * k}px`, display: 'grid', gap: 11 * k }}>
          {[
            ['task', 'retire the legacy billing webhook'],
            ['agents', '6 · one branch each'],
            ['checks', '6 · 1 failed · 1 repaired'],
            ['approvals', '1 · you'],
            ['landed', 'e91d34a → main'],
          ].map(([label, value], index) => (
            <div key={label} style={{ display: 'flex', gap: 12 * k, opacity: ramp(frame, 110 + index * 12, 20) }}>
              <span style={{ display: 'inline-block', width: 96 * k }}>
                <Machine size={SIZE.machineSmall} colour={INK.faint}
                  style={{ letterSpacing: TRACK.station, textTransform: 'uppercase' }}>
                  {label}
                </Machine>
              </span>
              <Machine size={SIZE.machineSmall} colour={index === 4 && landed ? STATE.pass : INK.text}>
                {value}
              </Machine>
            </div>
          ))}
        </div>
      </Plate>
    </Scene>
  );
};

/* ================================================================================================
 * 07 — CLOSE
 *
 * The rail terminates. It draws in from both edges to a short segment under the lockup and stops —
 * the only place in the film where the line ends, because it is the only place where the work has.
 * ============================================================================================== */

export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const k = useScale();
  const { k: copyK, portrait } = useCopyScale();
  const box = useFrameBox();

  /** The rail closes in over 90 frames from a full-width line to a 420px segment. */
  const close = travel(frame, 40, 96);
  const span = 2400 - close * 1980;

  const mark = ramp(frame, 120, 34);
  /** The statement rises and then stays for the rest of the film; it never leaves, so it ramps. */
  const statement = ramp(frame, 196, 26);
  /**
   * At 392 the company and domain arrived three and a half seconds after the title, which is a long
   * time to hold a frame that is finished, and it put them outside every derived cut's endcard. At
   * 300 they settle with the rest of the card and the thirty-second cut can still hold them.
   */
  const fine = ramp(frame, 300, 40);

  const centre = box.height / 2;

  return (
    <AbsoluteFill style={{ background: INK.field }}>
      <World>
        {/* The terminating rail. */}
        <div
          style={{
            position: 'absolute',
            left: (960 - span / 2) * k,
            top: LINE_Y * k,
            width: span * k,
            height: Math.max(1, 1 * k),
            // Brighter than the rail carries anywhere else in the film. This is the one frame where
            // the line is the subject rather than the surface, and at the running value it read as
            // a scratch on the endcard instead of as the thing the film has been travelling.
            background: `linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 18%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.28) 82%, rgba(255,255,255,0) 100%)`,
            opacity: 1 - ramp(frame, 430, 120) * 0.45,
          }}
        />
        {/* The object, at rest at the centre of it. */}
        <Token x={960} size={11} tone="pass" opacity={(1 - ramp(frame, 150, 40)) * 0.9} />
      </World>

      {/* The lockup, above the line. */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start' }}>
        <div
          style={{
            position: 'absolute',
            top: (centre - (portrait ? 210 : 178)) * k,
            display: 'flex',
            alignItems: 'center',
            gap: 26 * k,
            opacity: mark,
            transform: `translateY(${(1 - mark) * 10 * k}px)`,
          }}
        >
          <Img src={staticFile('brand/mark.png')} style={{ width: 92 * k }} />
          <Img src={staticFile('brand/wordmark.png')} style={{ width: 372 * k, maxWidth: 'none' }} />
        </div>

        {/* The category line, set in the mark's own letterspacing. */}
        <div
          style={{
            position: 'absolute',
            top: (centre - (portrait ? 96 : 74)) * k,
            opacity: mark * 0.9,
            fontFamily: DISPLAY,
            fontSize: SIZE.category * k,
            letterSpacing: TRACK.category,
            textTransform: 'uppercase',
            color: INK.muted,
            textAlign: 'center',
          }}
        >
          {CLOSE.category}
        </div>

        {/* The film's title, under the line it spent seventy-eight seconds drawing. */}
        <div
          style={{
            position: 'absolute',
            top: (centre + (portrait ? 128 : 96)) * k,
            opacity: statement,
            transform: `translateY(${(1 - statement) * 12 * k}px)`,
            fontFamily: DISPLAY,
            fontSize: SIZE.statement * copyK,
            fontWeight: WEIGHT.statement,
            letterSpacing: TRACK.statement,
            lineHeight: LEADING.display,
            color: INK.bright,
            textAlign: 'center',
          }}
        >
          {CLOSE.statement}
        </div>

        <div
          style={{
            position: 'absolute',
            top: (centre + (portrait ? 268 : 216)) * k,
            opacity: fine,
            display: 'grid',
            gap: 12 * k,
            justifyItems: 'center',
            fontFamily: DISPLAY,
            fontSize: SIZE.fine * k,
            letterSpacing: TRACK.fine,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: INK.faint }}>{CLOSE.company}</span>
          <span style={{ color: INK.ghost }}>{CLOSE.url}</span>
        </div>
      </AbsoluteFill>

      <Copy beat="close" />
    </AbsoluteFill>
  );
};
