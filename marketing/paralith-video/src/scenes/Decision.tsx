import React from 'react';
import { useCurrentFrame } from 'remotion';
import { CursorPath } from '../components/CursorPath';
import { ProductWindow } from '../components/ProductWindow';
import { Panel, StatusDot, Tag } from '../components/ProductUI';
import { SceneFrame } from '../components/SceneFrame';
import { Statement } from '../components/Typography';
import { COPY } from '../data/copy';
import { brand, font } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease } from '../utils/motion';
import type { SceneProps } from './types';

const checks = [
  ['TypeScript', 'passed', '12.4s'],
  ['Rust tests', 'passed', '31.8s'],
  ['Ownership invariant', 'verified', 'source'],
  ['Repository state', 'clean gate', 'bfdbe3a'],
] as const;

export const Decision: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const portrait = layout.format === 'vertical';
  const approved = frame > duration * 0.66;
  const complete = ease(frame, duration * 0.68, duration * 0.13);

  return (
    <SceneFrame duration={duration} glow="green">
      <ProductWindow
        section="repository / review gate"
        attention={approved ? 0 : 1}
        sidebar={!portrait}
        revealAt={duration * 0.01}
      >
        <div
          style={{
            position: 'absolute',
            inset: 10,
            display: 'grid',
            gridTemplateColumns: portrait ? '1fr' : '1.15fr .85fr',
            gridTemplateRows: portrait ? '1.1fr .9fr' : '1fr',
            gap: 8,
          }}
        >
          <Panel title="review · feat/session-owner" meta={<Tag color={brand.blue}>4 files</Tag>}>
            <div
              style={{
                position: 'absolute',
                inset: 12,
                display: 'flex',
                flexDirection: 'column',
                fontFamily: font.mono,
                fontSize: portrait ? 9 : 10.5,
              }}
            >
              <div style={{ color: brand.faint, marginBottom: 11 }}>files changed</div>
              {[
                ['src/auth/session.ts', '+64 −18'],
                ['src/auth/ownership.ts', '+118'],
                ['src/auth/restore.ts', '+31 −12'],
                ['tests/session.test.ts', '+52 −4'],
              ].map(([file, delta], index) => (
                <div
                  key={file}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '7px 0',
                    borderBottom: `1px solid ${brand.line}`,
                    color: brand.text,
                    opacity: ease(frame, duration * 0.09 + index * 16, duration * 0.09),
                  }}
                >
                  <span>{file}</span>
                  <span style={{ color: brand.muted }}>{delta}</span>
                </div>
              ))}
              <div
                style={{
                  marginTop: 'auto',
                  padding: '10px',
                  border: `1px solid ${brand.line}`,
                  borderRadius: 6,
                  background: brand.graphite,
                  color: brand.muted,
                  lineHeight: 1.6,
                }}
              >
                ownership checks are enforced before a restored session becomes interactive
              </div>
            </div>
          </Panel>
          <Panel
            title="evidence"
            meta={<Tag color={approved ? brand.success : brand.warning}>{approved ? 'approved' : 'awaiting human'}</Tag>}
          >
            <div
              style={{
                position: 'absolute',
                inset: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                fontFamily: font.mono,
                fontSize: portrait ? 9 : 10,
              }}
            >
              {checks.map(([label, state, meta], index) => {
                const p = ease(frame, duration * (0.16 + index * 0.07), duration * 0.1);
                return (
                  <div
                    key={label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '14px 1fr auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 7px',
                      borderBottom: `1px solid ${brand.line}`,
                      opacity: p,
                    }}
                  >
                    <StatusDot color={brand.success} live={false} />
                    <span style={{ color: brand.text }}>{label}</span>
                    <span style={{ color: brand.faint }}>{state} · {meta}</span>
                  </div>
                );
              })}
              <div
                style={{
                  marginTop: 'auto',
                  height: 38,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  color: approved ? brand.black : brand.white,
                  background: approved ? brand.success : brand.blue,
                  fontFamily: font.ui,
                  fontWeight: 620,
                  fontSize: 11,
                  transform: `scale(${1 + complete * 0.01})`,
                }}
              >
                {approved ? 'Approved · merge queued' : 'Approve reviewed change'}
              </div>
            </div>
          </Panel>
        </div>
      </ProductWindow>
      {!portrait ? (
        <CursorPath
          from={{ x: layout.width * 0.72, y: layout.height * 0.45 }}
          to={{ x: layout.width * 0.75, y: layout.height * 0.68 }}
          start={duration * 0.47}
          duration={duration * 0.16}
          clickAt={duration * 0.66}
        />
      ) : null}
      <Statement primary={COPY.decision.primary} delay={duration * 0.67} />
    </SceneFrame>
  );
};
