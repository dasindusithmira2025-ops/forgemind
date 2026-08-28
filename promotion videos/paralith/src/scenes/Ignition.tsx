import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Mark } from "../lib/Mark";
import { Wordmark } from "../lib/Wordmark";
import { C, MONO } from "../lib/theme";
import { EASE_IN_OUT, EASE_OUT, ramp, settle } from "../lib/anim";

const HERO = 408;
const LOCK = 214;
const MARK_RATIO = 0.7649; // width / height of the padded mark box
const WORD_RATIO = 8.571; // width / height of the padded wordmark box
const WORD_H = LOCK * 0.29;
const WORD_W = WORD_H * WORD_RATIO;
const GAP = 56;

export const Ignition: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 1. a seam of light opens, then collapses into the ignition point
  const seamW = interpolate(f, [6, 40], [0, 1180], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const seamCollapse = ramp(f, 40, 26, EASE_IN_OUT);
  const seamOpacity = interpolate(f, [4, 14, 56, 74], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringP = ramp(f, 52, 62, EASE_OUT);

  // 2. the monolith draws itself, fills, then takes a specular sweep
  const draw = ramp(f, 54, 132, EASE_OUT);
  const fill = ramp(f, 138, 96, EASE_OUT);
  const sweepP = ramp(f, 206, 66, EASE_IN_OUT);
  const sweep = f < 206 || f > 286 ? -1 : sweepP;

  // 3. hero mark settles into the horizontal lockup
  const lock = settle(f, fps, 252);
  const size = interpolate(lock, [0, 1], [HERO, LOCK]);
  const markW = size * MARK_RATIO;
  const lockTotal = LOCK * MARK_RATIO + GAP + WORD_W;
  const markCx = interpolate(lock, [0, 1], [960, 960 - lockTotal / 2 + (LOCK * MARK_RATIO) / 2]);
  const rise = interpolate(ramp(f, 40, 70, EASE_OUT), [0, 1], [26, 0]);

  const wordReveal = ramp(f, 272, 92, EASE_OUT);
  const tag = ramp(f, 330, 44, EASE_OUT);

  return (
    <AbsoluteFill>
      {/* ignition seam */}
      <div
        style={{
          position: "absolute",
          left: 960 - (seamW * (1 - seamCollapse) + 4) / 2,
          top: 540 - 1.5,
          width: seamW * (1 - seamCollapse) + 4,
          height: 3,
          opacity: seamOpacity,
          background: `linear-gradient(90deg, ${C.cyan}00, ${C.cyan} 22%, #ffffff 50%, ${C.violet} 78%, ${C.violet}00)`,
          boxShadow: `0 0 26px ${C.accent}, 0 0 90px ${C.violet}90`,
          borderRadius: 3,
        }}
      />

      {/* ignition ring */}
      {ringP > 0 && ringP < 1 ? (
        <div
          style={{
            position: "absolute",
            left: 960 - 620 * ringP,
            top: 540 - 620 * ringP,
            width: 1240 * ringP,
            height: 1240 * ringP,
            borderRadius: "50%",
            border: `1px solid ${C.accent}`,
            opacity: (1 - ringP) * 0.5,
          }}
        />
      ) : null}

      {/* lockup */}
      <div
        style={{
          position: "absolute",
          left: markCx - markW / 2,
          top: 540 - size / 2 + rise,
        }}
      >
        <Mark
          size={size}
          draw={draw}
          fill={fill}
          sweep={sweep}
          glow={0.35 + fill * 0.85}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: 960 - lockTotal / 2 + LOCK * MARK_RATIO + GAP,
          top: 540 - WORD_H / 2 - 3,
          opacity: lock,
        }}
      >
        <Wordmark size={WORD_H} reveal={wordReveal} color={C.text} />
      </div>

      {/* category line */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 700,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 18,
          letterSpacing: "0.52em",
          paddingLeft: "0.52em",
          textTransform: "uppercase",
          color: C.muted,
          opacity: tag,
          transform: `translateY(${(1 - tag) * 14}px)`,
        }}
      >
        Agentic Development Environment
      </div>
    </AbsoluteFill>
  );
};
