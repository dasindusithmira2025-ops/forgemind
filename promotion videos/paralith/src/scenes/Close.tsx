import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Mark } from "../lib/Mark";
import { Wordmark } from "../lib/Wordmark";
import { C, MONO } from "../lib/theme";
import { EASE_IN_OUT, EASE_OUT, clamp01, ramp } from "../lib/anim";

const LOCK = 236;
const MARK_RATIO = 0.7649;
const WORD_RATIO = 8.571;
const WORD_H = LOCK * 0.29;
const WORD_W = WORD_H * WORD_RATIO;
const GAP = 60;
const TOTAL_W = LOCK * MARK_RATIO + GAP + WORD_W;
const LEFT = 960 - TOTAL_W / 2;
const CENTER_Y = 468;

const TAGLINE = "MANY AGENTS. ONE BUILD.";

export const Close: React.FC = () => {
  const f = useCurrentFrame();

  const draw = ramp(f, 26, 96, EASE_OUT);
  const fill = ramp(f, 74, 76, EASE_OUT);
  const word = ramp(f, 132, 92, EASE_OUT);
  const tag = ramp(f, 214, 110, EASE_OUT);
  const foot = ramp(f, 292, 50, EASE_OUT);

  const sweepP = ramp(f, 300, 70, EASE_IN_OUT);
  const sweep = f < 300 || f > 386 ? -1 : sweepP;

  // closing seam, the mirror of the ignition
  const seam = ramp(f, 396, 62, EASE_IN_OUT);
  const seamW = interpolate(seam, [0, 1], [0, 1240]);
  const seamOpacity = interpolate(f, [396, 424, 470], [0, 0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const breathe = 1 + Math.sin(f * 0.035) * 0.006;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          transform: "scale(" + breathe + ")",
        }}
      >
        <div style={{ position: "absolute", left: LEFT, top: CENTER_Y - LOCK / 2 }}>
          <Mark size={LOCK} draw={draw} fill={fill} sweep={sweep} glow={0.4 + fill * 0.9} />
        </div>

        <div
          style={{
            position: "absolute",
            left: LEFT + LOCK * MARK_RATIO + GAP,
            top: CENTER_Y - WORD_H / 2 - 3,
          }}
        >
          <Wordmark size={WORD_H} reveal={word} color={C.text} />
        </div>

        {/* tagline, inked with the brand gradient */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 636,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: MONO,
              fontSize: 27,
              fontWeight: 500,
              letterSpacing: "0.44em",
              paddingLeft: "0.44em",
              background:
                "linear-gradient(100deg, " + C.cyan + ", " + C.accent + " 52%, " + C.violet + ")",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {TAGLINE.split("").map((ch, i) => {
              const p = clamp01((tag * (TAGLINE.length + 8) - i) / 6);
              return (
                <span
                  key={i}
                  style={{
                    whiteSpace: "pre",
                    opacity: p,
                    transform: "translateY(" + (1 - p) * 10 + "px)",
                    color: "transparent",
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 744,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 26,
            opacity: foot,
          }}
        >
          <div
            style={{
              width: 360 * foot,
              height: 1,
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)",
            }}
          />
          <div
            style={{
              fontFamily: MONO,
              fontSize: 17,
              letterSpacing: "0.46em",
              paddingLeft: "0.46em",
              textTransform: "uppercase",
              color: C.text2,
            }}
          >
            Corelith Technologies
          </div>
        </div>

        {/* closing seam */}
        <div
          style={{
            position: "absolute",
            left: 960 - seamW / 2,
            top: 1004,
            width: seamW,
            height: 2,
            opacity: seamOpacity,
            background:
              "linear-gradient(90deg, transparent, " +
              C.cyan +
              " 25%, #ffffff 50%, " +
              C.violet +
              " 75%, transparent)",
            boxShadow: "0 0 24px " + C.accent,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
