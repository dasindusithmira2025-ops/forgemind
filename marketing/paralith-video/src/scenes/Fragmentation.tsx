import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { Panel, StatusDot, Tag, TerminalLines } from '../components/ProductUI';
import { SceneFrame } from '../components/SceneFrame';
import { COPY } from '../data/copy';
import { brand, font } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { ease } from '../utils/motion';
import type { SceneProps } from './types';

const fragments = [
  { title: 'terminal · auth-migration', type: 'terminal', x: 0.06, y: 0.19, w: 0.31, h: 0.24 },
  { title: 'agent · codex', type: 'agent', x: 0.62, y: 0.12, w: 0.3, h: 0.2 },
  { title: 'pull request #58', type: 'pr', x: 0.55, y: 0.58, w: 0.35, h: 0.22 },
  { title: 'repository', type: 'repo', x: 0.12, y: 0.59, w: 0.31, h: 0.19 },
  { title: 'task queue', type: 'task', x: 0.37, y: 0.32, w: 0.26, h: 0.2 },
] as const;

const FragmentBody: React.FC<{ type: (typeof fragments)[number]['type'] }> = ({ type }) => {
  if (type === 'terminal') {
    return (
      <TerminalLines
        compact
        lines={[
          { text: '❯ npm test -- auth', tone: 'text' },
          { text: '  42 passed · 1 failed', tone: 'warning' },
          { text: '  waiting for review', tone: 'muted' },
        ]}
      />
    );
  }
  if (type === 'agent') {
    return (
      <div style={{ padding: 12, fontFamily: font.mono, fontSize: 10, color: brand.muted }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', color: brand.text }}>
          <StatusDot color={brand.warning} />
          needs permission
        </div>
        <div style={{ marginTop: 12 }}>scope: packages/auth</div>
        <div style={{ marginTop: 5, color: brand.faint }}>waiting 01:24</div>
      </div>
    );
  }
  if (type === 'pr') {
    return (
      <div style={{ padding: 12, fontFamily: font.ui, fontSize: 11, color: brand.muted }}>
        <div style={{ color: brand.text }}>fix(auth): rotate session model</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 13 }}>
          <Tag color={brand.warning}>2 reviews</Tag>
          <Tag color={brand.success}>checks 7/8</Tag>
        </div>
      </div>
    );
  }
  if (type === 'repo') {
    return (
      <div style={{ padding: 12, fontFamily: font.mono, fontSize: 10, lineHeight: 1.8 }}>
        <div style={{ color: brand.text }}>feat/session-rework</div>
        <div style={{ color: brand.success }}>+ 182</div>
        <div style={{ color: brand.danger }}>− 47</div>
      </div>
    );
  }
  return (
    <div style={{ padding: 11, fontFamily: font.mono, fontSize: 9.5, color: brand.muted }}>
      {['schema', 'client', 'tests'].map((task, index) => (
        <div key={task} style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
          <StatusDot color={index === 0 ? brand.success : index === 1 ? brand.warning : brand.faint} />
          {task}
        </div>
      ))}
    </div>
  );
};

export const Fragmentation: React.FC<SceneProps> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const layout = useFilmLayout();
  const portrait = layout.format === 'vertical';
  const copyOne = ease(frame, duration * 0.11, duration * 0.12);
  const copyTwo = ease(frame, duration * 0.57, duration * 0.13);

  return (
    <SceneFrame duration={duration} glow="none">
      {fragments.map((fragment, index) => {
        const p = ease(frame, duration * (0.08 + index * 0.085), duration * 0.1);
        const x = portrait
          ? layout.safeX + (index % 2) * (width * 0.47)
          : width * fragment.x;
        const y = portrait
          ? height * (0.16 + Math.floor(index / 2) * 0.16)
          : height * fragment.y;
        const w = portrait ? width * (index === 4 ? 0.88 : 0.41) : width * fragment.w;
        const h = portrait ? height * 0.12 : height * fragment.h;
        return (
          <Panel
            key={fragment.title}
            title={fragment.title}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: h,
              opacity: p * (0.82 + index * 0.035),
              transform: `translateY(${(1 - p) * 26}px)`,
            }}
          >
            <FragmentBody type={fragment.type} />
          </Panel>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: layout.safeX,
          right: layout.safeX,
          top: portrait ? height * 0.7 : height * 0.44,
          textAlign: 'center',
          fontFamily: font.ui,
          fontSize: portrait ? width * 0.084 : width * 0.052,
          lineHeight: 1,
          fontWeight: 610,
          letterSpacing: '-0.055em',
        }}
      >
        <div style={{ color: brand.white, opacity: copyOne }}>{COPY.fragmentation.primary}</div>
        <div
          style={{
            marginTop: portrait ? 16 : 20,
            color: brand.muted,
            opacity: copyTwo,
            transform: `translateY(${(1 - copyTwo) * 20}px)`,
          }}
        >
          {COPY.fragmentation.secondary}
        </div>
      </div>
    </SceneFrame>
  );
};
