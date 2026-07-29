import React from 'react';
import { useCurrentFrame } from 'remotion';
import { brand } from '../styles/tokens';
import { ease } from '../utils/motion';

export const CursorPath: React.FC<{
  from: { x: number; y: number };
  to: { x: number; y: number };
  start: number;
  duration?: number;
  clickAt?: number;
}> = ({ from, to, start, duration = 42, clickAt }) => {
  const frame = useCurrentFrame();
  const p = ease(frame, start, duration);
  const x = from.x + (to.x - from.x) * p;
  const y = from.y + (to.y - from.y) * p;
  const click = clickAt === undefined ? 0 : Math.max(0, 1 - Math.abs(frame - clickAt) / 9);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 18,
        height: 24,
        zIndex: 30,
        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.7))',
      }}
    >
      {click > 0 ? (
        <span
          style={{
            position: 'absolute',
            width: 36 + click * 18,
            height: 36 + click * 18,
            borderRadius: 99,
            border: `1px solid ${brand.cyan}`,
            left: -15 - click * 9,
            top: -15 - click * 9,
            opacity: click * 0.8,
          }}
        />
      ) : null}
      <svg width="18" height="24" viewBox="0 0 18 24">
        <path
          d="M2 1.5v17.2l4.2-4.1 3.4 7.2 3.2-1.5-3.3-7.1h6.1L2 1.5Z"
          fill="#f8fafc"
          stroke="#05070d"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
