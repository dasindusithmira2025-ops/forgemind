import { seeded } from "./rand";

/**
 * THE DELIVERY SYSTEM — the third object, and the only one that is flat.
 *
 * Six named states of one set of points, drawn in two dimensions because this
 * is the one place on the site where the reader has to compare arrangements
 * rather than look into one. Depth would hide exactly the thing the section is
 * about: what changes between Discover and Ship.
 *
 * It is SVG rather than WebGL for the same reason. Ninety circles whose
 * positions are CSS-transitionable geometry properties cost nothing, work
 * without a renderer, print, and can be read by a screen reader through the
 * text beside them — and the transformation is the whole visual, so it has to
 * survive on a machine that would refuse a third canvas.
 */

export type LifecycleState = "field" | "order" | "surface" | "assembly" | "scan" | "release";

export const PROCESS_W = 160;
export const PROCESS_H = 72;
const COUNT = 90;

export type ProcessLayout = {
  points: { x: number; y: number; marked: boolean }[];
  edges: [number, number][];
};

const COLUMNS = 15;
const ROWS = 6;

/**
 * Unmeasured, unstructured: what is actually there before anyone looks.
 *
 * Bounded, though. Points scattered freely across the whole plate read as dust
 * on a lens; the same points inside a region read as a survey area with nothing
 * settled in it yet, which is what Discover actually is.
 */
function field(): ProcessLayout {
  const random = seeded(0x0d15c0);
  const points = Array.from({ length: COUNT }, (_, i) => {
    // Jittered grid rather than pure noise: pure noise clumps, and a clump
    // reads as a mistake rather than as an unordered field.
    const column = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    return {
      x: 16 + (column / (COLUMNS - 1)) * (PROCESS_W - 32) + (random() - 0.5) * 8,
      y: 14 + (row / (ROWS - 1)) * (PROCESS_H - 28) + (random() - 0.5) * 9,
      marked: false,
    };
  });
  return { points, edges: [] };
}

/** The grid. Boundaries drawn, ownership settled. */
function order(): ProcessLayout {
  const points = Array.from({ length: COUNT }, (_, i) => {
    const column = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    return {
      x: 14 + (column / (COLUMNS - 1)) * (PROCESS_W - 28),
      y: 12 + (row / (ROWS - 1)) * (PROCESS_H - 24),
      marked: false,
    };
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < COUNT; i++) {
    if (i % COLUMNS !== COLUMNS - 1) edges.push([i, i + 1]);
    if (i + COLUMNS < COUNT) edges.push([i, i + COLUMNS]);
  }
  return { points, edges };
}

/** Contours. The same grid pulled onto the shape a person will actually touch. */
function surface(): ProcessLayout {
  const points = Array.from({ length: COUNT }, (_, i) => {
    const column = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const u = column / (COLUMNS - 1);
    const v = row / (ROWS - 1);
    const bend = Math.sin(u * Math.PI * 1.35) * 11 - Math.cos(u * Math.PI * 0.8) * 4;
    return {
      x: 14 + u * (PROCESS_W - 28),
      y: 14 + v * (PROCESS_H - 28) + bend * (0.45 + v * 0.55),
      marked: false,
    };
  });
  const edges: [number, number][] = [];
  // Along the contour only. Cross-links would make it a mesh again, and a
  // surface is read from its section lines.
  for (let i = 0; i < COUNT; i++) {
    if (i % COLUMNS !== COLUMNS - 1) edges.push([i, i + 1]);
  }
  return { points, edges };
}

/** Slices. Each one runs end to end on its own. */
function assembly(): ProcessLayout {
  const modules = 5;
  const per = COUNT / modules;
  const points: ProcessLayout["points"] = [];
  const edges: [number, number][] = [];

  for (let m = 0; m < modules; m++) {
    const cx = 22 + (m / (modules - 1)) * (PROCESS_W - 44);
    for (let n = 0; n < per; n++) {
      const i = m * per + n;
      const column = n % 3;
      const row = Math.floor(n / 3);
      points.push({
        x: cx + (column - 1) * 7,
        y: 16 + row * 8,
        marked: false,
      });
      if (column < 2) edges.push([i, i + 1]);
      if (row < 5) edges.push([i, i + 3]);
    }
    // The seam between slices, which is the part that actually fails.
    if (m < modules - 1) edges.push([m * per + 2, (m + 1) * per]);
  }
  return { points, edges };
}

/** The gate. Everything checked, and what passed is marked. */
function scan(): ProcessLayout {
  const base = order();
  // Scattered, not periodic. `i % 5` on a fifteen-column grid marks three whole
  // columns, which reads as three parts of the product failing rather than as
  // a handful of checks not passing.
  const random = seeded(0x9a7e);
  const points = base.points.map((point) => ({
    ...point,
    // Verification is a property of the thing, not of its position — so the
    // grid holds and only the state changes. Four in five pass; the rest are
    // what the gate exists for.
    marked: random() > 0.2,
  }));
  const edges: [number, number][] = [];
  for (let i = 0; i < COUNT; i++) {
    if (i + COLUMNS < COUNT) edges.push([i, i + COLUMNS]);
  }
  return { points, edges };
}

/** One artifact, signed, in order. */
function release(): ProcessLayout {
  const points = Array.from({ length: COUNT }, (_, i) => {
    const u = i / (COUNT - 1);
    const stack = i % 3;
    return {
      x: 16 + u * (PROCESS_W - 32),
      y: PROCESS_H / 2 + (stack - 1) * 4.2 + Math.sin(u * Math.PI) * -6,
      marked: true,
    };
  });
  const edges: [number, number][] = [];
  for (let i = 0; i + 3 < COUNT; i++) edges.push([i, i + 3]);
  return { points, edges };
}

let cache: Record<LifecycleState, ProcessLayout> | null = null;

export function processLayouts(): Record<LifecycleState, ProcessLayout> {
  if (!cache) {
    cache = {
      field: field(),
      order: order(),
      surface: surface(),
      assembly: assembly(),
      scan: scan(),
      release: release(),
    };
  }
  return cache;
}

/**
 * Every connection any state draws, with the states that draw it.
 *
 * One element per pair rather than one per state: the line then moves with its
 * endpoints through the whole sequence and fades where it does not apply,
 * instead of a new element appearing at its destination.
 */
export function processEdges() {
  const all = processLayouts();
  const map = new Map<string, { a: number; b: number; states: Set<LifecycleState> }>();

  for (const [state, layout] of Object.entries(all) as [LifecycleState, ProcessLayout][]) {
    for (const [a, b] of layout.edges) {
      const key = `${a}-${b}`;
      const existing = map.get(key);
      if (existing) existing.states.add(state);
      else map.set(key, { a, b, states: new Set([state]) });
    }
  }

  return [...map.values()];
}
