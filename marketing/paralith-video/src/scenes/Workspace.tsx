import React from 'react';
import { useCurrentFrame } from 'remotion';
import { ProductWindow } from '../components/ProductWindow';
import { Panel, ProgressRail, StatusDot, Tag, TerminalLines } from '../components/ProductUI';
import { SceneFrame } from '../components/SceneFrame';
import { Statement } from '../components/Typography';
import { COPY } from '../data/copy';
import { brand, font, roles } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { progress } from '../utils/motion';
import type { SceneProps } from './types';

const terminalA = [
  { text: '❯ codex exec "repair session ownership"', tone: 'text' as const },
  { text: '  inspecting 18 files', tone: 'muted' as const },
  { text: '  3 invariants verified', tone: 'success' as const },
  { text: '  working · src/auth', tone: 'accent' as const },
];

const terminalB = [
  { text: '❯ claude --session api-review', tone: 'text' as const },
  { text: '  checking IPC boundary', tone: 'muted' as const },
  { text: '  permission required', tone: 'warning' as const },
];

export const Workspace: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const portrait = layout.format === 'vertical';
  const work = progress(frame, duration * 0.18, duration * 0.58);
  const gridColumns = portrait ? '1fr' : '1.2fr 1fr';

  return (
    <SceneFrame duration={duration} glow="blue">
      <ProductWindow
        section="forgespace / primary"
        attention={frame < duration * 0.62 ? 1 : 0}
        sidebar={!portrait}
        revealAt={duration * 0.02}
      >
        <div
          style={{
            position: 'absolute',
            inset: 10,
            display: 'grid',
            gridTemplateColumns: gridColumns,
            gridTemplateRows: portrait ? '1fr 1fr 0.78fr' : '1fr 1fr',
            gap: 8,
          }}
        >
          <Panel
            title="builder · codex · feat/session-ownership"
            accent={roles.builder}
            meta={<Tag color={brand.success}>working</Tag>}
          >
            <TerminalLines lines={terminalA} reveal={duration * 0.1} />
          </Panel>
          <Panel
            title="reviewer · claude · api-review"
            accent={roles.reviewer}
            meta={<Tag color={frame < duration * 0.62 ? brand.warning : brand.success}>
              {frame < duration * 0.62 ? 'needs input' : 'resumed'}
            </Tag>}
          >
            <TerminalLines lines={terminalB} reveal={duration * 0.2} />
          </Panel>
          <Panel
            title="tests · native PTY"
            accent={brand.cyan}
            meta={<Tag color={brand.success}>{Math.floor(work * 48)}/48</Tag>}
          >
            <div
              style={{
                position: 'absolute',
                inset: 13,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 11,
              }}
            >
              {['frontend', 'rust', 'integration'].map((name, index) => (
                <div key={name}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                      fontFamily: font.mono,
                      fontSize: 9.5,
                      color: brand.muted,
                    }}
                  >
                    <span>{name}</span>
                    <span>{Math.round(Math.max(0, Math.min(1, work - index * 0.14)) * 100)}%</span>
                  </div>
                  <ProgressRail value={Math.max(0, Math.min(1, work - index * 0.14))} color={brand.success} />
                </div>
              ))}
            </div>
          </Panel>
          {!portrait ? (
            <Panel
              title="workspace context"
              meta={<Tag color={brand.blue}>main @ bfdbe3a</Tag>}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 14,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  alignContent: 'center',
                  gap: 12,
                  fontFamily: font.mono,
                  fontSize: 10,
                  color: brand.muted,
                }}
              >
                {[
                  ['branch', 'feat/session-ownership'],
                  ['worktree', 'isolated'],
                  ['files', '18 changed'],
                  ['state', 'review gated'],
                ].map(([label, value], index) => (
                  <div key={label} style={{ borderLeft: `2px solid ${index === 3 ? brand.warning : brand.lineStrong}`, paddingLeft: 9 }}>
                    <div style={{ color: brand.faint, marginBottom: 4 }}>{label}</div>
                    <div style={{ color: brand.text }}>{value}</div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : (
            <Panel title="attention router" accent={brand.warning}>
              <div
                style={{
                  position: 'absolute',
                  inset: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontFamily: font.mono,
                  fontSize: 11,
                  color: brand.text,
                }}
              >
                <span style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                  <StatusDot color={brand.warning} />
                  reviewer needs input
                </span>
                <Tag color={brand.cyan}>focus next</Tag>
              </div>
            </Panel>
          )}
        </div>
      </ProductWindow>
      <Statement
        primary={COPY.workspace.primary}
        secondary={COPY.workspace.secondary}
        delay={duration * 0.56}
      />
    </SceneFrame>
  );
};
