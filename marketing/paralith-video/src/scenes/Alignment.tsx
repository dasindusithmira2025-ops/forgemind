import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { BrandMark } from '../components/BrandMark';
import { SceneFrame } from '../components/SceneFrame';
import { COPY } from '../data/copy';
import { brand, font, spectrum } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease, physical } from '../utils/motion';
import type { SceneProps } from './types';

export const Alignment: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useFilmLayout();
  const line = ease(frame, duration * 0.08, duration * 0.24);
  const mark = physical(frame, fps, duration * 0.32);
  const title = ease(frame, duration * 0.5, duration * 0.14);
  const subtitle = ease(frame, duration * 0.66, duration * 0.14);
  const markSize = layout.format === 'vertical' ? layout.width * 0.27 : layout.width * 0.12;

  return (
    <SceneFrame duration={duration} glow="blue" grid={false}>
      <div
        style={{
          position: 'absolute',
          left: `${50 - line * 42}%`,
          right: `${50 - line * 42}%`,
          top: '50%',
          height: 1,
          background: spectrum,
          opacity: 0.85,
          boxShadow: '0 0 24px rgba(79,107,255,.45)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: layout.bodySize * 1.1,
          transform: `translateY(${(1 - mark) * 18}px)`,
        }}
      >
        <BrandMark size={markSize} opacity={mark} glow={mark} />
        <div
          style={{
            marginTop: layout.bodySize * 0.3,
            fontFamily: font.ui,
            fontSize: layout.headlineSize,
            fontWeight: 610,
            letterSpacing: '-0.055em',
            color: brand.white,
            opacity: title,
          }}
        >
          {COPY.alignment.primary}
        </div>
        <div
          style={{
            fontFamily: font.ui,
            fontSize: layout.bodySize * 1.08,
            color: brand.muted,
            letterSpacing: '-0.02em',
            opacity: subtitle,
          }}
        >
          {COPY.alignment.secondary}
        </div>
      </div>
    </SceneFrame>
  );
};
