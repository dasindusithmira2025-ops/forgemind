import type { CoreState } from "@/content/capabilities";
import { seeded } from "./rand";

/**
 * THE CORELITH CORE — a second object, with a second job.
 *
 * The hero's field says what Corelith is. This says what Corelith is doing.
 * Same visual language — fine points, thin connections, one blue for state —
 * and deliberately not the same model, because rendering one object in every
 * section is how a site ends up looking like a template with a mascot.
 *
 * It is one network of nodes that reorganises. Selecting a capability moves
 * every node to where that capability's structure puts it and the connections
 * dissolve and reform around the new arrangement, so the object in the middle
 * of the section is always saying what the words around it say.
 *
 * Every arrangement keeps the same rounded silhouette. That is a hard rule: an
 * object that changes its outline is a different object each time, and the
 * argument the section makes is that these are one practice.
 *
 *   Product Engineering  → ordered shells, an inner core inside an outer layer
 *   AI Systems           → great-circle paths wrapping the core
 *   Experience           → everything on the surface, with the skin visible
 *   Infrastructure       → the load-bearing frame, the rest receded inside
 *   Automation           → closed rings
 *   Strategy             → evenly spread, every long connection drawn faintly
 */

export const NODE_COUNT = 92;
const R = 2.0;

export type Layout = {
  /** Target positions, xyz interleaved. */
  positions: Float32Array;
  /** Per node: 1 if load-bearing in this arrangement, lower if it recedes. */
  weight: Float32Array;
  /** Index pairs of the connections this arrangement implies. */
  edges: Uint16Array;
  /** Whether this arrangement shows the frosted skin. */
  hull: number;
};

/**
 * Connections by proximity within one band of nodes, capped per node so no hub
 * becomes a star.
 *
 * The band matters. Running this across two concentric shells at once reaches
 * the gap between them and draws spokes, and a ball of spokes is wool rather
 * than structure — so each shell is meshed on its own.
 */
function edgesIn(
  positions: Float32Array,
  from: number,
  to: number,
  maxDistance: number,
  maxPerNode: number,
) {
  const degree = new Uint8Array(NODE_COUNT);
  const edges: number[] = [];
  const limit = maxDistance * maxDistance;

  for (let a = from; a < to; a++) {
    if (degree[a] >= maxPerNode) continue;
    // Nearest first, so the connections drawn are the ones that read as
    // structure rather than the first ones the loop happens to reach.
    const candidates: { b: number; d: number }[] = [];
    for (let b = a + 1; b < to; b++) {
      const dx = positions[a * 3] - positions[b * 3];
      const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
      const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= limit) candidates.push({ b, d });
    }
    candidates.sort((p, q) => p.d - q.d);
    for (const candidate of candidates) {
      if (degree[a] >= maxPerNode) break;
      if (degree[candidate.b] >= maxPerNode) continue;
      degree[a]++;
      degree[candidate.b]++;
      edges.push(a, candidate.b);
    }
  }

  return edges;
}

/** The whole set, meshed as one band. */
const edgesFrom = (positions: Float32Array, maxDistance: number, maxPerNode: number) =>
  new Uint16Array(edgesIn(positions, 0, NODE_COUNT, maxDistance, maxPerNode));

const full = () => new Float32Array(NODE_COUNT).fill(1);
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Even coverage of a sphere: no poles, no seam. */
function sphere(positions: Float32Array, from: number, to: number, radius: number, spin = 0) {
  const span = to - from;
  for (let n = 0; n < span; n++) {
    const i = from + n;
    const y = 1 - (n / Math.max(span - 1, 1)) * 2;
    const ring = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = GOLDEN * n + spin;
    positions[i * 3] = Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius;
  }
}

/** Ordered layers: a dense core inside an outer shell. */
function shells(): Layout {
  const positions = new Float32Array(NODE_COUNT * 3);
  const inner = 30;
  sphere(positions, 0, inner, R * 0.58, 1.1);
  sphere(positions, inner, NODE_COUNT, R, 0);
  // Each shell meshed on its own: an even outer surface with a smaller ordered
  // one held inside it. The thresholds are set just above the mean spacing of
  // each shell — sixty-two points on a sphere of this radius sit about 0.97
  // apart, thirty inner ones about 0.81 — so every node finds its neighbours
  // and none of them reaches across the gap between the shells.
  const edges = [
    ...edgesIn(positions, inner, NODE_COUNT, 1.15, 3),
    ...edgesIn(positions, 0, inner, 0.95, 2),
  ];
  return { positions, weight: full(), edges: new Uint16Array(edges), hull: 0 };
}

/** Great circles wrapping the core: information taking a route through it. */
function paths(): Layout {
  const positions = new Float32Array(NODE_COUNT * 3);
  const circles = 4;
  const per = Math.floor(NODE_COUNT / circles);
  const edges: number[] = [];

  for (let c = 0; c < circles; c++) {
    const tilt = (c / circles) * Math.PI * 0.9;
    const roll = (c / circles) * 1.3;
    for (let n = 0; n < per; n++) {
      const i = c * per + n;
      const angle = (n / per) * Math.PI * 2;
      // A circle in the xz plane, tilted twice so the four of them weave.
      const x = Math.cos(angle) * R;
      const z = Math.sin(angle) * R;
      const y1 = z * Math.sin(tilt);
      const z1 = z * Math.cos(tilt);
      positions[i * 3] = x * Math.cos(roll) - y1 * Math.sin(roll);
      positions[i * 3 + 1] = x * Math.sin(roll) + y1 * Math.cos(roll);
      positions[i * 3 + 2] = z1;
      edges.push(i, c * per + ((n + 1) % per));
    }
  }
  // Whatever the division leaves over sits inside rather than at the origin,
  // which is where an uninitialised node would otherwise pile up.
  sphere(positions, circles * per, NODE_COUNT, R * 0.45, 0.7);

  return { positions, weight: full(), edges: new Uint16Array(edges), hull: 0 };
}

/** Everything on the surface, and the surface made visible. */
function skin(): Layout {
  const positions = new Float32Array(NODE_COUNT * 3);
  sphere(positions, 0, NODE_COUNT, R, 0.4);
  return { positions, weight: full(), edges: edgesFrom(positions, 0.88, 3), hull: 1 };
}

/** The load-bearing frame, with everything else receded inside it. */
function frame(): Layout {
  const positions = new Float32Array(NODE_COUNT * 3);
  const weight = new Float32Array(NODE_COUNT);
  const edges: number[] = [];

  // The twelve vertices of an icosahedron: the smallest set of points that
  // still describes a sphere, which is what a framework is.
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      raw.push([0, s1, s2 * phi], [s1, s2 * phi, 0], [s2 * phi, 0, s1]);
    }
  }
  const norm = Math.sqrt(1 + phi * phi);
  const vertices = raw.map(
    ([x, y, z]) => [(x / norm) * R, (y / norm) * R, (z / norm) * R] as [number, number, number],
  );

  // Struts join the vertices that are genuinely adjacent — on an icosahedron
  // that is every pair at the shortest of the distances present.
  const struts: [number, number][] = [];
  const shortest = (2 / norm) * R * 1.05;
  for (let a = 0; a < vertices.length; a++) {
    for (let b = a + 1; b < vertices.length; b++) {
      const d = Math.hypot(
        vertices[a][0] - vertices[b][0],
        vertices[a][1] - vertices[b][1],
        vertices[a][2] - vertices[b][2],
      );
      if (d <= shortest) struts.push([a, b]);
    }
  }

  const perStrut = 2;
  const onFrame = Math.min(struts.length * perStrut, NODE_COUNT);
  const random = seeded(0x51e5);

  for (let i = 0; i < NODE_COUNT; i++) {
    if (i < onFrame) {
      const strut = struts[Math.floor(i / perStrut)];
      const u = (i % perStrut) / (perStrut - 1 || 1);
      const a = vertices[strut[0]];
      const b = vertices[strut[1]];
      for (let axis = 0; axis < 3; axis++) {
        positions[i * 3 + axis] = a[axis] + (b[axis] - a[axis]) * u;
      }
      weight[i] = 1;
      if (i % perStrut !== perStrut - 1) edges.push(i, i + 1);
    } else {
      // Pulled inside and dimmed: still present, no longer carrying.
      const r = R * 0.42;
      positions[i * 3] = (random() - 0.5) * r * 2;
      positions[i * 3 + 1] = (random() - 0.5) * r * 2;
      positions[i * 3 + 2] = (random() - 0.5) * r * 2;
      weight[i] = 0.16;
    }
  }

  return { positions, weight, edges: new Uint16Array(edges), hull: 0 };
}

/** Closed cycles. Rings around the core, each tilted from the last. */
function cycles(): Layout {
  const positions = new Float32Array(NODE_COUNT * 3);
  const rings = 4;
  const per = Math.floor(NODE_COUNT / rings);
  const edges: number[] = [];

  for (let r = 0; r < rings; r++) {
    const height = (r / (rings - 1) - 0.5) * 1.35;
    const radius = Math.sqrt(Math.max(R * R - height * height, 0.04));
    const tilt = (r / rings) * 0.55;
    for (let n = 0; n < per; n++) {
      const i = r * per + n;
      const angle = (n / per) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      positions[i * 3] = x;
      positions[i * 3 + 1] = height + z * Math.sin(tilt);
      positions[i * 3 + 2] = z * Math.cos(tilt);
      edges.push(i, r * per + ((n + 1) % per));
    }
  }
  sphere(positions, rings * per, NODE_COUNT, R * 0.3, 0.2);

  return { positions, weight: full(), edges: new Uint16Array(edges), hull: 0 };
}

/** The whole field at once: evenly spread, every connection drawn faintly. */
function survey(): Layout {
  const positions = new Float32Array(NODE_COUNT * 3);
  sphere(positions, 0, NODE_COUNT, R * 1.02, 2.2);
  return { positions, weight: full(), edges: edgesFrom(positions, 1.05, 4), hull: 0 };
}

let cache: Record<CoreState, Layout> | null = null;

/** Built once per process. The layouts are pure functions of nothing. */
export function layouts(): Record<CoreState, Layout> {
  if (!cache) {
    cache = {
      assembly: shells(),
      paths: paths(),
      shell: skin(),
      frame: frame(),
      lattice: cycles(),
      survey: survey(),
    };
  }
  return cache;
}

/**
 * One arrangement as a flat elevation, for the SVG that renders on the server.
 * Same nodes, same connections, one fixed camera.
 */
export function graphElevation(state: CoreState) {
  const layout = layouts()[state];
  const yaw = 0.5;
  const pitch = 0.22;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const project = (i: number) => {
    const x = layout.positions[i * 3];
    const y = layout.positions[i * 3 + 1];
    const z = layout.positions[i * 3 + 2];
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y1 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const scale = 7.2 / (7.2 - z2);
    return {
      x: 50 + x1 * scale * 10.6,
      y: 50 - y1 * scale * 10.6,
      facing: (z2 + R) / (R * 2),
      weight: layout.weight[i],
      marked: i % 7 === 3,
    };
  };

  const points = Array.from({ length: NODE_COUNT }, (_, i) => project(i));
  const edges: { x1: number; y1: number; x2: number; y2: number; o: number }[] = [];
  for (let e = 0; e < layout.edges.length; e += 2) {
    const a = points[layout.edges[e]];
    const b = points[layout.edges[e + 1]];
    edges.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      o: 0.06 + ((a.facing + b.facing) / 2) * 0.34,
    });
  }
  return { points, edges };
}
