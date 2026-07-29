import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { BrandMark } from '../components/BrandMark';
import { SceneFrame } from '../components/SceneFrame';
import { COPY } from '../data/copy';
import { brand, font, spectrum } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease, physical } from '../utils/motion';
import type { SceneProps } from './types';

export const Direction: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useFilmLayout();
  const first = ease(frame, duration * 0.04, duration * 0.14);
  const second = ease(frame, duration * 0.25, duration * 0.14);
  const brandIn = physical(frame, fps, duration * 0.45);
  const supporting = ease(frame, duration * 0.61, duration * 0.14);
  const domain = ease(frame, duration * 0.73, duration * 0.12);
  const markSize = layout.format === 'vertical' ? layout.width * 0.22 : layout.width * 0.095;

  return (
    <SceneFrame duration={duration} glow="blue" grid={false}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          textAlign: 'center',
          padding: `0 ${layout.safeX}px`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: layout.format === 'vertical' ? '22%' : '18%',
            fontFamily: font.ui,
            fontSize: layout.headlineSize * 0.82,
            fontWeight: 610,
            letterSpacing: '-0.05em',
            color: brand.muted,
            opacity: first * (1 - brandIn),
          }}
        >
          {COPY.direction.primary}
        </div>
        <div
          style={{
            position: 'absolute',
            top: layout.format === 'vertical' ? '31%' : '30%',
            fontFamily: font.ui,
            fontSize: layout.headlineSize * 1.12,
            fontWeight: 650,
            letterSpacing: '-0.06em',
            color: brand.white,
            opacity: second * (1 - brandIn),
          }}
        >
          {COPY.direction.secondary}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: brandIn,
            transform: `translateY(${(1 - brandIn) * 24}px) scale(${0.96 + brandIn * 0.04})`,
          }}
        >
          <BrandMark size={markSize} glow={brandIn} />
          <div
            style={{
              marginTop: layout.bodySize * 0.7,
              fontFamily: font.ui,
              fontSize: layout.headlineSize * 0.74,
              fontWeight: 620,
              letterSpacing: '0.16em',
              color: brand.white,
            }}
          >
            PARALITH
          </div>
          <div
            style={{
              width: markSize * 1.9,
              height: 1,
              marginTop: layout.bodySize * 0.65,
              background: spectrum,
            }}
          />
          <div
            style={{
              marginTop: layout.bodySize * 0.9,
              fontFamily: font.ui,
              fontSize: layout.bodySize * 0.92,
              lineHeight: 1.35,
              letterSpacing: '-0.02em',
              color: brand.muted,
              opacity: supporting,
            }}
          >
            Build beyond the limits of a traditional IDE.
          </div>
          <div
            style={{
              marginTop: layout.bodySize * 0.7,
              fontFamily: font.mono,
              fontSize: layout.bodySize * 0.58,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              color: brand.faint,
              opacity: supporting,
            }}
          >
            By Corelith Technologies
          </div>
          <div
            style={{
              marginTop: layout.bodySize * 0.9,
              fontFamily: font.mono,
              fontSize: layout.bodySize * 0.68,
              letterSpacing: '0.06em',
              color: brand.cyan,
              opacity: domain,
            }}
          >
            corelithtechnologies.com
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};
