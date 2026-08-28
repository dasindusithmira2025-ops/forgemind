import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, MONO } from "../lib/theme";
import { EASE_OUT, ramp, rand } from "../lib/anim";
import { Headline, Label, Sub } from "../lib/type";
import { Dot, Panel } from "../lib/ui";

const GHOSTS = 9;

export const Premise: React.FC = () => {
  const f = useCurrentFrame();

  const cursorOn = Math.floor(f / 26) % 2 === 0;
  const typed = Math.floor(ramp(f, 60, 90, EASE_OUT) * 24);
  const ghosts = ramp(f, 168, 90, EASE_OUT);
  const dim = ramp(f, 186, 70);

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 132, top: 316, width: 720 }}>
        <Label start={8}>Today</Label>
        <div style={{ height: 34 }} />
        <Headline
          start={22}
          size={62}
          lines={["One agent,", "in one terminal,", "is not an environment."]}
        />
        <div style={{ height: 40 }} />
        <Sub start={150} maxWidth={620}>
          Real engineering runs wide — many agents, many worktrees, many
          surfaces, all alive at the same time.
        </Sub>
      </div>

      {/* the lone terminal, and everything it cannot hold */}
      <div style={{ position: "absolute", left: 980, top: 0, width: 940, height: 1080 }}>
        {Array.from({ length: GHOSTS }).map((_, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const p = ramp(f, 168 + i * 7, 46, EASE_OUT);
          const flick =
            0.5 + 0.5 * Math.sin((f + rand(i) * 120) * 0.08 + rand(i + 9) * 6);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 118 + col * 214,
                top: 214 + row * 196,
                width: 168,
                height: 118,
                border: `1px dashed rgba(255,255,255,${0.1 + flick * 0.07})`,
                borderRadius: 6,
                opacity: p * ghosts * 0.75,
                transform: `scale(${0.9 + p * 0.1})`,
              }}
            />
          );
        })}

        <Panel
          x={216}
          y={370}
          w={430}
          h={272}
          p={ramp(f, 30, 46, EASE_OUT)}
          title="terminal — 1 of 1"
          accent={C.accent}
          active
          style={{ opacity: 1 - dim * 0.35 }}
        >
          <div
            style={{
              padding: "18px 20px",
              fontFamily: MONO,
              fontSize: 17,
              lineHeight: 1.85,
              color: C.text2,
            }}
          >
            <div style={{ color: C.muted }}>$ agent run --task refactor</div>
            <div style={{ color: C.text2 }}>
              {"working".slice(0, Math.max(0, typed - 4))}
              {typed > 10 ? "…" : ""}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <span style={{ color: C.muted }}>$</span>
              <span
                style={{
                  width: 11,
                  height: 21,
                  background: cursorOn ? C.accent : "transparent",
                  display: "inline-block",
                  boxShadow: cursorOn ? `0 0 12px ${C.accent}` : "none",
                }}
              />
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              left: 20,
              bottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: MONO,
              fontSize: 14,
              color: C.muted,
              letterSpacing: "0.08em",
            }}
          >
            <Dot color={C.warning} pulse={0.4} />
            EVERYTHING ELSE WAITS
          </div>
        </Panel>
      </div>
    </AbsoluteFill>
  );
};
