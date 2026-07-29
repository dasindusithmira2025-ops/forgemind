import React from 'react';
import { useCurrentFrame } from 'remotion';
import { CursorPath } from '../components/CursorPath';
import { Panel, Tag } from '../components/ProductUI';
import { SceneFrame } from '../components/SceneFrame';
import { COPY } from '../data/copy';
import { brand, font } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease } from '../utils/motion';
import type { SceneProps } from './types';

const surfaces = [
  { label: 'TERMINAL', detail: 'test failed', color: brand.danger },
  { label: 'AGENT', detail: 'needs input', color: brand.warning },
  { label: 'BRANCH', detail: 'ahead 3', color: brand.blue },
  { label: 'REVIEW', detail: '2 comments', color: brand.violet },
  { label: 'CI', detail: 'running', color: brand.cyan },
  { label: 'CONTEXT', detail: 'switch project', color: brand.faint },
] as const;

export const Pressure: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const portrait = layout.format === 'vertical';
  const freezeAt = duration * 0.78;
  const freeze = ease(frame, freezeAt, duration * 0.08);
  const copy = ease(frame, duration * 0.52, duration * 0.12);
  const columns = portrait ? 2 : 3;
  const gap = portrait ? layout.width * 0.035 : layout.width * 0.025;
  const cardW =
    (layout.width - layout.safeX * 2 - gap * (columns - 1)) / columns;
  const cardH = portrait ? layout.height * 0.11 : layout.height * 0.18;

  return (
    <SceneFrame duration={duration} glow="none">
      <div
        style={{
          position: 'absolute',
          left: layout.safeX,
          right: layout.safeX,
          top: portrait ? layout.height * 0.13 : layout.height * 0.17,
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap,
          opacity: 1 - freeze * 0.5,
          transform: `scale(${1 - freeze * 0.018})`,
        }}
      >
        {surfaces.map((surface, index) => {
          const p = ease(frame, duration * (0.05 + index * 0.045), duration * 0.1);
          return (
            <Panel
              key={surface.label}
              title={surface.label}
              accent={surface.color}
              style={{
                height: cardH,
                opacity: p,
                transform: `translateY(${(1 - p) * 22}px)`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 14px',
                  fontFamily: font.mono,
                  fontSize: Math.max(9, cardW * 0.045),
                  color: brand.muted,
                }}
              >
                <span>{surface.detail}</span>
                <Tag color={surface.color}>{String(index + 1).padStart(2, '0')}</Tag>
              </div>
            </Panel>
          );
        })}
      </div>
      {!portrait ? (
        <CursorPath
          from={{ x: layout.width * 0.2, y: layout.height * 0.31 }}
          to={{ x: layout.width * 0.79, y: layout.height * 0.55 }}
          start={duration * 0.24}
          duration={duration * 0.35}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: layout.safeX,
          right: layout.safeX,
          bottom: portrait ? layout.height * 0.14 : layout.height * 0.11,
          display: 'flex',
          flexDirection: portrait ? 'column' : 'row',
          justifyContent: 'space-between',
          gap: 10,
          fontFamily: font.ui,
          fontWeight: 600,
          fontSize: portrait ? layout.width * 0.075 : layout.width * 0.045,
          letterSpacing: '-0.05em',
          opacity: copy,
        }}
      >
        <span style={{ color: brand.white }}>{COPY.pressure.primary}</span>
        <span style={{ color: brand.muted }}>{COPY.pressure.secondary}</span>
      </div>
    </SceneFrame>
  );
};
