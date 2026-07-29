import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { brand } from '../styles/tokens';
import { fadeWindow, seeded } from '../utils/motion';

export const SceneFrame: React.FC<{
  duration: number;
  children: React.ReactNode;
  glow?: 'blue' | 'violet' | 'green' | 'none';
  grid?: boolean;
}> = ({ duration, children, glow = 'blue', grid = true }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const opacity = fadeWindow(frame, duration, 18, 24);
  const glowColor =
    glow === 'violet'
      ? 'rgba(132,88,255,0.15)'
      : glow === 'green'
        ? 'rgba(63,201,126,0.10)'
        : glow === 'none'
          ? 'transparent'
          : 'rgba(57,94,255,0.14)';

  return (
    <AbsoluteFill style={{ backgroundColor: brand.black, color: brand.text, opacity }}>
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(75% 62% at 50% 44%, ${glowColor}, transparent 72%),
            radial-gradient(40% 45% at 82% 14%, rgba(34,211,238,0.045), transparent 72%),
            linear-gradient(180deg, #070912 0%, #04060b 70%)
          `,
        }}
      />
      {grid ? (
        <AbsoluteFill
          style={{
            opacity: 0.19,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.026) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.026) 1px, transparent 1px)',
            backgroundSize: `${Math.max(46, width / 32)}px ${Math.max(46, width / 32)}px`,
            maskImage: 'radial-gradient(ellipse 78% 72% at center, black, transparent)',
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          opacity: 0.065,
          mixBlendMode: 'screen',
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="${Math.floor(seeded(frame) * 41) + 9}"/></filter><rect width="100%" height="100%" filter="url(#n)" opacity=".55"/></svg>`,
          )}")`,
          backgroundSize: `${Math.max(90, width / 18)}px`,
        }}
      />
      {children}
      <div
        style={{
          position: 'absolute',
          left: width * 0.035,
          right: width * 0.035,
          bottom: height * 0.025,
          height: 1,
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,.07) 18%, rgba(255,255,255,.07) 82%, transparent)',
        }}
      />
    </AbsoluteFill>
  );
};
