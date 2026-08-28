/**
 * One-shot: trace the Paralith icon PNG into SVG contours so the logo can be
 * stroke-drawn and filled with real vector motion instead of a static bitmap.
 * Output: src/lib/markPath.ts
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const PACK = "../../Paralith-tauri/Logos/Paralith_Logo_Pack_4K/Paralith_Logo_Pack";
const TARGET = process.argv[2] ?? "mark";
const SOURCES = {
  mark: [`${PACK}/02_Icon_Only_Dark/02_Icon_Only_Dark_Original_1254.png`, "src/lib/markPath.ts", "MARK"],
  wordmark: [`${PACK}/03_Wordmark_Only_Dark/03_Wordmark_Only_Dark_Original_1254.png`, "src/lib/wordmarkPath.ts", "WORDMARK"],
};
const [srcRel, outFile, prefix] = SOURCES[TARGET];
const SRC = path.resolve(srcRel);

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  const idat = [];
  let w = 0, h = 0;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); }
    if (type === "IDAT") idat.push(d);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3, stride = w * bpp;
  const img = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[y * stride + x - bpp] : 0;
      const b = y > 0 ? img[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? img[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      img[y * stride + x] = v & 255;
    }
  }
  return { w, h, img, stride };
}

const { w, h, img, stride } = decodePng(SRC);
const inside = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const i = y * stride + x * 3;
  return (img[i] + img[i + 1] + img[i + 2]) / 3 > 70;
};

const T = (x, y) => [x + 0.5, y];
const R = (x, y) => [x + 1, y + 0.5];
const B = (x, y) => [x + 0.5, y + 1];
const L = (x, y) => [x, y + 0.5];
const TABLE = {
  1: [["L", "B"]], 2: [["B", "R"]], 3: [["L", "R"]], 4: [["T", "R"]],
  5: [["T", "L"], ["B", "R"]], 6: [["T", "B"]], 7: [["T", "L"]], 8: [["T", "L"]],
  9: [["T", "B"]], 10: [["T", "R"], ["B", "L"]], 11: [["T", "R"]], 12: [["L", "R"]],
  13: [["B", "R"]], 14: [["L", "B"]],
};
const PT = { T, R, B, L };

const key = (p) => `${p[0]}|${p[1]}`;
const segs = [];
for (let y = -1; y <= h; y++) {
  for (let x = -1; x <= w; x++) {
    const code =
      (inside(x, y) ? 8 : 0) + (inside(x + 1, y) ? 4 : 0) +
      (inside(x + 1, y + 1) ? 2 : 0) + (inside(x, y + 1) ? 1 : 0);
    const t = TABLE[code];
    if (!t) continue;
    for (const [a, b] of t) segs.push([PT[a](x, y), PT[b](x, y)]);
  }
}

// link segments into closed loops (undirected walk)
const adj = new Map();
for (const s of segs) {
  for (const e of [0, 1]) {
    const k = key(s[e]);
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push(s);
  }
}
const used = new Set();
const loops = [];
for (const seed of segs) {
  if (used.has(seed)) continue;
  used.add(seed);
  const loop = [seed[0], seed[1]];
  let tail = seed[1];
  for (;;) {
    const next = (adj.get(key(tail)) || []).find((c) => !used.has(c));
    if (!next) break;
    used.add(next);
    tail = key(next[0]) === key(tail) ? next[1] : next[0];
    loop.push(tail);
  }
  if (loop.length > 12) loops.push(loop);
}

// Ramer-Douglas-Peucker
function rdp(points, eps) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, idx + 1), eps).slice(0, -1), ...rdp(points.slice(idx), eps)];
}

function rdpClosed(points, eps) {
  const pts = points.slice();
  if (pts.length > 1 && key(pts[0]) === key(pts[pts.length - 1])) pts.pop();
  let idx = 0, maxd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > maxd) { maxd = d; idx = i; }
  }
  const a = rdp(pts.slice(0, idx + 1), eps);
  const b = rdp(pts.slice(idx), eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

const cleaned = loops
  .map((l) => rdpClosed(l, 1.1))
  .filter((l) => area(l) > 600)
  .sort((a, b) => area(b) - area(a));

const round = (n) => Math.round(n * 10) / 10;
const toPath = (pts) =>
  `M${pts.map(([x, y]) => `${round(x)},${round(y)}`).join("L")}Z`;

// group loops by centroid x so each slab of the monolith can animate on its own
const centroid = (pts) => pts.reduce((s, p) => s + p[0], 0) / pts.length;
const ordered = cleaned.sort((a, b) => centroid(a) - centroid(b));

const allPts = ordered.flat();
const minX = Math.min(...allPts.map((p) => p[0]));
const minY = Math.min(...allPts.map((p) => p[1]));
const maxX = Math.max(...allPts.map((p) => p[0]));
const maxY = Math.max(...allPts.map((p) => p[1]));
const header = "// Generated by scripts/trace-mark.mjs. Traced from the Paralith logo pack. Do not edit.";
const out = [
  header,
  `export const ${prefix}_VIEWBOX = "0 0 ${w} ${h}";`,
  `export const ${prefix}_BBOX = { x: ${round(minX)}, y: ${round(minY)}, w: ${round(maxX - minX)}, h: ${round(maxY - minY)} };`,
  `export const ${prefix}_PATHS: string[] = [`,
  ...ordered.map((l) => `  "${toPath(l)}",`),
  "];",
  "",
].join(String.fromCharCode(10));
fs.writeFileSync(outFile, out);
console.log("loops:", ordered.length, "points:", ordered.map((l) => l.length).join(","));
console.log("bytes:", out.length);
