import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../lib/theme";
import { EASE_IN_OUT, EASE_OUT, ramp } from "../lib/anim";
import { Headline, Hot, Label, Sub } from "../lib/type";

const LINES: { x1: number; y1: number; x2: number; y2: number; at: number }[] = [
  { x1: 320, y1: 252, x2: 1600, y2: 252, at: 54 },
  { x1: 596, y1: 180, x2: 596, y2: 900, at: 66 },
  { x1: 596, y1: 596, x2: 1600, y2: 596, at: 80 },
  { x1: 1156, y1: 596, x2: 1156, y2: 900, at: 94 },
  { x1: 1156, y1: 252, x2: 1156, y2: 596, at: 108 },
];

export const Thesis: React.FC = () => {
  const f = useCurrentFrame();
  const frameP = ramp(f, 8, 74, EASE_OUT);
  const settleDim = 1 - ramp(f, 108, 60, EASE_IN_OUT) * 0.45;

  return (
    <AbsoluteFill>
      {/* the environment, drawn as structure */}
      <svg
        width={1920}
        height={1080}
        viewBox="0 0 1920 1080"
        style={{ position: "absolute", opacity: 0.85 * settleDim }}
      >
        <rect
          x={320}
          y={180}
          width={1280}
          height={720}
          rx={16}
          fill="none"
          stroke={C.lineStrong}
          strokeWidth={1.5}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - frameP}
        />
        {LINES.map((l, i) => {
          const p = ramp(f, l.at, 40, EASE_OUT);
          return (
            <line
              key={i}
              x1={l.x1}
              y1={l.y1}
              x2={l.x1 + (l.x2 - l.x1) * p}
              y2={l.y1 + (l.y2 - l.y1) * p}
              stroke={C.lineStrong}
              strokeWidth={1.5}
            />
          );
        })}
        {[0, 1, 2, 3, 4].map((i) => {
          const p = ramp(f, 70 + i * 9, 34, EASE_OUT);
          return (
            <rect
              key={i}
              x={352}
              y={292 + i * 54}
              width={28}
              height={28}
              rx={6}
              fill="none"
              stroke={i === 0 ? C.accent : C.lineStrong}
              strokeWidth={1.5}
              opacity={p}
            />
          );
        })}
      </svg>

      {/* scrim so the statement owns the frame */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(58% 44% at 50% 52%, rgba(5,7,11,0.94) 0%, rgba(5,7,11,0.7) 52%, rgba(5,7,11,0) 84%)",
          opacity: ramp(f, 70, 44),
        }}
      />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <Label start={78}>Paralith</Label>
        <div style={{ height: 40 }} />
        <Headline
          start={96}
          size={76}
          align="center"
          lines={[
            "An operating environment for",
            <>
              software <Hot>engineering agents</Hot>.
            </>,
          ]}
        />
        <div style={{ height: 44 }} />
        <Sub start={186} align="center" maxWidth={860} size={26}>
          Not a chat window bolted onto an editor. A native desktop workspace
          where agents, terminals, repositories and knowledge live in one system.
        </Sub>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
