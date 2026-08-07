import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Workspace } from './Workspace';
import { LATE_WAIT } from './scenario';

/**
 * A calibration still, registered as its own composition.
 *
 * It renders the twin at 1:1 with no camera, no grade and no brand layer, so the product surface
 * can be inspected on its own terms — and diffed against a real screenshot of PARALITH — without
 * a film frame's grading getting in the way. It is not part of any cut.
 */
export const TwinProof: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <Workspace
        paneIds={['checkout', 'retries', 'schema', 'flakes', 'client', 'dev']}
        activePaneId="checkout"
        overrides={[{ id: LATE_WAIT.paneId, state: LATE_WAIT.state, waitedMs: LATE_WAIT.waitedMs }]}
        frame={frame + 600}
        complete={false}
      />
    </AbsoluteFill>
  );
};
