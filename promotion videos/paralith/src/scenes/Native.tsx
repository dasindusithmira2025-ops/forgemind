import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, MONO } from "../lib/theme";
import { EASE_IN_OUT, EASE_OUT, ramp } from "../lib/anim";
import { Headline, Label, Sub } from "../lib/type";

const LAYERS = [
  { title: "renderer", detail: "React · TypeScript · xterm.js", color: C.accent },
  { title: "typed ipc", detail: "validated commands · structured errors", color: C.cyan },
  { title: "rust services", detail: "pty · path guard · git · agent runtime", color: C.violet },
  { title: "sqlite", detail: "workspaces · sessions · knowledge", color: C.ready },
  { title: "windows", detail: "native shell · signed updates", color: C.muted },
];

const X = 1010;
const W = 780;
const H = 104;
const GAP = 20;
const TOP = 268;

export const Native: React.FC = () => {
  const f = useCurrentFrame();

  // a signal falls through the stack, twice
  const cycle = ((f - 214) % 150) / 150;
  const beamY = TOP - 120 + cycle * (LAYERS.length * (H + GAP) + 200);
  const beamOn = f > 214 ? 1 : 0;

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 132, top: 340, width: 720 }}>
        <Label start={6} color={C.ready}>
          Native
        </Label>
        <div style={{ height: 32 }} />
        <Headline start={18} size={58} lines={["Rust underneath.", "Durable by default."]} />
        <div style={{ height: 36 }} />
        <Sub start={130} maxWidth={640}>
          Processes, filesystem scope, Git and persistence are owned by the
          backend — not improvised in the interface. Terminals outlive panels,
          workspaces outlive restarts.
        </Sub>
      </div>

      <div style={{ position: "absolute", left: X, top: TOP, width: W }}>
        {LAYERS.map((l, i) => {
          const p = ramp(f, 60 + (LAYERS.length - 1 - i) * 22, 40, EASE_OUT);
          const y = i * (H + GAP);
          const dist = Math.abs(beamY - (TOP + y + H / 2));
          const lit = beamOn * Math.max(0, 1 - dist / 150);
          return (
            <div
              key={l.title}
              style={{
                position: "absolute",
                top: y,
                left: 0,
                width: W,
                height: H,
                display: "flex",
                alignItems: "center",
                gap: 22,
                padding: "0 28px",
                borderRadius: 9,
                border: "1px solid rgba(255,255,255," + (0.075 + lit * 0.12) + ")",
                background:
                  "linear-gradient(180deg, rgba(255,255,255," +
                  (0.03 + lit * 0.035) +
                  "), rgba(255,255,255,0.008))",
                boxShadow: lit > 0.05 ? "0 0 60px -22px " + l.color : "none",
                opacity: p,
                transform: "translateY(" + (1 - p) * 26 + "px)",
              }}
            >
              <span
                style={{
                  width: 3,
                  height: 46,
                  borderRadius: 3,
                  background: l.color,
                  opacity: 0.35 + lit * 0.65,
                  boxShadow: lit > 0.05 ? "0 0 16px " + l.color : "none",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 21,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: lit > 0.15 ? C.text : C.text2,
                  width: 250,
                }}
              >
                {l.title}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 16,
                  color: lit > 0.15 ? C.text2 : C.muted,
                  letterSpacing: "0.05em",
                }}
              >
                {l.detail}
              </span>
            </div>
          );
        })}

        <div
          style={{
            position: "absolute",
            top: LAYERS.length * (H + GAP) + 26,
            left: 0,
            display: "flex",
            gap: 34,
            fontFamily: MONO,
            fontSize: 15,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: C.faint,
            opacity: ramp(f, 300, 44, EASE_IN_OUT),
          }}
        >
          <span>project-scoped filesystem</span>
          <span>·</span>
          <span>bounded output pipelines</span>
          <span>·</span>
          <span>forward-safe migrations</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
