import React from 'react';
import { useCurrentFrame } from 'remotion';
import { CAPTIONS } from '../data/copy';
import { brand, font } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease } from '../utils/motion';

export const CaptionTrack: React.FC = () => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const cue = CAPTIONS.find((item) => frame >= item.from && frame <= item.to);
  if (!cue) return null;
  const p = Math.min(ease(frame, cue.from, 9), ease(cue.to - frame, 0, 9));
  const portrait = layout.format === 'vertical';

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 80,
        left: layout.safeX,
        right: layout.safeX,
        bottom:
          layout.format === 'vertical'
            ? layout.height * 0.025
            : layout.format === 'square'
              ? layout.height * 0.022
              : layout.height * 0.055,
        display: 'flex',
        justifyContent: 'center',
        opacity: p,
      }}
    >
      <div
        style={{
          maxWidth: portrait ? '92%' : '72%',
          padding: portrait ? '14px 20px' : '10px 18px',
          borderRadius: 7,
          color: brand.white,
          background: 'rgba(4,6,11,.88)',
          border: `1px solid ${brand.lineStrong}`,
          boxShadow: '0 12px 42px rgba(0,0,0,.45)',
          fontFamily: font.ui,
          fontSize: portrait ? layout.width * 0.042 : layout.width * 0.017,
          lineHeight: 1.28,
          fontWeight: 540,
          textAlign: 'center',
          letterSpacing: '-0.015em',
        }}
      >
        {cue.text}
      </div>
    </div>
  );
};
