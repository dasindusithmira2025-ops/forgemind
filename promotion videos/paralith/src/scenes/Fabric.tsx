import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, MONO } from "../lib/theme";
import { EASE_OUT, ramp } from "../lib/anim";
import { Headline, Label, Sub } from "../lib/type";

type Node = { x: number; y: number; type: string; name: string; color: string; at: number };

const NODES: Node[] = [
  { x: 470, y: 402, type: "task", name: "restore sessions", color: C.success, at: 60 },
  { x: 470, y: 646, type: "run", name: "AgentRun 4f2", color: C.accent, at: 74 },
  { x: 762, y: 782, type: "command", name: "cargo test", color: C.muted, at: 96 },
  { x: 786, y: 520, type: "artifact", name: "test report", color: C.ready, at: 110 },
  { x: 1092, y: 386, type: "source", name: "runtime.rs:214", color: C.warning, at: 130 },
  { x: 1096, y: 648, type: "claim", name: "resize is debounced", color: C.agent, at: 150 },
  { x: 1420, y: 496, type: "entity", name: "PTY lifecycle", color: C.text2, at: 172 },
  { x: 1420, y: 786, type: "commit", name: "a4e43f3", color: C.accent, at: 190 },
];

const EDGES: { a: number; b: number; label: string; at: number }[] = [
  { a: 0, b: 1, label: "executed_by", at: 96 },
  { a: 1, b: 2, label: "ran", at: 118 },
  { a: 1, b: 3, label: "emitted", at: 132 },
  { a: 3, b: 4, label: "cites", at: 152 },
  { a: 4, b: 5, label: "supports", at: 172 },
  { a: 5, b: 6, label: "about", at: 192 },
  { a: 3, b: 7, label: "landed_in", at: 208 },
  { a: 5, b: 7, label: "evidenced_by", at: 222 },
];

/** The provenance walk that gets spotlit at the end of the scene. */
const CHAIN = [6, 5, 4, 3, 1];
const CHAIN_EDGES = [5, 4, 3, 2];

export const Fabric: React.FC = () => {
  const f = useCurrentFrame();
  const walk = ramp(f, 262, 120, EASE_OUT) * CHAIN.length;
  const spotlight = ramp(f, 262, 60);

  const isHot = (i: number) => {
    const k = CHAIN.indexOf(i);
    return k >= 0 && walk > k ? Math.min(1, walk - k) : 0;
  };
  const edgeHot = (i: number) => {
    const k = CHAIN_EDGES.indexOf(i);
    return k >= 0 && walk > k + 0.5 ? Math.min(1, walk - k - 0.5) : 0;
  };

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 132, top: 146 }}>
        <Label start={6} color={C.agent}>
          Context Fabric
        </Label>
        <div style={{ height: 30 }} />
        <Headline start={18} size={56} lines={["Typed knowledge,", "with provenance."]} />
      </div>

      <div style={{ position: "absolute", right: 132, top: 158, width: 560, textAlign: "right" }}>
        <Sub start={110} maxWidth={560} size={23} align="left">
          Entities, claims, sources, runs and artifacts — linked, deduplicated
          and dated. Not a pile of transcripts you hope contains the answer.
        </Sub>
      </div>

      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: "absolute" }}>
        {EDGES.map((e, i) => {
          const p = ramp(f, e.at, 34, EASE_OUT);
          const A = NODES[e.a];
          const B = NODES[e.b];
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          const pad = 96;
          const x1 = A.x + ux * pad;
          const y1 = A.y + uy * pad * 0.55;
          const x2 = B.x - ux * pad;
          const y2 = B.y - uy * pad * 0.55;
          const hot = edgeHot(i);
          const dim = 1 - spotlight * 0.72 * (hot > 0 ? 0 : 1);
          return (
            <g key={i} opacity={p * dim}>
              <line
                x1={x1}
                y1={y1}
                x2={x1 + (x2 - x1) * p}
                y2={y1 + (y2 - y1) * p}
                stroke={hot > 0 ? C.cyan : "rgba(255,255,255,0.17)"}
                strokeWidth={hot > 0 ? 2.4 : 1.4}
                style={{ filter: hot > 0 ? "drop-shadow(0 0 8px " + C.cyan + "aa)" : undefined }}
              />
              <text
                x={(x1 + x2) / 2 - uy * 20}
                y={(y1 + y2) / 2 + ux * 20 - 4}
                fill={hot > 0 ? C.cyan : C.faint}
                fontFamily={MONO}
                fontSize={14}
                textAnchor="middle"
                opacity={p}
                letterSpacing="0.06em"
              >
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>

      {NODES.map((n, i) => {
        const p = ramp(f, n.at, 30, EASE_OUT);
        const hot = isHot(i);
        const dim = 1 - spotlight * 0.62 * (hot > 0 ? 0 : 1);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: n.x - 108,
              top: n.y - 34,
              width: 216,
              opacity: p * dim,
              transform: "translateY(" + (1 - p) * 16 + "px) scale(" + (0.94 + p * 0.06 + hot * 0.04) + ")",
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 13,
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                color: hot > 0 ? n.color : C.faint,
                marginBottom: 8,
                textAlign: "center",
              }}
            >
              {n.type}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "13px 16px",
                borderRadius: 8,
                border: "1px solid " + n.color + (hot > 0 ? "aa" : "40"),
                background: "linear-gradient(180deg, " + C.s2 + ", " + C.s1 + ")",
                boxShadow: hot > 0 ? "0 0 34px -8px " + n.color + "cc" : "0 14px 40px -26px #000",
                fontFamily: MONO,
                fontSize: 16,
                color: hot > 0 ? C.text : C.text2,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 7,
                  background: n.color,
                  boxShadow: hot > 0 ? "0 0 10px " + n.color : "none",
                  flexShrink: 0,
                }}
              />
              {n.name}
            </div>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: 132,
          top: 942,
          fontFamily: MONO,
          fontSize: 17,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.text2,
          opacity: ramp(f, 352, 44),
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span style={{ color: C.cyan }}>trace any claim</span>
        <span style={{ color: C.faint }}>→</span>
        <span>source</span>
        <span style={{ color: C.faint }}>→</span>
        <span>artifact</span>
        <span style={{ color: C.faint }}>→</span>
        <span>the run that produced it</span>
      </div>
    </AbsoluteFill>
  );
};
