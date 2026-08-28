import React from "react";
import { C } from "./theme";
import { clamp01 } from "./anim";
import { MARK_BBOX, MARK_PATHS } from "./markPath";

const PAD = 18;
const VB = `${MARK_BBOX.x - PAD} ${MARK_BBOX.y - PAD} ${MARK_BBOX.w + PAD * 2} ${
  MARK_BBOX.h + PAD * 2
}`;

type Props = {
  /** Rendered height in px. */
  size: number;
  /** 0 -> 1, outlines drawing themselves, back slab first. */
  draw?: number;
  /** 0 -> 1, gradient fill materialising inside the outlines. */
  fill?: number;
  /** 0 -> 1, specular sweep travelling across the mark. */
  sweep?: number;
  /** Bloom intensity multiplier. */
  glow?: number;
  id?: string;
  style?: React.CSSProperties;
};

/** The Paralith monolith, traced from the brand pack and rebuilt as motion vector. */
export const Mark: React.FC<Props> = ({
  size,
  draw = 1,
  fill = 1,
  sweep = -1,
  glow = 1,
  id = "mk",
  style,
}) => {
  const w = (size * (MARK_BBOX.w + PAD * 2)) / (MARK_BBOX.h + PAD * 2);
  const stagger = 0.2;
  const span = 1 - stagger * 2;

  return (
    <svg
      width={w}
      height={size}
      viewBox={VB}
      style={{
        overflow: "visible",
        filter: glow
          ? `drop-shadow(0 0 ${26 * glow}px rgba(79,134,234,${0.34 * glow})) drop-shadow(0 0 ${
              72 * glow
            }px rgba(139,92,246,${0.2 * glow}))`
          : undefined,
        ...style,
      }}
    >
      <defs>
        <linearGradient
          id={`${id}-grad`}
          gradientUnits="userSpaceOnUse"
          x1={MARK_BBOX.x}
          y1={MARK_BBOX.y}
          x2={MARK_BBOX.x + MARK_BBOX.w}
          y2={MARK_BBOX.y + MARK_BBOX.h}
        >
          <stop offset="0" stopColor={C.cyan} />
          <stop offset="0.42" stopColor="#4d7bf0" />
          <stop offset="1" stopColor={C.violet} />
        </linearGradient>
        <linearGradient id={`${id}-sweep`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          {MARK_PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </clipPath>
      </defs>

      {MARK_PATHS.map((d, i) => {
        const order = MARK_PATHS.length - 1 - i; // back slab leads
        const p = clamp01((draw - order * stagger) / span);
        const fp = clamp01((fill - order * stagger) / span);
        return (
          <g key={i}>
            <path
              d={d}
              fill={`url(#${id}-grad)`}
              fillOpacity={fp}
              stroke="none"
            />
            <path
              d={d}
              fill="none"
              stroke={`url(#${id}-grad)`}
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - p}
              opacity={0.9 - fp * 0.35}
            />
          </g>
        );
      })}

      {sweep >= 0 && sweep <= 1 ? (
        <g clipPath={`url(#${id}-clip)`}>
          <rect
            x={MARK_BBOX.x - 260 + sweep * (MARK_BBOX.w + 520)}
            y={MARK_BBOX.y - 40}
            width={220}
            height={MARK_BBOX.h + 80}
            fill={`url(#${id}-sweep)`}
            opacity={0.55}
            transform={`rotate(-12 ${MARK_BBOX.x + MARK_BBOX.w / 2} ${
              MARK_BBOX.y + MARK_BBOX.h / 2
            })`}
          />
        </g>
      ) : null}
    </svg>
  );
};
