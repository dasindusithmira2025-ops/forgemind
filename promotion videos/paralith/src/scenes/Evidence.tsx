import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, MONO } from "../lib/theme";
import { EASE_OUT, clamp01, ramp } from "../lib/anim";
import { Headline, Label, Sub } from "../lib/type";

const STATES = ["queued", "starting", "working", "needs_permission", "finished"];

const EVIDENCE = [
  { k: "exit code", v: "0", c: C.success },
  { k: "files changed", v: "12", c: C.accent },
  { k: "diff", v: "+184 / -96", c: C.accent },
  { k: "commit", v: "a4e43f3", c: C.ready },
  { k: "artifact", v: "test-report.json", c: C.warning },
  { k: "evaluation", v: "passed", c: C.success },
];

export const Evidence: React.FC = () => {
  const f = useCurrentFrame();
  const walk = ramp(f, 96, 150, EASE_OUT) * STATES.length;

  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div style={{ marginTop: 196, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Label start={6} color={C.success}>
          Evidence
        </Label>
        <div style={{ height: 32 }} />
        <Headline start={18} size={70} align="center" lines={["Every run leaves proof."]} />
        <div style={{ height: 30 }} />
        <Sub start={70} align="center" maxWidth={880} size={24}>
          Agent state is typed and observable, not guessed from what scrolled
          past in a terminal.
        </Sub>
      </div>

      {/* typed state machine */}
      <div
        style={{
          position: "absolute",
          top: 606,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 0,
        }}
      >
        {STATES.map((s, i) => {
          const enter = ramp(f, 90 + i * 12, 28, EASE_OUT);
          const active = clamp01(walk - i);
          const past = clamp01(walk - i - 1);
          const isNow = active > 0 && past < 1;
          const col = i === STATES.length - 1 ? C.success : i === 3 ? C.warning : C.accent;
          return (
            <React.Fragment key={s}>
              {i > 0 ? (
                <span
                  style={{
                    width: 54,
                    height: 1.5,
                    background: "rgba(255,255,255,0.12)",
                    opacity: enter,
                    position: "relative",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: clamp01(walk - i + 1) * 100 + "%",
                      background: C.accent,
                      boxShadow: "0 0 10px " + C.accent,
                    }}
                  />
                </span>
              ) : null}
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 17,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  padding: "12px 20px",
                  borderRadius: 7,
                  border: "1px solid " + (active > 0 ? col + "88" : "rgba(255,255,255,0.09)"),
                  background: active > 0 ? col + "16" : "rgba(255,255,255,0.02)",
                  color: active > 0 ? (isNow ? C.text : C.text2) : C.faint,
                  boxShadow: isNow ? "0 0 30px -8px " + col : "none",
                  opacity: enter,
                  transform: "scale(" + (0.96 + enter * 0.04 + (isNow ? 0.03 : 0)) + ")",
                  whiteSpace: "nowrap",
                }}
              >
                {s}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      {/* the artefacts that state leaves behind */}
      <div
        style={{
          position: "absolute",
          top: 746,
          left: 300,
          right: 300,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "26px 40px",
        }}
      >
        {EVIDENCE.map((e, i) => {
          const p = ramp(f, 214 + i * 15, 34, EASE_OUT);
          return (
            <div
              key={e.k}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "18px 20px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.075)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.008))",
                opacity: p,
                transform: "translateY(" + (1 - p) * 18 + "px)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 8,
                  background: e.c,
                  boxShadow: "0 0 12px " + e.c,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: C.muted,
                  flex: 1,
                }}
              >
                {e.k}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 17, color: C.text }}>{e.v}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
