import React from 'react';
import { useCurrentFrame } from 'remotion';
import { ProductWindow } from '../components/ProductWindow';
import { Panel, StatusDot, Tag } from '../components/ProductUI';
import { SceneFrame } from '../components/SceneFrame';
import { Statement } from '../components/Typography';
import { COPY } from '../data/copy';
import { brand, font } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease, progress } from '../utils/motion';
import type { SceneProps } from './types';

const changed = [
  ['M', 'src/auth/session.ts', '+64 −18'],
  ['M', 'src/auth/restore.ts', '+31 −12'],
  ['A', 'src/auth/ownership.ts', '+118'],
  ['M', 'tests/session.test.ts', '+52 −4'],
] as const;

const diff = [
  ['@@', 'export function restoreSession(id: string) {'],
  ['−', '  return sessions.get(id);'],
  ['+', '  const session = sessions.get(id);'],
  ['+', '  assertWorkspaceOwnership(session, activeWorkspace);'],
  ['+', '  return session;'],
  [' ', '}'],
] as const;

export const Repository: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const portrait = layout.format === 'vertical';
  const journey = progress(frame, duration * 0.12, duration * 0.7);
  const selected = Math.min(3, Math.floor(journey * 4));

  return (
    <SceneFrame duration={duration} glow="blue">
      <ProductWindow
        section="repository / forgespace"
        attention={0}
        sidebar={!portrait}
        revealAt={duration * 0.01}
      >
        <div
          style={{
            position: 'absolute',
            inset: 9,
            display: 'grid',
            gridTemplateColumns: portrait ? '1fr' : '0.62fr 1.38fr',
            gridTemplateRows: portrait ? '0.74fr 1.26fr' : '1fr',
            gap: 8,
          }}
        >
          <Panel
            title="changes"
            meta={<Tag color={brand.warning}>4 files</Tag>}
          >
            <div style={{ padding: 9, fontFamily: font.mono, fontSize: portrait ? 9 : 10 }}>
              {changed.map(([state, file, delta], index) => (
                <div
                  key={file}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px 1fr auto',
                    alignItems: 'center',
                    gap: 7,
                    padding: '8px 7px',
                    borderRadius: 5,
                    background: index === selected ? brand.panelHigh : 'transparent',
                    color: index === selected ? brand.text : brand.muted,
                  }}
                >
                  <span style={{ color: state === 'A' ? brand.success : brand.warning }}>{state}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file}</span>
                  <span style={{ color: brand.faint }}>{delta}</span>
                </div>
              ))}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3,1fr)',
                  gap: 5,
                  marginTop: 11,
                }}
              >
                {[
                  ['branch', 'feat/session-owner'],
                  ['pull request', '#58 draft'],
                  ['workflow', journey > 0.68 ? 'passed' : 'running'],
                  ['release', 'preview'],
                  ['security', '0 open'],
                  ['ledger', '9 operations'],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    style={{
                      padding: '8px 7px',
                      border: `1px solid ${brand.line}`,
                      borderRadius: 5,
                      background: index === Math.floor(journey * 6) ? 'rgba(79,107,255,.08)' : brand.graphite,
                    }}
                  >
                    <div style={{ color: brand.faint, fontSize: 8, marginBottom: 5 }}>{label}</div>
                    <div style={{ color: value === 'passed' ? brand.success : brand.text, fontSize: 9 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
          <Panel
            title={`diff · ${changed[selected]?.[1] ?? changed[0][1]}`}
            meta={<Tag color={brand.blue}>unified</Tag>}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                padding: portrait ? 9 : 14,
                fontFamily: font.mono,
                fontSize: portrait ? 8.5 : 10.5,
                lineHeight: 1.8,
                overflow: 'hidden',
              }}
            >
              {diff.map(([kind, line], index) => {
                const p = ease(frame, duration * 0.18 + index * duration * 0.035, duration * 0.08);
                const color =
                  kind === '+'
                    ? brand.success
                    : kind === '−'
                      ? brand.danger
                      : kind === '@@'
                        ? brand.cyan
                        : brand.muted;
                const background =
                  kind === '+'
                    ? 'rgba(103,211,145,.07)'
                    : kind === '−'
                      ? 'rgba(241,107,112,.07)'
                      : 'transparent';
                return (
                  <div
                    key={`${kind}-${index}`}
                    style={{
                      color,
                      background,
                      padding: '0 8px',
                      whiteSpace: 'pre',
                      opacity: p,
                    }}
                  >
                    <span style={{ display: 'inline-block', width: 22 }}>{kind}</span>
                    {line}
                  </div>
                );
              })}
              <div
                style={{
                  position: 'absolute',
                  left: 14,
                  right: 14,
                  bottom: 12,
                  display: 'flex',
                  gap: 7,
                  justifyContent: 'flex-end',
                }}
              >
                <Tag color={brand.muted}>open in editor</Tag>
                <Tag color={brand.success}>stage reviewed file</Tag>
              </div>
            </div>
          </Panel>
        </div>
      </ProductWindow>
      <Statement
        primary={COPY.repository.primary}
        secondary={COPY.repository.secondary}
        delay={duration * 0.65}
      />
    </SceneFrame>
  );
};
