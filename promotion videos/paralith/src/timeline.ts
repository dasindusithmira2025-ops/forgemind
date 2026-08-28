export const FPS = 60;
export const OVERLAP = 18;

export const SCENES = [
  { id: "ignition", dur: 420 },
  { id: "premise", dur: 372 },
  { id: "thesis", dur: 348 },
  { id: "workspaces", dur: 432 },
  { id: "swarms", dur: 432 },
  { id: "repository", dur: 420 },
  { id: "fabric", dur: 432 },
  { id: "evidence", dur: 372 },
  { id: "native", dur: 420 },
  { id: "close", dur: 492 },
] as const;

export const starts = SCENES.map((_, i) =>
  SCENES.slice(0, i).reduce((a, s) => a + s.dur, 0) - i * OVERLAP,
);

export const TOTAL =
  SCENES.reduce((a, s) => a + s.dur, 0) - (SCENES.length - 1) * OVERLAP;
