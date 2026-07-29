/**
 * Contact sheet. Bundles once and pulls a still from each beat of the cut so the film can be
 * reviewed frame by frame without waiting on a full encode.
 *
 *   node scripts/probe.mjs [frame ...]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const out = path.join(root, 'out', 'probe');

/**
 * One still per beat, chosen at the moment the beat's interaction lands rather than at its
 * midpoint — a cursor film is checked by looking at the frames where something is pressed.
 */
const DEFAULT_FRAMES = [
  120, 360, // fragmentation
  690, // pressure
  1080, // alignment
  1540, 1880, // workspace
  2260, 2600, // parallel
  2960, 3290, // repository
  3600, 3910, // record
  4200, 4470, // decision
  4680, 4860, // direction
];
const frames = process.argv.slice(2).map(Number).filter(Number.isFinite);
const wanted = frames.length ? frames : DEFAULT_FRAMES;

mkdirSync(out, { recursive: true });

const serveUrl = await bundle({
  entryPoint: path.join(root, 'src', 'index.ts'),
  onProgress: (p) => process.stdout.write(`\rbundling ${p}%   `),
});
process.stdout.write('\n');

const composition = await selectComposition({ serveUrl, id: 'ParalithHero1080p' });

for (const frame of wanted) {
  const output = path.join(out, `f${String(frame).padStart(5, '0')}.png`);
  await renderStill({ composition, serveUrl, output, frame, imageFormat: 'png', overwrite: true });
  console.log(`still  ${frame}  ->  ${path.relative(root, output)}`);
}

console.log('done');
process.exit(0);
