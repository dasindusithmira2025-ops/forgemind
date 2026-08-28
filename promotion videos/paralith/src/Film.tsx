import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Backdrop } from "./lib/Backdrop";
import { OVERLAP, SCENES, starts, TOTAL } from "./timeline";
import { EASE_IN_OUT, window_ } from "./lib/anim";
import { C } from "./lib/theme";

import { Ignition } from "./scenes/Ignition";
import { Premise } from "./scenes/Premise";
import { Thesis } from "./scenes/Thesis";
import { Workspaces } from "./scenes/Workspaces";
import { Swarms } from "./scenes/Swarms";
import { Repository } from "./scenes/Repository";
import { Fabric } from "./scenes/Fabric";
import { Evidence } from "./scenes/Evidence";
import { Native } from "./scenes/Native";
import { Close } from "./scenes/Close";

const COMPONENTS: Record<string, React.FC> = {
  ignition: Ignition,
  premise: Premise,
  thesis: Thesis,
  workspaces: Workspaces,
  swarms: Swarms,
  repository: Repository,
  fabric: Fabric,
  evidence: Evidence,
  native: Native,
  close: Close,
};

/** Cross-dissolve shell with a slow push, so cuts read as one continuous take. */
const Shot: React.FC<{ dur: number; children: React.ReactNode }> = ({
  dur,
  children,
}) => {
  const f = useCurrentFrame();
  const o = window_(f, 0, dur - OVERLAP, OVERLAP);
  const push = 1 + (f / dur) * 0.012;
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <AbsoluteFill style={{ transform: `scale(${push})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Opens out of black and returns to it. */
const Fades: React.FC = () => {
  const f = useCurrentFrame();
  const o = interpolate(
    f,
    [0, 26, 92, TOTAL - 76, TOTAL - 6],
    [1, 1, 0, 0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT },
  );
  return <AbsoluteFill style={{ background: "#000", opacity: o, pointerEvents: "none" }} />;
};

export const Film: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.deep }}>
    <Backdrop />
    {SCENES.map((s, i) => {
      const Comp = COMPONENTS[s.id];
      return (
        <Sequence key={s.id} from={starts[i]} durationInFrames={s.dur} layout="none">
          <Shot dur={s.dur}>
            <Comp />
          </Shot>
        </Sequence>
      );
    })}
    <Fades />
  </AbsoluteFill>
);
