import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { DISPLAY, INK, MONO, SIZE, STATE, TRACK, WEIGHT, useScale } from './design';
import { Grade, Grain } from './stage';
import { CLOSE, LINE_Y } from './script';

/**
 * The key art.
 *
 * A poster is not a frame grab. This one is composed rather than lifted: the rail runs edge to
 * edge, the three gates stand on it evenly spaced with their conditions written underneath, and
 * the object sits between the second and the third — which is the only position in the film where
 * a viewer can see both what it has already survived and what it has not yet been given.
 *
 * Rendered at 3840×2160 as `ParalithGatePoster` and used as the video poster frame, the social
 * card and the press still.
 */
export const GatePoster: React.FC = () => {
  const k = useScale();

  const gates = [
    { x: 620, label: 'isolation', condition: 'not your working tree' },
    { x: 1010, label: 'verification', condition: 'all checks must pass' },
    { x: 1400, label: 'consent', condition: 'requires a person' },
  ];

  return (
    <AbsoluteFill style={{ background: INK.field }}>
      {/* The rail. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: LINE_Y * k,
          width: '100%',
          height: Math.max(1, 1 * k),
          background:
            'linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 16%, rgba(255,255,255,0.26) 50%, rgba(255,255,255,0.18) 84%, rgba(255,255,255,0) 100%)',
        }}
      />

      {gates.map((gate, index) => (
        <div key={gate.label} style={{ position: 'absolute', left: (gate.x - 7) * k, top: (LINE_Y - 84) * k }}>
          {[0, 1].map((half) => (
            <div
              key={half}
              style={{
                position: 'absolute',
                top: half * 85.5 * k,
                width: 14 * k,
                height: 82.5 * k,
                background: `linear-gradient(to bottom, ${INK.surfaceLift}, ${INK.surface})`,
                border: `${Math.max(1, k)}px solid ${INK.line}`,
                boxSizing: 'border-box',
              }}
            />
          ))}
          <div
            style={{
              position: 'absolute',
              left: -2 * k,
              top: 83 * k,
              width: 18 * k,
              height: Math.max(1, 2 * k),
              /** The third seam is the only one lit: it is the gate that has not been opened. */
              background: index === 2 ? STATE.accent : INK.edge,
              opacity: index === 2 ? 1 : 0.55,
              boxShadow: index === 2 ? `0 0 ${16 * k}px rgba(167,139,250,0.6)` : 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: -8 * k,
              top: -44 * k,
              whiteSpace: 'nowrap',
              fontFamily: MONO,
              fontSize: SIZE.station * k,
              letterSpacing: TRACK.station,
              textTransform: 'uppercase',
              color: index === 2 ? STATE.accent : INK.muted,
            }}
          >
            {gate.label}
          </div>
          <div
            style={{
              position: 'absolute',
              left: -8 * k,
              top: 190 * k,
              whiteSpace: 'nowrap',
              fontFamily: MONO,
              fontSize: SIZE.machineSmall * k,
              letterSpacing: TRACK.machine,
              color: INK.ghost,
            }}
          >
            {gate.condition}
          </div>
        </div>
      ))}

      {/* The object, between the second gate and the third. */}
      <div
        style={{
          position: 'absolute',
          left: (1206 - 7) * k,
          top: (LINE_Y - 7) * k,
          width: 14 * k,
          height: 14 * k,
          background: STATE.accent,
          boxShadow: `0 0 ${22 * k}px ${STATE.accent}77`,
        }}
      />

      {/* The lockup, above the line and left-aligned to the film's own margin. */}
      <div style={{ position: 'absolute', left: 104 * k, top: 150 * k, display: 'flex', alignItems: 'center', gap: 22 * k }}>
        <Img src={staticFile('brand/mark.png')} style={{ width: 74 * k }} />
        <Img src={staticFile('brand/wordmark.png')} style={{ width: 300 * k, maxWidth: 'none' }} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 104 * k,
          top: 300 * k,
          maxWidth: 1120 * k,
          fontFamily: DISPLAY,
          fontSize: 96 * k,
          fontWeight: WEIGHT.statement,
          letterSpacing: TRACK.statement,
          lineHeight: 1.16,
          color: INK.bright,
        }}
      >
        {CLOSE.statement}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 104 * k,
          top: (LINE_Y + 210) * k,
          display: 'grid',
          gap: 14 * k,
          fontFamily: DISPLAY,
          fontSize: SIZE.category * k,
          letterSpacing: TRACK.category,
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: INK.muted }}>{CLOSE.category}</span>
        <span style={{ color: INK.ghost, fontSize: SIZE.fine * k, letterSpacing: TRACK.fine }}>
          {CLOSE.url}
        </span>
      </div>

      <Grade intensity={0.8} />
      <Grain />
    </AbsoluteFill>
  );
};
