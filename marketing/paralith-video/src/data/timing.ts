export const FPS = 60;

export type SceneId =
  | 'fragmentation'
  | 'pressure'
  | 'alignment'
  | 'workspace'
  | 'parallel'
  | 'repository'
  | 'record'
  | 'decision'
  | 'direction';

export type CutId = 'hero' | 'trailer' | 'teaser';

export type SceneTiming = {
  id: SceneId;
  duration: number;
};

export const HERO_CUT: readonly SceneTiming[] = [
  { id: 'fragmentation', duration: 420 },
  { id: 'pressure', duration: 540 },
  { id: 'alignment', duration: 420 },
  { id: 'workspace', duration: 660 },
  { id: 'parallel', duration: 720 },
  { id: 'repository', duration: 660 },
  { id: 'record', duration: 600 },
  { id: 'decision', duration: 540 },
  { id: 'direction', duration: 360 },
];

export const TRAILER_CUT: readonly SceneTiming[] = [
  { id: 'fragmentation', duration: 240 },
  { id: 'alignment', duration: 240 },
  { id: 'workspace', duration: 300 },
  { id: 'parallel', duration: 360 },
  { id: 'repository', duration: 300 },
  { id: 'decision', duration: 180 },
  { id: 'direction', duration: 180 },
];

export const TEASER_CUT: readonly SceneTiming[] = [
  { id: 'fragmentation', duration: 150 },
  { id: 'alignment', duration: 150 },
  { id: 'parallel', duration: 270 },
  { id: 'decision', duration: 150 },
  { id: 'direction', duration: 180 },
];

export const CUTS: Record<CutId, readonly SceneTiming[]> = {
  hero: HERO_CUT,
  trailer: TRAILER_CUT,
  teaser: TEASER_CUT,
};

export const durationOf = (cut: CutId) =>
  CUTS[cut].reduce((total, scene) => total + scene.duration, 0);

export const HERO_FRAMES = durationOf('hero');
export const TRAILER_FRAMES = durationOf('trailer');
export const TEASER_FRAMES = durationOf('teaser');

export const sceneStarts = (cut: CutId) => {
  let cursor = 0;
  return Object.fromEntries(
    CUTS[cut].map((scene) => {
      const start = cursor;
      cursor += scene.duration;
      return [scene.id, start];
    }),
  ) as Partial<Record<SceneId, number>>;
};

export const HERO_STARTS = sceneStarts('hero') as Record<SceneId, number>;

export const NARRATION_OFFSETS: Record<SceneId, number> = {
  fragmentation: 60,
  pressure: 36,
  alignment: 78,
  workspace: 48,
  parallel: 42,
  repository: 42,
  record: 48,
  decision: 42,
  direction: 36,
};

export const PROBE_FRAMES = [
  120,
  360,
  690,
  1080,
  1540,
  1880,
  2260,
  2600,
  2960,
  3290,
  3600,
  3910,
  4200,
  4470,
  4680,
  4860,
] as const;
