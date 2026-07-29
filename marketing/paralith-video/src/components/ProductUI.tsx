import React from 'react';
import { useCurrentFrame } from 'remotion';
import { brand, font } from '../styles/tokens';
import { ease, seeded } from '../utils/motion';

export const StatusDot: React.FC<{ color: string; live?: boolean; size?: number }> = ({
  color,
  live = true,
  size = 7,
}) => {
  const frame = useCurrentFrame();
  const opacity = live ? 0.58 + 0.42 * (0.5 + Math.sin(frame / 8) / 2) : 0.5;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        display: 'inline-block',
        background: color,
        opacity,
        boxShadow: live ? `0 0 ${size * 1.7}px ${color}` : undefined,
      }}
    />
  );
};

export const Tag: React.FC<{
  children: React.ReactNode;
  color?: string;
}> = ({ children, color = brand.muted }) => (
  <span
    style={{
      fontFamily: font.mono,
      fontSize: 10,
      letterSpacing: '0.06em',
      color,
      border: `1px solid ${brand.line}`,
      borderRadius: 4,
      padding: '3px 6px',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </span>
);

export const ProgressRail: React.FC<{ value: number; color?: string }> = ({
  value,
  color = brand.blue,
}) => (
  <div style={{ height: 2, background: 'rgba(255,255,255,.09)', borderRadius: 2 }}>
    <div
      style={{
        width: `${Math.max(0, Math.min(1, value)) * 100}%`,
        height: '100%',
        background: color,
        borderRadius: 2,
      }}
    />
  </div>
);

export const Panel: React.FC<{
  title: string;
  meta?: React.ReactNode;
  accent?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ title, meta, accent, children, style }) => (
  <div
    style={{
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      border: `1px solid ${brand.line}`,
      borderRadius: 8,
      background: brand.panel,
      boxShadow: '0 12px 34px rgba(0,0,0,.22)',
      ...style,
    }}
  >
    <div
      style={{
        height: 34,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 11px',
        background: brand.panelRaised,
        borderBottom: `1px solid ${brand.line}`,
      }}
    >
      {accent ? <StatusDot color={accent} /> : null}
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: font.mono,
          fontSize: 11,
          letterSpacing: '0.055em',
          color: brand.text,
        }}
      >
        {title}
      </span>
      <span style={{ marginLeft: 'auto' }}>{meta}</span>
    </div>
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
  </div>
);

export type TerminalLine = {
  text: string;
  tone?: 'text' | 'muted' | 'success' | 'warning' | 'danger' | 'accent';
};

const toneColor = {
  text: brand.text,
  muted: brand.muted,
  success: brand.success,
  warning: brand.warning,
  danger: brand.danger,
  accent: brand.cyan,
} as const;

export const TerminalLines: React.FC<{
  lines: readonly TerminalLine[];
  reveal?: number;
  compact?: boolean;
}> = ({ lines, reveal = 0, compact = false }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        padding: compact ? 10 : 14,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: compact ? 3 : 5,
        overflow: 'hidden',
        fontFamily: font.mono,
        fontSize: compact ? 9.5 : 11,
        lineHeight: 1.35,
      }}
    >
      {lines.map((line, index) => {
        const p = ease(frame, reveal + index * 8, 10);
        return (
          <div
            key={`${index}-${line.text}`}
            style={{
              color: toneColor[line.tone ?? 'muted'],
              opacity: p,
              transform: `translateY(${(1 - p) * 5}px)`,
              whiteSpace: 'nowrap',
            }}
          >
            {line.text}
          </div>
        );
      })}
    </div>
  );
};

export const CodeTexture: React.FC<{ seed: number; rows?: number }> = ({ seed, rows = 12 }) => (
  <div style={{ position: 'absolute', inset: 0, padding: 13, overflow: 'hidden' }}>
    {Array.from({ length: rows }, (_, index) => {
      const random = seeded(seed * 41 + index);
      return (
        <div
          key={index}
          style={{
            height: 4,
            width: `${18 + random * 68}%`,
            marginLeft: random > 0.74 ? 18 : 0,
            marginBottom: 12,
            borderRadius: 2,
            background: brand.faint,
            opacity: 0.34 + random * 0.25,
          }}
        />
      );
    })}
  </div>
);
