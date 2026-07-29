import React from 'react';
import { AbsoluteFill } from 'remotion';
import { BrandMark } from '../components/BrandMark';
import { brand, font, spectrum } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';

export const Poster: React.FC = () => {
  const layout = useFilmLayout();
  const markSize = layout.width * 0.13;
  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(55% 70% at 50% 42%, rgba(60,79,255,.2), transparent 68%),
          radial-gradient(36% 44% at 78% 16%, rgba(34,211,238,.08), transparent 72%),
          linear-gradient(180deg, #080a12, ${brand.black})
        `,
        color: brand.white,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font.ui,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.16,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.026) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.026) 1px, transparent 1px)',
          backgroundSize: `${layout.width / 32}px ${layout.width / 32}px`,
          maskImage: 'radial-gradient(ellipse 72% 76% at center, black, transparent)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
        <BrandMark size={markSize} glow={1.2} />
        <div
          style={{
            marginTop: layout.height * 0.045,
            fontSize: layout.width * 0.062,
            fontWeight: 640,
            letterSpacing: '0.15em',
          }}
        >
          PARALITH
        </div>
        <div
          style={{
            width: layout.width * 0.21,
            height: 2,
            marginTop: layout.height * 0.028,
            background: spectrum,
          }}
        />
        <div
          style={{
            marginTop: layout.height * 0.035,
            color: brand.muted,
            fontSize: layout.width * 0.021,
            letterSpacing: '-0.025em',
          }}
        >
          Direct the work.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: layout.height * 0.055,
          fontFamily: font.mono,
          fontSize: layout.width * 0.009,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: brand.faint,
        }}
      >
        An agentic development environment · Corelith Technologies
      </div>
    </AbsoluteFill>
  );
};
