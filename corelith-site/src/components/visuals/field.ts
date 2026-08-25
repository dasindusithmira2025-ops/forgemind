import { seeded } from "./rand";

/**
 * THE CORELITH FIELD — defined once, as data.
 *
 * A fine dotted shell: several thousand points spaced evenly over a sphere by
 * the golden angle, turning slowly, with the far side falling away to almost
 * nothing so the form is read from its density rather than from an outline.
 * A small fraction of the points carry Corelith blue.
 *
 * The previous object here was a rigid lattice and it read as scaffolding — a
 * warehouse frame at the top of a company homepage. This is the opposite
 * material: soft, luminous, legible in a glance. It sits inside a lit panel
 * rather than floating on the page, because a rendered object with no edge on a
 * white sheet reads as something that failed to load.
 *
 * The same data drives the rendered scene and the flat SVG that stands in for
 * it before hydration and where WebGL is unavailable.
 */

export const FIELD_RADIUS = 2.6;

export type Field = {
  /** Positions on the shell, xyz interleaved. */
  base: Float32Array;
  count: number;
  /** Per point: 1 marks a state node, drawn in Corelith blue and a size up. */
  marked: Uint8Array;
  /** Per point: a small size variation, so the shell is not a uniform screen. */
  scale: Float32Array;
};

export function buildField(detail: "full" | "reduced" = "full"): Field {
  const count = detail === "full" ? 2600 : 1100;
  const base = new Float32Array(count * 3);
  const marked = new Uint8Array(count);
  const scale = new Float32Array(count);
  const random = seeded(0xc07e1f);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    // Golden-angle spiral: even coverage with no poles and no seam, which is
    // what stops a dotted sphere reading as a wireframe globe.
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = golden * i;

    // A hair of radial jitter. A perfectly smooth shell reads as a printed
    // halftone; a little depth makes it a field of points in space.
    const r = FIELD_RADIUS * (0.985 + random() * 0.03);

    base[i * 3] = Math.cos(theta) * ring * r;
    base[i * 3 + 1] = y * r;
    base[i * 3 + 2] = Math.sin(theta) * ring * r;

    marked[i] = random() < 0.035 ? 1 : 0;
    scale[i] = 0.72 + random() * 0.5;
  }

  return { base, count, marked, scale };
}

/**
 * The slow internal drift.
 *
 * Points breathe very slightly along their own radius rather than travelling,
 * so the shell stays a shell. Written in place — the loop runs once per point
 * per frame and allocating there is the one thing on this page that would
 * produce garbage sixty times a second.
 */
export function breathe(
  x: number,
  y: number,
  z: number,
  t: number,
  out: { x: number; y: number; z: number },
) {
  const pulse = 1 + 0.018 * Math.sin(t * 0.5 + y * 1.6) + 0.012 * Math.sin(t * 0.31 + x * 1.1);
  out.x = x * pulse;
  out.y = y * pulse;
  out.z = z * pulse;
}

/**
 * The field as a flat elevation, for the SVG that renders on the server.
 *
 * One fixed camera and a single perspective divide, with the far side faded
 * exactly as the renderer fades it — so what appears before hydration is the
 * object rather than a placeholder for it.
 */
export function fieldElevation(detail: "full" | "reduced" = "reduced") {
  const field = buildField(detail);
  const points: { x: number; y: number; r: number; o: number; marked: boolean }[] = [];
  const yaw = 0.6;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const camera = 9.2;

  for (let i = 0; i < field.count; i++) {
    const x = field.base[i * 3];
    const y = field.base[i * 3 + 1];
    const z = field.base[i * 3 + 2];

    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const scale = camera / (camera - z1);
    // 0 at the back of the shell, 1 at the front.
    const facing = (z1 + FIELD_RADIUS) / (FIELD_RADIUS * 2);

    points.push({
      x: 50 + x1 * scale * 8.4,
      y: 50 - y * scale * 8.4,
      r: (0.24 + facing * 0.26) * field.scale[i],
      o: 0.06 + facing * facing * 0.72,
      marked: field.marked[i] === 1,
    });
  }

  return points;
}
