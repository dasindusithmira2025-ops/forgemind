import React from "react";
import { C } from "./theme";
import { clamp01 } from "./anim";
import { WORDMARK_BBOX, WORDMARK_PATHS } from "./wordmarkPath";

const PAD = 6;
const VB = `${WORDMARK_BBOX.x - PAD} ${WORDMARK_BBOX.y - PAD} ${
  WORDMARK_BBOX.w + PAD * 2
} ${WORDMARK_BBOX.h + PAD * 2}`;

type Props = {
  /** Rendered height in px of the letterforms. */
  size: number;
  /** 0 -> 1, letters rising into place left to right. */
  reveal?: number;
  color?: string;
  gradient?: boolean;
  id?: string;
};

/** PARALITH, traced letter by letter from the brand wordmark. */
export const Wordmark: React.FC<Props> = ({
  size,
  reveal = 1,
  color = C.text,
  gradient = false,
  id = "wm",
}) => {
  const w = (size * (WORDMARK_BBOX.w + PAD * 2)) / (WORDMARK_BBOX.h + PAD * 2);
  const n = WORDMARK_PATHS.length;
  const stagger = 0.06;
  const span = 1 - stagger * (n - 1);

  return (
    <svg width={w} height={size} viewBox={VB} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient
          id={`${id}-g`}
          gradientUnits="userSpaceOnUse"
          x1={WORDMARK_BBOX.x}
          y1={WORDMARK_BBOX.y}
          x2={WORDMARK_BBOX.x + WORDMARK_BBOX.w}
          y2={WORDMARK_BBOX.y + WORDMARK_BBOX.h}
        >
          <stop offset="0" stopColor={C.cyan} />
          <stop offset="0.5" stopColor="#4d7bf0" />
          <stop offset="1" stopColor={C.violet} />
        </linearGradient>
        <clipPath id={`${id}-mask`}>
          <rect
            x={WORDMARK_BBOX.x - PAD}
            y={WORDMARK_BBOX.y - PAD}
            width={WORDMARK_BBOX.w + PAD * 2}
            height={WORDMARK_BBOX.h + PAD * 2}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-mask)`}>
      {WORDMARK_PATHS.map((d, i) => {
        const p = clamp01((reveal - i * stagger) / span);
        const eased = 1 - Math.pow(1 - p, 3);
        return (
          <g
            key={i}
            transform={`translate(0 ${(1 - eased) * 46})`}
            opacity={eased}
            style={{ clipPath: "none" }}
          >
            <path d={d} fill={gradient ? `url(#${id}-g)` : color} />
          </g>
        );
      })}
      </g>
    </svg>
  );
};
