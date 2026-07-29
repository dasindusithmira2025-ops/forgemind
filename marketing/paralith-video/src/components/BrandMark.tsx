import React from 'react';
import { Img, staticFile } from 'remotion';

export const BrandMark: React.FC<{
  size: number;
  opacity?: number;
  glow?: number;
  wordmark?: boolean;
}> = ({ size, opacity = 1, glow = 1, wordmark = false }) => (
  <Img
    src={staticFile(wordmark ? 'brand/wordmark-alpha.png' : 'brand/mark-alpha.png')}
    style={{
      width: wordmark ? size * 3.6 : size,
      height: size,
      objectFit: 'contain',
      opacity,
      filter: `drop-shadow(0 20px ${38 * glow}px rgba(62,85,255,${0.28 * glow}))`,
    }}
  />
);
