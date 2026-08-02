import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ProductWindow } from './ProductWindow';
import { SwarmView } from './Swarm';
import { ResumeCenter } from './Resume';
import { WorkspaceView } from './Workspace';

/**
 * Calibration stills for the surfaces the campaign cut added, registered the same way
 * `TwinProof` is: 1:1, no camera, no grade, no brand layer.
 *
 * Their whole purpose is to be looked at. A surface that has only ever been seen through a
 * push-in at 1.7x, behind a scrim, under copy, is a surface nobody has actually checked — the
 * three-column tiling bug and the double-offset pane rects in the previous cut were both found
 * this way and neither was visible in a graded frame.
 */

/** The Swarm agent canvas: roster, real dependency edges, phase strip. */
export const SwarmCanvasProof: React.FC = () => (
  <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}>
    <ProductWindow>
      <SwarmView
        phase="building"
        lifecycle="building"
        elapsed="14m elapsed"
        view="canvas"
        missionTyped={0}
      />
    </ProductWindow>
  </AbsoluteFill>
);

/** The Work view's task graph, where `dependsOn` becomes "N dependencies". */
export const SwarmTasksProof: React.FC = () => (
  <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}>
    <ProductWindow>
      <SwarmView
        phase="building"
        lifecycle="building"
        elapsed="14m elapsed"
        view="work"
        workTab="tasks"
      />
    </ProductWindow>
  </AbsoluteFill>
);

/** The Evidence tab and the ready-for-review banner — the proof sequence's frame. */
export const SwarmEvidenceProof: React.FC = () => (
  <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}>
    <ProductWindow>
      <SwarmView
        phase="ready"
        lifecycle="ready_for_review"
        elapsed="31m elapsed"
        view="work"
        workTab="evidence"
        readyBanner
      />
    </ProductWindow>
  </AbsoluteFill>
);

/**
 * The Agent Resume Center over the workspace it belongs to. The modal is a product modal, so it
 * has to be seen on top of a real window rather than on black.
 */
export const ResumeProof: React.FC = () => (
  <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}>
    <ProductWindow>
      <>
        <WorkspaceView
          paneIds={['checkout', 'retries', 'schema', 'flakes', 'client', 'dev']}
          activePaneId="checkout"
          frame={900}
          complete
        />
        <ResumeCenter />
      </>
    </ProductWindow>
  </AbsoluteFill>
);
