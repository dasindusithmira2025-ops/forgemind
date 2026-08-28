import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "./theme";

const NOISE_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

/**
 * The persistent environment every scene sits inside: deep canvas, a slow
 * chromatic bloom, an engineering grid with parallax drift, grain and vignette.
 */
export const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / 60;

  const driftX = Math.sin(t * 0.16) * 26;
  const driftY = Math.cos(t * 0.12) * 18;

  return (
    <AbsoluteFill style={{ backgroundColor: C.deep, overflow: "hidden" }}>
      {/* chromatic bloom */}
      <AbsoluteFill
        style={{
          transform: `translate(${driftX}px, ${driftY}px) scale(1.12)`,
          background: `
            radial-gradient(46% 42% at 22% 18%, rgba(34,211,238,0.085) 0%, rgba(34,211,238,0) 68%),
            radial-gradient(52% 48% at 82% 76%, rgba(139,92,246,0.095) 0%, rgba(139,92,246,0) 70%),
            radial-gradient(70% 60% at 50% 50%, rgba(79,134,234,0.055) 0%, rgba(79,134,234,0) 74%)
          `,
        }}
      />

      {/* engineering grid */}
      <AbsoluteFill
        style={{
          transform: `translate(${-driftX * 0.9}px, ${-driftY * 0.9}px)`,
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)
          `,
          backgroundSize: "72px 72px",
          maskImage:
            "radial-gradient(120% 105% at 50% 45%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.72) 46%, rgba(0,0,0,0) 88%)",
          WebkitMaskImage:
            "radial-gradient(120% 105% at 50% 45%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.72) 46%, rgba(0,0,0,0) 88%)",
        }}
      />

      {/* coarse structural grid */}
      <AbsoluteFill
        style={{
          transform: `translate(${-driftX * 0.45}px, ${-driftY * 0.45}px)`,
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: "432px 432px",
          maskImage:
            "radial-gradient(110% 100% at 50% 50%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 82%)",
          WebkitMaskImage:
            "radial-gradient(110% 100% at 50% 50%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 82%)",
        }}
      />

      {/* grain */}
      <AbsoluteFill
        style={{
          backgroundImage: NOISE_URI,
          backgroundSize: "220px 220px",
          opacity: 0.05,
          mixBlendMode: "overlay",
        }}
      />

      {/* vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(78% 78% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
