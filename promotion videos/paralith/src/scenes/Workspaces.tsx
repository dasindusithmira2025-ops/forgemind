import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../lib/theme";
import { EASE_IN_OUT, EASE_OUT, clamp01, ramp, rand } from "../lib/anim";
import { Headline, Label, Sub } from "../lib/type";
import { Dot, Panel } from "../lib/ui";

const STAGE = { x: 792, y: 208, w: 1000, h: 664 };

type Rect = { x: number; y: number; w: number; h: number };
type Key = { at: number; r: Rect };

const rectAt = (keys: Key[], f: number): Rect => {
  const pick = (k: keyof Rect) =>
    interpolate(
      f,
      keys.map((v) => v.at),
      keys.map((v) => v.r[k]),
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT },
    );
  return { x: pick("x"), y: pick("y"), w: pick("w"), h: pick("h") };
};

/** Abstract source lines: the shape and rhythm of code, never a screenshot. */
const CodeBody: React.FC<{ start: number; rows?: number; seed?: number }> = ({
  start,
  rows = 12,
  seed = 3,
}) => {
  const f = useCurrentFrame();
  return (
    <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
      {Array.from({ length: rows }).map((_, i) => {
        const p = ramp(f, start + i * 3.5, 26, EASE_OUT);
        const indent = Math.floor(rand(seed + i) * 3) * 22;
        const w = 90 + rand(seed + i * 7) * 190;
        const isKey = rand(seed + i * 13) > 0.72;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, opacity: p }}>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 12,
                color: C.faint,
                width: 20,
                textAlign: "right",
              }}
            >
              {i + 1}
            </span>
            <span style={{ width: indent }} />
            <span
              style={{
                height: 8,
                width: w * p,
                borderRadius: 3,
                background: isKey ? C.accent + "88" : "rgba(255,255,255,0.14)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

const TERMINAL_LINES = [
  "$ cargo test -p paralith-core",
  "  running 6 suites",
  "  session::restore .......... ok",
  "  pty::resize ............... ok",
  "  guard::project_scope ...... ok",
  "$ agent attach --session 4f2",
  "  attached, streaming",
];

const TerminalBody: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  const shown = clamp01(ramp(f, start, 150, EASE_OUT)) * TERMINAL_LINES.length;
  const cursorOn = Math.floor(f / 24) % 2 === 0;
  return (
    <div style={{ padding: "16px 18px", fontFamily: MONO, fontSize: 15.5, lineHeight: 1.85 }}>
      {TERMINAL_LINES.map((l, i) => {
        const p = clamp01(shown - i);
        const chars = Math.floor(p * l.length);
        return (
          <div
            key={i}
            style={{
              color: l.charAt(0) === "$" ? C.text2 : C.muted,
              whiteSpace: "pre",
              opacity: p > 0 ? 1 : 0,
            }}
          >
            {l.slice(0, chars)}
          </div>
        );
      })}
      <span
        style={{
          display: "inline-block",
          width: 9,
          height: 18,
          marginTop: 4,
          background: cursorOn ? C.ready : "transparent",
          boxShadow: cursorOn ? "0 0 10px " + C.ready : "none",
        }}
      />
    </div>
  );
};

const DiffBody: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
      {Array.from({ length: 8 }).map((_, i) => {
        const p = ramp(f, start + i * 4, 24, EASE_OUT);
        const add = rand(i * 5 + 1) > 0.4;
        const w = 70 + rand(i * 3 + 2) * 150;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, opacity: p }}>
            <span
              style={{ fontFamily: MONO, fontSize: 13, color: add ? C.success : C.danger, width: 10 }}
            >
              {add ? "+" : "-"}
            </span>
            <span
              style={{
                height: 7,
                width: w * p,
                borderRadius: 3,
                background: add ? C.success + "66" : C.danger + "55",
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

const GRAPH_NODES: [number, number][] = [
  [56, 60],
  [176, 36],
  [176, 96],
  [292, 62],
  [110, 140],
  [242, 146],
];
const GRAPH_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [0, 4],
  [4, 5],
  [5, 3],
];

const GraphBody: React.FC<{ start: number }> = ({ start }) => {
  const f = useCurrentFrame();
  return (
    <svg width="100%" height="100%" viewBox="0 0 360 200">
      {GRAPH_EDGES.map(([a, b], i) => {
        const p = ramp(f, start + 16 + i * 6, 26, EASE_OUT);
        const [ax, ay] = GRAPH_NODES[a];
        const [bx, by] = GRAPH_NODES[b];
        return (
          <line
            key={i}
            x1={ax}
            y1={ay}
            x2={ax + (bx - ax) * p}
            y2={ay + (by - ay) * p}
            stroke={C.agent + "77"}
            strokeWidth={1.4}
          />
        );
      })}
      {GRAPH_NODES.map(([x, y], i) => {
        const p = ramp(f, start + i * 6, 24, EASE_OUT);
        return (
          <g key={i} opacity={p}>
            <circle cx={x} cy={y} r={7 * p} fill={C.deep} stroke={C.agent} strokeWidth={1.6} />
            <circle cx={x} cy={y} r={2.6 * p} fill={C.agent} />
          </g>
        );
      })}
    </svg>
  );
};

export const Workspaces: React.FC = () => {
  const f = useCurrentFrame();

  const a = rectAt(
    [
      { at: 46, r: { x: 0, y: 0, w: 1000, h: 664 } },
      { at: 116, r: { x: 0, y: 0, w: 490, h: 664 } },
      { at: 252, r: { x: 0, y: 0, w: 490, h: 400 } },
    ],
    f,
  );
  const b = rectAt(
    [
      { at: 116, r: { x: 510, y: 0, w: 490, h: 664 } },
      { at: 186, r: { x: 510, y: 0, w: 490, h: 322 } },
    ],
    f,
  );
  const c = { x: 510, y: 342, w: 490, h: 322 };
  const d = { x: 0, y: 420, w: 490, h: 244 };

  const detach = ramp(f, 306, 66, EASE_IN_OUT);
  const cEnter = ramp(f, 186, 40, EASE_OUT);

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 132, top: 322, width: 600 }}>
        <Label start={6}>Workspaces</Label>
        <div style={{ height: 32 }} />
        <Headline start={20} size={58} lines={["Split it.", "Nest it.", "Detach it."]} />
        <div style={{ height: 36 }} />
        <Sub start={210} maxWidth={560}>
          Recursive layouts of terminals, editors, diffs and graphs — saved per
          project, moved across monitors, restored when the app comes back.
        </Sub>
      </div>

      <div
        style={{
          position: "absolute",
          left: STAGE.x,
          top: STAGE.y,
          width: STAGE.w,
          height: STAGE.h,
        }}
      >
        <Panel
          x={a.x}
          y={a.y}
          w={a.w}
          h={a.h}
          p={ramp(f, 46, 40, EASE_OUT)}
          title="terminal · main"
          accent={C.ready}
          active
        >
          <TerminalBody start={70} />
        </Panel>

        <Panel
          x={b.x}
          y={b.y}
          w={b.w}
          h={b.h}
          p={ramp(f, 116, 40, EASE_OUT)}
          title="editor · runtime.rs"
          accent={C.accent}
        >
          <CodeBody start={140} rows={7} seed={11} />
        </Panel>

        {detach > 0.05 ? (
          <div
            style={{
              position: "absolute",
              left: c.x,
              top: c.y,
              width: c.w,
              height: c.h,
              border: "1px dashed " + C.lineStrong,
              borderRadius: 8,
              opacity: detach * 0.85,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: MONO,
              fontSize: 14,
              letterSpacing: "0.18em",
              color: C.faint,
              textTransform: "uppercase",
            }}
          >
            detached → window 2
          </div>
        ) : null}

        <Panel
          x={c.x - detach * 302}
          y={c.y - detach * 198}
          w={c.w}
          h={c.h}
          p={cEnter}
          title={detach > 0.45 ? "memory · window 2" : "memory · graph"}
          accent={C.agent}
          active={detach > 0.2}
          style={{
            transform:
              "translateY(" + (1 - cEnter) * 22 + "px) scale(" + (1 + detach * 0.1) + ")",
            zIndex: 5,
            boxShadow:
              "0 0 0 1px " +
              C.agent +
              (detach > 0.5 ? "55" : "18") +
              ", 0 " +
              30 * detach +
              "px " +
              90 * detach +
              "px -" +
              22 * detach +
              "px rgba(0,0,0,0.95)",
          }}
        >
          <GraphBody start={214} />
        </Panel>

        <Panel
          x={d.x}
          y={d.y}
          w={d.w}
          h={d.h}
          p={ramp(f, 252, 40, EASE_OUT)}
          title="diff · 4 files"
          accent={C.success}
        >
          <DiffBody start={276} />
        </Panel>

        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: -48,
            display: "flex",
            gap: 26,
            alignItems: "center",
            opacity: ramp(f, 312, 40),
            fontFamily: MONO,
            fontSize: 14,
            letterSpacing: "0.12em",
            color: C.muted,
            textTransform: "uppercase",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Dot color={C.ready} pulse={0.5} /> processes owned by rust
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Dot color={C.success} /> layout persisted
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
