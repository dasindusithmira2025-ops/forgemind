import React from 'react';
import { useCurrentFrame } from 'remotion';
import { CursorPath } from '../components/CursorPath';
import { ProductWindow } from '../components/ProductWindow';
import { Panel, ProgressRail, StatusDot, Tag } from '../components/ProductUI';
import { SceneFrame } from '../components/SceneFrame';
import { Statement } from '../components/Typography';
import { COPY } from '../data/copy';
import { brand, font, roles } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease, progress } from '../utils/motion';
import type { SceneProps } from './types';

const agents = [
  { role: 'coordinator', provider: 'claude', branch: 'plan/session-model', color: roles.coordinator },
  { role: 'scout', provider: 'codex', branch: 'audit/ipc-boundary', color: roles.scout },
  { role: 'builder', provider: 'codex', branch: 'feat/session-owner', color: roles.builder },
  { role: 'reviewer', provider: 'claude', branch: 'review/session-owner', color: roles.reviewer },
  { role: 'debugger', provider: 'codex', branch: 'fix/restore-path', color: roles.debugger },
  { role: 'integrator', provider: 'claude', branch: 'integrate/auth-rework', color: roles.integrator },
] as const;

export const Parallel: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const portrait = layout.format === 'vertical';
  const gateOpen = frame > duration * 0.56;
  const columns = portrait ? 2 : 3;

  return (
    <SceneFrame duration={duration} glow="violet">
      <ProductWindow
        section="swarms / auth-session-rework"
        attention={gateOpen ? 1 : 0}
        sidebar={!portrait}
        revealAt={duration * 0.01}
      >
        <div
          style={{
            position: 'absolute',
            inset: 10,
            display: 'grid',
            gridTemplateRows: 'auto 1fr auto',
            gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 11px',
              border: `1px solid ${brand.line}`,
              borderRadius: 7,
              background: brand.panel,
            }}
          >
            <div>
              <div style={{ fontFamily: font.ui, fontSize: 12, color: brand.text }}>
                Repair session ownership without breaking saved Workspaces
              </div>
              <div style={{ fontFamily: font.mono, fontSize: 9.5, color: brand.faint, marginTop: 4 }}>
                6 roles · isolated worktrees · human merge gate
              </div>
            </div>
            <Tag color={gateOpen ? brand.warning : brand.success}>
              {gateOpen ? '1 attention request' : 'running'}
            </Tag>
          </div>
          <div
            style={{
              display: 'grid',
              minHeight: 0,
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: 7,
            }}
          >
            {agents.map((agent, index) => {
              const p = ease(frame, duration * (0.08 + index * 0.035), duration * 0.1);
              const taskProgress = progress(
                frame,
                duration * (0.16 + index * 0.025),
                duration * (0.44 + index * 0.02),
              );
              const needs = index === 3 && gateOpen;
              return (
                <Panel
                  key={agent.role}
                  title={`${agent.role} · ${agent.provider}`}
                  accent={agent.color}
                  meta={
                    <StatusDot
                      color={needs ? brand.warning : taskProgress >= 1 ? brand.success : agent.color}
                    />
                  }
                  style={{
                    opacity: p,
                    transform: `translateY(${(1 - p) * 16}px)`,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      fontFamily: font.mono,
                      fontSize: portrait ? 8.5 : 9.5,
                    }}
                  >
                    <div>
                      <div style={{ color: brand.faint, marginBottom: 5 }}>managed worktree</div>
                      <div style={{ color: brand.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.branch}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: needs ? brand.warning : brand.muted,
                          marginBottom: 6,
                        }}
                      >
                        <span>{needs ? 'permission required' : taskProgress >= 1 ? 'complete' : 'working'}</span>
                        <span>{Math.round(taskProgress * 100)}%</span>
                      </div>
                      <ProgressRail
                        value={taskProgress}
                        color={needs ? brand.warning : taskProgress >= 1 ? brand.success : agent.color}
                      />
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 11px',
              border: `1px solid ${gateOpen ? 'rgba(239,182,78,.4)' : brand.line}`,
              borderRadius: 7,
              background: gateOpen ? 'rgba(239,182,78,.06)' : brand.panel,
              fontFamily: font.mono,
              fontSize: 9.5,
              color: gateOpen ? brand.warning : brand.muted,
            }}
          >
            <span>{gateOpen ? 'reviewer requests permission to run migration tests' : 'task ownership is isolated by branch and worktree'}</span>
            <Tag color={gateOpen ? brand.cyan : brand.success}>{gateOpen ? 'review' : 'verified'}</Tag>
          </div>
        </div>
      </ProductWindow>
      {!portrait && gateOpen ? (
        <CursorPath
          from={{ x: layout.width * 0.76, y: layout.height * 0.54 }}
          to={{ x: layout.width * 0.84, y: layout.height * 0.68 }}
          start={duration * 0.59}
          duration={duration * 0.12}
          clickAt={duration * 0.73}
        />
      ) : null}
      <Statement
        primary={COPY.parallel.primary}
        secondary={COPY.parallel.secondary}
        delay={duration * 0.66}
      />
    </SceneFrame>
  );
};
