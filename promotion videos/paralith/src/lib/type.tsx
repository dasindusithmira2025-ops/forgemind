import React from "react";
import { useCurrentFrame } from "remotion";
import { C, FONT, MONO } from "./theme";
import { clamp01, EASE_OUT, ramp } from "./anim";

/** Small mono eyebrow with an accent tick, used to name each surface. */
export const Label: React.FC<{
  children: string;
  start?: number;
  color?: string;
}> = ({ children, start = 0, color = C.accent }) => {
  const f = useCurrentFrame();
  const p = ramp(f, start, 26);
  const letters = children.split("");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        opacity: p,
      }}
    >
      <div
        style={{
          width: 34 * p,
          height: 2,
          background: `linear-gradient(90deg, ${color}, ${color}00)`,
          boxShadow: `0 0 12px ${color}80`,
        }}
      />
      <div
        style={{
          fontFamily: MONO,
          fontSize: 17,
          letterSpacing: "0.42em",
          textTransform: "uppercase",
          color,
          fontWeight: 500,
          display: "flex",
        }}
      >
        {letters.map((ch, i) => (
          <span
            key={i}
            style={{
              opacity: clamp01((p * letters.length - i) / 1.4),
              whiteSpace: "pre",
            }}
          >
            {ch}
          </span>
        ))}
      </div>
    </div>
  );
};

type HeadlineProps = {
  lines: (string | React.ReactNode)[];
  start?: number;
  size?: number;
  weight?: number;
  lineHeight?: number;
  stagger?: number;
  color?: string;
  align?: "left" | "center";
  maxWidth?: number;
};

/** Word-by-word rise out of a clipped baseline. The workhorse of the film. */
export const Headline: React.FC<HeadlineProps> = ({
  lines,
  start = 0,
  size = 66,
  weight = 300,
  lineHeight = 1.16,
  stagger = 3.4,
  color = C.text,
  align = "left",
  maxWidth,
}) => {
  const f = useCurrentFrame();
  let wordIndex = 0;

  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.022em",
        lineHeight,
        color,
        textAlign: align,
        maxWidth,
      }}
    >
      {lines.map((line, li) => {
        const parts =
          typeof line === "string" ? line.split(" ") : [line as React.ReactNode];
        return (
          <div
            key={li}
            style={{
              overflow: "hidden",
              paddingBottom: size * 0.12,
              marginBottom: -size * 0.12,
              display: "flex",
              flexWrap: "wrap",
              gap: `0 ${size * 0.26}px`,
              justifyContent: align === "center" ? "center" : "flex-start",
            }}
          >
            {parts.map((word, wi) => {
              const idx = wordIndex++;
              const p = ramp(f, start + idx * stagger, 34, EASE_OUT);
              return (
                <span
                  key={wi}
                  style={{
                    display: "inline-block",
                    transform: `translateY(${(1 - p) * 108}%)`,
                    opacity: 0.15 + p * 0.85,
                    whiteSpace: "pre",
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

/** Gradient-inked emphasis inside a headline. */
export const Hot: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      background: `linear-gradient(100deg, ${C.cyan}, ${C.accent} 55%, ${C.violet})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    }}
  >
    {children}
  </span>
);

export const Sub: React.FC<{
  children: React.ReactNode;
  start?: number;
  size?: number;
  color?: string;
  maxWidth?: number;
  align?: "left" | "center";
}> = ({ children, start = 0, size = 25, color = C.text2, maxWidth = 640, align = "left" }) => {
  const f = useCurrentFrame();
  const p = ramp(f, start, 34);
  return (
    <div
      style={{
        fontFamily: FONT,
        fontWeight: 300,
        fontSize: size,
        lineHeight: 1.55,
        letterSpacing: "-0.006em",
        color,
        maxWidth,
        textAlign: align,
        opacity: p,
        transform: `translateY(${(1 - p) * 18}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** A hairline that draws itself; used to separate structure. */
export const Rule: React.FC<{
  start?: number;
  width?: number | string;
  duration?: number;
  color?: string;
}> = ({ start = 0, width = "100%", duration = 40, color = C.line }) => {
  const f = useCurrentFrame();
  const p = ramp(f, start, duration);
  return (
    <div
      style={{
        width,
        height: 1,
        background: color,
        transform: `scaleX(${p})`,
        transformOrigin: "left center",
      }}
    />
  );
};

export const Mono: React.FC<{
  children: React.ReactNode;
  size?: number;
  color?: string;
  spacing?: string;
  weight?: number;
  style?: React.CSSProperties;
}> = ({ children, size = 15, color = C.muted, spacing = "0.06em", weight = 400, style }) => (
  <span
    style={{
      fontFamily: MONO,
      fontSize: size,
      letterSpacing: spacing,
      color,
      fontWeight: weight,
      ...style,
    }}
  >
    {children}
  </span>
);
