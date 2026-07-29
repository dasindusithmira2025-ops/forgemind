import React from 'react';
import { Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { brand, font } from '../styles/tokens';
import { useFilmLayout } from '../utils/layout';
import { physical } from '../utils/motion';
import { StatusDot } from './ProductUI';

const nav = [
  { label: 'forgespace', state: brand.success },
  { label: 'auth-migration', state: brand.warning },
  { label: 'release-preview', state: brand.blue },
];

export const ProductWindow: React.FC<{
  children: React.ReactNode;
  section: string;
  revealAt?: number;
  attention?: number;
  sidebar?: boolean;
  style?: React.CSSProperties;
}> = ({ children, section, revealAt = 0, attention = 1, sidebar = true, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useFilmLayout();
  const p = physical(frame, fps, revealAt);
  const product = layout.product;
  const sidebarWidth = sidebar ? Math.max(116, product.width * 0.17) : 0;
  const scaleType = Math.max(0.72, Math.min(1.25, product.width / 1600));

  return (
    <div
      style={{
        position: 'absolute',
        left: product.x,
        top: product.y,
        width: product.width,
        height: product.height,
        borderRadius: Math.max(10, product.width * 0.007),
        overflow: 'hidden',
        border: `1px solid ${brand.lineStrong}`,
        background: brand.graphite,
        boxShadow: `0 ${40 * p}px ${120 * p}px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.025)`,
        opacity: p,
        transform: `translateY(${(1 - p) * 30}px) scale(${0.975 + p * 0.025})`,
        transformOrigin: '50% 58%',
        fontSize: 14 * scaleType,
        ...style,
      }}
    >
      <div
        style={{
          height: Math.max(34, product.height * 0.055),
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${Math.max(12, product.width * 0.009)}px`,
          gap: 9,
          background: '#10121a',
          borderBottom: `1px solid ${brand.line}`,
        }}
      >
        <Img
          src={staticFile('brand/mark-alpha.png')}
          style={{ width: 27 * scaleType, height: 27 * scaleType, objectFit: 'contain' }}
        />
        <span
          style={{
            fontFamily: font.ui,
            fontWeight: 620,
            fontSize: 12 * scaleType,
            color: brand.text,
          }}
        >
          PARALITH
        </span>
        <span
          style={{
            margin: '0 auto',
            fontFamily: font.mono,
            fontSize: 9.5 * scaleType,
            letterSpacing: '.06em',
            color: brand.faint,
          }}
        >
          {section}
        </span>
        <span
          style={{
            display: 'flex',
            gap: 7,
            alignItems: 'center',
            fontFamily: font.mono,
            fontSize: 9 * scaleType,
            color: brand.warning,
          }}
        >
          <StatusDot color={attention > 0 ? brand.warning : brand.success} size={6 * scaleType} />
          {attention > 0 ? `${attention} needs attention` : 'all clear'}
        </span>
        <span
          style={{
            marginLeft: 7,
            fontFamily: font.mono,
            color: brand.faint,
            letterSpacing: '.7em',
            fontSize: 9 * scaleType,
          }}
        >
          — □ ×
        </span>
      </div>
      <div style={{ position: 'absolute', inset: `${Math.max(34, product.height * 0.055)}px 0 0` }}>
        {sidebar ? (
          <div
            style={{
              position: 'absolute',
              inset: `0 auto 0 0`,
              width: sidebarWidth,
              padding: `${Math.max(12, product.height * 0.022)}px 8px`,
              background: '#090b10',
              borderRight: `1px solid ${brand.line}`,
            }}
          >
            <div
              style={{
                padding: '0 9px 10px',
                fontFamily: font.mono,
                fontSize: 8.5 * scaleType,
                textTransform: 'uppercase',
                letterSpacing: '.17em',
                color: brand.faint,
              }}
            >
              Projects
            </div>
            {nav.map((item, index) => (
              <div
                key={item.label}
                style={{
                  position: 'relative',
                  height: 29 * scaleType,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 8px',
                  borderRadius: 5,
                  background: index === 0 ? brand.panelRaised : 'transparent',
                  color: index === 0 ? brand.text : brand.muted,
                  fontFamily: font.ui,
                  fontSize: 11 * scaleType,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                {index === 0 ? (
                  <span
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 6,
                      bottom: 6,
                      width: 2,
                      background: brand.violet,
                    }}
                  />
                ) : null}
                <StatusDot color={item.state} live={index !== 2} size={5.5 * scaleType} />
                {item.label}
              </div>
            ))}
            <div
              style={{
                margin: '15px 9px 8px',
                fontFamily: font.mono,
                fontSize: 8.5 * scaleType,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: brand.faint,
              }}
            >
              Workspace
            </div>
            {['primary', 'api-review', 'release'].map((item, index) => (
              <div
                key={item}
                style={{
                  height: 26 * scaleType,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 18,
                  color: index === 0 ? brand.text : brand.faint,
                  fontFamily: font.ui,
                  fontSize: 10.5 * scaleType,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ position: 'absolute', inset: `0 0 0 ${sidebarWidth}px` }}>{children}</div>
      </div>
    </div>
  );
};
