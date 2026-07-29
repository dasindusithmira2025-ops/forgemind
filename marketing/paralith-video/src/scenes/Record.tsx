import React from 'react';
import { useCurrentFrame } from 'remotion';
import { ProductWindow } from '../components/ProductWindow';
import { StatusDot, Tag } from '../components/ProductUI';
import { SceneFrame } from '../components/SceneFrame';
import { Statement } from '../components/Typography';
import { COPY } from '../data/copy';
import { brand, font } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease } from '../utils/motion';
import type { SceneProps } from './types';

const nodes = [
  { id: 'task', label: 'task', value: 'repair session ownership', x: 0.12, y: 0.18, color: brand.blue },
  { id: 'attempt', label: 'attempt 03', value: 'builder · codex', x: 0.45, y: 0.12, color: '#785ef0' },
  { id: 'source', label: 'source', value: 'src/auth/session.ts', x: 0.72, y: 0.28, color: brand.cyan },
  { id: 'test', label: 'validation', value: '48 tests passed', x: 0.58, y: 0.61, color: brand.success },
  { id: 'evidence', label: 'evidence', value: 'ownership invariant', x: 0.22, y: 0.65, color: brand.success },
] as const;

const edges = [
  [0, 1],
  [1, 2],
  [1, 3],
  [0, 4],
  [4, 3],
] as const;

export const Record: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const portrait = layout.format === 'vertical';

  return (
    <SceneFrame duration={duration} glow="violet">
      <ProductWindow
        section="swarms / execution record"
        attention={0}
        sidebar={!portrait}
        revealAt={duration * 0.01}
      >
        <div
          style={{
            position: 'absolute',
            inset: 10,
            overflow: 'hidden',
            border: `1px solid ${brand.line}`,
            borderRadius: 8,
            background: brand.panel,
          }}
        >
          <div
            style={{
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px',
              background: brand.panelRaised,
              borderBottom: `1px solid ${brand.line}`,
              fontFamily: font.mono,
              fontSize: 10,
              color: brand.muted,
            }}
          >
            <span>durable work record · run 01J8S9</span>
            <Tag color={brand.success}>project scoped</Tag>
          </div>
          <div style={{ position: 'absolute', inset: '35px 0 0' }}>
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
              {edges.map(([a, b], index) => {
                const from = nodes[a];
                const to = nodes[b];
                const p = ease(frame, duration * (0.18 + index * 0.07), duration * 0.14);
                return (
                  <line
                    key={`${from.id}-${to.id}`}
                    x1={`${from.x * 100}%`}
                    y1={`${from.y * 100}%`}
                    x2={`${(from.x + (to.x - from.x) * p) * 100}%`}
                    y2={`${(from.y + (to.y - from.y) * p) * 100}%`}
                    stroke={index >= 3 ? brand.success : brand.blue}
                    strokeWidth="1.3"
                    strokeOpacity={0.3 + p * 0.5}
                    strokeDasharray={index === 1 ? '5 5' : undefined}
                  />
                );
              })}
            </svg>
            {nodes.map((node, index) => {
              const p = ease(frame, duration * (0.09 + index * 0.09), duration * 0.13);
              const w = portrait ? 178 : 210;
              return (
                <div
                  key={node.id}
                  style={{
                    position: 'absolute',
                    left: `calc(${node.x * 100}% - ${w / 2}px)`,
                    top: `calc(${node.y * 100}% - 27px)`,
                    width: w,
                    minHeight: 54,
                    padding: '9px 11px',
                    border: `1px solid ${node.color}55`,
                    borderRadius: 7,
                    background: 'rgba(9,11,17,.94)',
                    boxShadow: `0 10px 28px rgba(0,0,0,.35), 0 0 24px ${node.color}12`,
                    opacity: p,
                    transform: `scale(${0.94 + p * 0.06})`,
                    fontFamily: font.mono,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      marginBottom: 6,
                      fontSize: 8.5,
                      textTransform: 'uppercase',
                      letterSpacing: '.11em',
                      color: node.color,
                    }}
                  >
                    <StatusDot color={node.color} live={index < 3} size={6} />
                    {node.label}
                  </div>
                  <div style={{ fontSize: portrait ? 9.5 : 10.5, color: brand.text }}>{node.value}</div>
                </div>
              );
            })}
            <div
              style={{
                position: 'absolute',
                left: 14,
                right: 14,
                bottom: 12,
                display: 'grid',
                gridTemplateColumns: portrait ? '1fr 1fr' : 'repeat(4,1fr)',
                gap: 6,
              }}
            >
              {[
                ['ownership', 'task → attempt'],
                ['provenance', 'source linked'],
                ['verification', 'real command'],
                ['revision', 'append-only'],
              ].map(([label, value], index) => {
                const p = ease(frame, duration * (0.56 + index * 0.045), duration * 0.12);
                return (
                  <div
                    key={label}
                    style={{
                      padding: '8px 9px',
                      border: `1px solid ${brand.line}`,
                      borderRadius: 5,
                      background: brand.graphite,
                      opacity: p,
                      fontFamily: font.mono,
                    }}
                  >
                    <div style={{ fontSize: 8, color: brand.faint, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 9.5, color: brand.text }}>{value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ProductWindow>
      <Statement primary={COPY.record.primary} delay={duration * 0.68} />
    </SceneFrame>
  );
};
