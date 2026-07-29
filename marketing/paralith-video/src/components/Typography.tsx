import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { brand, font, spectrum } from '../styles/tokens';
import { ease, physical } from '../utils/motion';
import { useFilmLayout } from '../utils/layout';

export const Eyebrow: React.FC<{ children: React.ReactNode; delay?: number }> = ({
  children,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = physical(frame, fps, delay);
  const layout = useFilmLayout();
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: layout.bodySize * 0.62,
        fontWeight: 620,
        letterSpacing: '0.19em',
        textTransform: 'uppercase',
        color: brand.cyan,
        opacity: p,
        transform: `translateY(${(1 - p) * 12}px)`,
      }}
    >
      {children}
    </div>
  );
};

export const Headline: React.FC<{
  children: React.ReactNode;
  delay?: number;
  align?: 'left' | 'center';
  size?: number;
  maxWidth?: number | string;
}> = ({ children, delay = 0, align = 'left', size, maxWidth }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const p = ease(frame, delay, 32);
  return (
    <div
      style={{
        fontFamily: font.ui,
        fontSize: size ?? layout.headlineSize,
        fontWeight: 610,
        lineHeight: 0.98,
        letterSpacing: '-0.055em',
        color: brand.white,
        textAlign: align,
        maxWidth,
        opacity: p,
        transform: `translateY(${(1 - p) * 28}px)`,
      }}
    >
      {children}
    </div>
  );
};

export const Flare: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      background: spectrum,
      WebkitBackgroundClip: 'text',
      color: 'transparent',
    }}
  >
    {children}
  </span>
);

export const Statement: React.FC<{
  primary: string;
  secondary?: string;
  delay?: number;
  position?: 'top' | 'bottom' | 'center';
}> = ({ primary, secondary, delay = 0, position = 'bottom' }) => {
  const frame = useCurrentFrame();
  const layout = useFilmLayout();
  const p2 = ease(frame, delay + 54, 32);
  const portrait = layout.format === 'vertical';
  const social = layout.format !== 'landscape';
  const top =
    position === 'center'
      ? '46%'
      : position === 'top'
        ? layout.safeY
        : layout.format === 'vertical'
          ? layout.height * 0.77
          : layout.format === 'square'
            ? layout.height * 0.79
            : layout.height * 0.83;

  return (
    <div
      style={{
        position: 'absolute',
        left: layout.safeX,
        right: layout.safeX,
        top,
        transform: position === 'center' ? 'translateY(-50%)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: portrait || position === 'center' ? 'center' : 'flex-start',
        gap: layout.bodySize * 0.65,
      }}
    >
      <Headline
        delay={delay}
        align={portrait || position === 'center' ? 'center' : 'left'}
        size={primary.length > 28 ? layout.headlineSize * 0.82 : undefined}
      >
        {primary}
      </Headline>
      {secondary && !social ? (
        <div
          style={{
            fontFamily: font.ui,
            fontSize: layout.bodySize * 1.18,
            letterSpacing: '-0.025em',
            color: brand.muted,
            textAlign: portrait || position === 'center' ? 'center' : 'left',
            opacity: p2,
            transform: `translateY(${(1 - p2) * 16}px)`,
          }}
        >
          {secondary}
        </div>
      ) : null}
    </div>
  );
};
