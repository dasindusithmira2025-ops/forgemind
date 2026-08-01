// Cuts transparent brand masters from the PARALITH 4K logo pack.
//
// The logo pack ships its dark-background lockups as flattened PNGs: the navy plate is baked in.
// Dropped onto the film's near-black that plate reads as a visible rectangle behind the mark,
// which is exactly the kind of detail that makes a title card look assembled rather than
// designed. (The 800px `mark-alpha.png` / `wordmark-alpha.png` already in `public/brand` are
// named for an alpha channel they do not actually have.)
//
// The artwork sits on an almost-black plate, so the composite is effectively `src = fg * a`.
// Taking alpha as max(r,g,b) and then unpremultiplying recovers both the alpha ramp and the
// original colour, which keeps the mark's cyan-to-violet gradient and its anti-aliased edges
// intact instead of leaving them darkened against the new background.
//
//   node scripts/prepare-brand-assets.mjs

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIDEO_ROOT = path.resolve(HERE, '..');
const PACK = path.resolve(
  VIDEO_ROOT,
  '../../Paralith-tauri/Logos/Paralith_Logo_Pack_4K/Paralith_Logo_Pack',
);
const OUT = path.join(VIDEO_ROOT, 'public/brand');

const ASSETS = [
  { name: 'mark', source: '02_Icon_Only_Dark/02_Icon_Only_Dark_4096x4096.png', width: 1600 },
  { name: 'wordmark', source: '03_Wordmark_Only_Dark/03_Wordmark_Only_Dark_4096x4096.png', width: 2400 },
  { name: 'lockup', source: '01_Primary_Logo_Dark/01_Primary_Logo_Dark_4096x4096.png', width: 3000 },
];

const run = (args) => {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg failed: ${args.join(' ')}`);
  return result.stderr;
};

/**
 * Finds the artwork's bounding box so the 4096 canvas's padding is removed. Measured on the
 * original flattened file, where the artwork is the only thing brighter than the plate, and
 * `cropdetect` therefore locks onto it directly.
 */
const contentBox = (file) => {
  // `-loop 1`: cropdetect needs to see several frames before it reports, and a PNG is one frame.
  const log = spawnSync(
    'ffmpeg',
    [
      '-loop', '1',
      '-i', file,
      '-vf', 'cropdetect=limit=0.05:round=2:reset=0',
      '-frames:v', '4',
      '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  ).stderr;
  const matches = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (matches.length === 0) throw new Error(`cropdetect found no content in ${file}`);
  const [, w, h, x, y] = matches[matches.length - 1];
  return { w: Number(w), h: Number(h), x: Number(x), y: Number(y) };
};

/**
 * The plate the logo pack composites onto, sampled from the flattened files. It is flat, not a
 * gradient, which is what makes an exact key possible.
 */
const PLATE = { r: 0, g: 4, b: 15 };

/**
 * Two passes.
 *
 * The first removes the plate and rescales each channel across its real range, `(src - plate) *
 * 255 / (255 - plate)`. A flat subtraction is not good enough here: the plate is navy, so
 * subtracting the same amount from every channel drags pure white toward cream — which on a
 * wordmark that is meant to be #ffffff is immediately visible.
 *
 * The second takes alpha as the largest remaining channel and unpremultiplies the colour by it.
 * Assuming the artwork saturates at least one channel wherever it is opaque — true of both the
 * white wordmark and the cyan-to-violet mark — this recovers the original colour and a clean
 * anti-aliased alpha ramp, with no halo where the plate used to be.
 */
const norm = (channel, plate) => `min(255,max(0,(${channel}(X,Y)-${plate})*255/${255 - plate}))`;

const KEY =
  `format=rgba,geq=r='${norm('r', PLATE.r)}':g='${norm('g', PLATE.g)}':b='${norm('b', PLATE.b)}':a='255',` +
  "format=rgba,geq=" +
  "a='max(max(r(X,Y),g(X,Y)),b(X,Y))':" +
  "r='if(gte(max(max(r(X,Y),g(X,Y)),b(X,Y)),3),min(255,r(X,Y)*255/max(max(r(X,Y),g(X,Y)),b(X,Y))),0)':" +
  "g='if(gte(max(max(r(X,Y),g(X,Y)),b(X,Y)),3),min(255,g(X,Y)*255/max(max(r(X,Y),g(X,Y)),b(X,Y))),0)':" +
  "b='if(gte(max(max(r(X,Y),g(X,Y)),b(X,Y)),3),min(255,b(X,Y)*255/max(max(r(X,Y),g(X,Y)),b(X,Y))),0)'";

mkdirSync(OUT, { recursive: true });

for (const asset of ASSETS) {
  const source = path.join(PACK, asset.source);
  const box = contentBox(source);
  // A little breathing room so the unpremultiplied fringe is never clipped by the crop itself.
  const pad = 8;
  const crop = `crop=${box.w + pad * 2}:${box.h + pad * 2}:${Math.max(0, box.x - pad)}:${Math.max(0, box.y - pad)}`;
  const target = path.join(OUT, `${asset.name}.png`);

  run([
    '-y',
    '-loglevel',
    'error',
    '-i',
    source,
    '-vf',
    `${crop},${KEY},scale=${asset.width}:-1:flags=lanczos`,
    target,
  ]);

  console.log(`${asset.name}.png  ${box.w}x${box.h} from ${asset.source} -> ${asset.width}px wide`);
}
