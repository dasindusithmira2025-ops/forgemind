import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, MONO } from "../lib/theme";
import { EASE_OUT, clamp01, ramp } from "../lib/anim";
import { Headline, Label, Sub } from "../lib/type";
import { Dot } from "../lib/ui";

const MAIN_X = 250;
const BR_X = 372;
const COMMITS = [
  { y: 268, lane: 0, hash: "b82a8e0", msg: "feat: ship context fabric workspace" },
  { y: 372, lane: 0, hash: "ba26c48", msg: "feat: analytics workspace surfaces" },
  { y: 470, lane: 1, hash: "9664276", msg: "refactor: centralize usage refresh" },
  { y: 568, lane: 1, hash: "a4e43f3", msg: "fix: preserve terminal input on detach" },
  { y: 672, lane: 0, hash: "675b6d5", msg: "merge: agent session resume" },
  { y: 776, lane: 0, hash: "4f21c9d", msg: "release: prepare stable build" },
];

const CHECKS = [
  { name: "typecheck", at: 250 },
  { name: "clippy -D warnings", at: 276 },
  { name: "cargo test", at: 302 },
  { name: "vitest run", at: 328 },
];

export const Repository: React.FC = () => {
  const f = useCurrentFrame();
  const spine = ramp(f, 40, 80, EASE_OUT);
  const branch = ramp(f, 96, 70, EASE_OUT);

  return (
    <AbsoluteFill>
      <svg width={1100} height={1080} viewBox="0 0 1100 1080" style={{ position: "absolute", left: 150 }}>
        <line
          x1={MAIN_X}
          y1={240}
          x2={MAIN_X}
          y2={240 + (830 - 240) * spine}
          stroke={C.lineStrong}
          strokeWidth={2}
        />
        <path
          d={
            "M " + MAIN_X + " 372 C " + (MAIN_X + 54) + " 372, " + BR_X + " 400, " + BR_X +
            " 452 L " + BR_X + " 592 C " + BR_X + " 640, " + (MAIN_X + 54) + " 648, " + MAIN_X + " 672"
          }
          fill="none"
          stroke={C.agent + "99"}
          strokeWidth={2}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - branch}
        />
        {COMMITS.map((c, i) => {
          const p = ramp(f, 62 + i * 22, 32, EASE_OUT);
          const x = c.lane === 0 ? MAIN_X : BR_X;
          const col = c.lane === 0 ? C.accent : C.agent;
          return (
            <g key={i} opacity={p}>
              <circle cx={x} cy={c.y} r={11 * p} fill={C.deep} stroke={col} strokeWidth={2.2} />
              <circle cx={x} cy={c.y} r={4 * p} fill={col} />
              <text x={BR_X + 74} y={c.y - 4} fill={C.text2} fontFamily={MONO} fontSize={17}>
                {c.hash}
              </text>
              <text x={BR_X + 74} y={c.y + 22} fill={C.faint} fontFamily={MONO} fontSize={15}>
                {c.msg}
              </text>
            </g>
          );
        })}
        <text
          x={MAIN_X - 26}
          y={232}
          fill={C.muted}
          fontFamily={MONO}
          fontSize={15}
          letterSpacing="0.2em"
          opacity={spine}
        >
          MAIN
        </text>
      </svg>

      <div style={{ position: "absolute", left: 1136, top: 268, width: 690 }}>
        <Label start={6}>Repository</Label>
        <div style={{ height: 30 }} />
        <Headline
          start={20}
          size={56}
          lines={["Branches, diffs, commits", "and checks — in place."]}
        />
        <div style={{ height: 34 }} />
        <Sub start={150} maxWidth={640}>
          Review the working tree, stage, commit and watch validation without
          leaving the environment or trusting a summary of what happened.
        </Sub>

        <div style={{ height: 52 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {CHECKS.map((c, i) => {
            const enter = ramp(f, c.at, 30, EASE_OUT);
            const run = ramp(f, c.at + 24, 62, EASE_OUT);
            const pass = clamp01((run - 0.98) / 0.02);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity: enter,
                  transform: "translateX(" + (1 - enter) * 20 + "px)",
                }}
              >
                <Dot color={pass ? C.success : C.warning} pulse={pass ? 0 : 0.5} />
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 17,
                    color: pass ? C.text2 : C.muted,
                    width: 230,
                    letterSpacing: "0.04em",
                  }}
                >
                  {c.name}
                </span>
                <span
                  style={{
                    flex: 1,
                    height: 3,
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.07)",
                    overflow: "hidden",
                    maxWidth: 260,
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: run * 100 + "%",
                      background: pass ? C.success : C.accent,
                      boxShadow: "0 0 12px " + (pass ? C.success : C.accent),
                    }}
                  />
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 15,
                    color: pass ? C.success : C.faint,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    width: 90,
                  }}
                >
                  {pass ? "passed" : "running"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
