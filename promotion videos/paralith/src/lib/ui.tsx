import React from "react";
import { C, MONO } from "./theme";

export const surface = (level: 1 | 2 | 3 = 1): React.CSSProperties => ({
  background:
    level === 1
      ? `linear-gradient(180deg, ${C.s2} 0%, ${C.s1} 100%)`
      : level === 2
        ? `linear-gradient(180deg, ${C.s3} 0%, ${C.s2} 100%)`
        : `linear-gradient(180deg, ${C.s4} 0%, ${C.s3} 100%)`,
  border: `1px solid ${C.line}`,
  borderRadius: 8,
});

type PanelProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 -> 1 entrance. */
  p?: number;
  title?: string;
  accent?: string;
  active?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
};

/** A Paralith-style surface: hairline border, dense header, artifact body. */
export const Panel: React.FC<PanelProps> = ({
  x,
  y,
  w,
  h,
  p = 1,
  title,
  accent,
  active = false,
  children,
  style,
  bodyStyle,
}) => {
  const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: e,
        transform: `translateY(${(1 - e) * 22}px) scale(${0.985 + e * 0.015})`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: active
          ? `0 0 0 1px ${accent ?? C.accent}55, 0 18px 60px -24px ${accent ?? C.accent}70`
          : "0 22px 60px -34px rgba(0,0,0,0.9)",
        ...surface(1),
        ...style,
      }}
    >
      {title !== undefined ? (
        <div
          style={{
            height: 38,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 14px",
            borderBottom: `1px solid ${C.lineFaint}`,
            background: "rgba(255,255,255,0.014)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 6,
              background: accent ?? C.muted,
              boxShadow: active ? `0 0 10px ${accent ?? C.accent}` : "none",
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 14,
              letterSpacing: "0.1em",
              color: active ? C.text2 : C.muted,
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
      ) : null}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
};

export const Dot: React.FC<{ color: string; size?: number; pulse?: number }> = ({
  color,
  size = 7,
  pulse = 0,
}) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: size,
      background: color,
      boxShadow: `0 0 ${8 + pulse * 12}px ${color}`,
      display: "inline-block",
      flexShrink: 0,
    }}
  />
);

export const Chip: React.FC<{
  children: React.ReactNode;
  color?: string;
  soft?: string;
  style?: React.CSSProperties;
}> = ({ children, color = C.text2, soft = "rgba(255,255,255,0.04)", style }) => (
  <span
    style={{
      fontFamily: MONO,
      fontSize: 14,
      letterSpacing: "0.09em",
      textTransform: "uppercase",
      color,
      background: soft,
      border: `1px solid ${color}38`,
      borderRadius: 5,
      padding: "5px 11px",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </span>
);

/** Soft accent bloom placed behind a focal element. */
export const Glow: React.FC<{
  x: number;
  y: number;
  r: number;
  color: string;
  opacity?: number;
}> = ({ x, y, r, color, opacity = 0.5 }) => (
  <div
    style={{
      position: "absolute",
      left: x - r,
      top: y - r,
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
      opacity,
      pointerEvents: "none",
    }}
  />
);
