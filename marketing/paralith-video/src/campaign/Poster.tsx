import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { WINDOW } from '../product/ProductWindow';
import { Workspace } from '../product/Workspace';
import { LATE_WAIT } from '../product/scenario';
import { Stage, useScale, Vignette } from '../film/Layers';
import { DISPLAY, INK, SIZE, TRACK, WEIGHT } from './type';
import { CLOSE } from './script';

/**
 * The poster frame.
 *
 * A poster is not a screenshot of the film's best frame — it has to work as a still, at thumbnail
 * size, with no motion to carry it. So it is composed rather than grabbed: the product wide and
 * slightly low in the frame, the statement above it, the mark small and bottom-right where a
 * viewer's eye lands last.
 *
 * The window is the same twin at the same native 1440x900, so the poster and the film cannot show
 * different products.
 */
export const CampaignPoster: React.FC = () => {
  const k = useScale();
  const width = 3840;
  const height = 2160;

  const scale = k * 0.82;
  const shot = {
    scale,
    offset: {
      x: (width - WINDOW.width * scale) / 2,
      y: height - WINDOW.height * scale - 118 * k,
    },
  };

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Vignette />

      <Stage width={WINDOW.width} height={WINDOW.height} shot={shot}>
        <Workspace
          paneIds={['checkout', 'retries', 'schema', 'flakes', 'client', 'dev']}
          activePaneId="checkout"
          overrides={[{ id: LATE_WAIT.paneId, state: LATE_WAIT.state, waitedMs: LATE_WAIT.waitedMs }]}
          frame={1900}
          complete
          scale={scale}
        />
      </Stage>

      {/* A floor under the product so the statement above it never sits on a lit pane. */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.55) 26%, rgba(0,0,0,0) 44%)',
          pointerEvents: 'none',
        }}
      />

      <AbsoluteFill
        style={{
          padding: `${112 * k}px ${132 * k}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 26 * k,
        }}
      >
        <Img src={staticFile('brand/wordmark.png')} style={{ width: 330 * k }} />
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 78 * k,
            fontWeight: WEIGHT.statement,
            letterSpacing: TRACK.statement,
            lineHeight: 1.16,
            color: INK.primary,
          }}
        >
          {CLOSE.statement}
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: SIZE.category * k,
            fontWeight: WEIGHT.category,
            letterSpacing: TRACK.category,
            textTransform: 'uppercase',
            color: INK.category,
          }}
        >
          {CLOSE.category}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
