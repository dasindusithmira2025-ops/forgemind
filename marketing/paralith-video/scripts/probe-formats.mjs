import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frames = [120, 1080, 1880, 2600, 3290, 3910, 4470, 4860];
const formats = [
  ['vertical', 'ParalithHeroVertical'],
  ['square', 'ParalithHeroSquare'],
];

const serveUrl = await bundle({
  entryPoint: path.join(root, 'src', 'index.ts'),
  onProgress: (progress) => process.stdout.write(`\rbundling ${progress}%   `),
});
process.stdout.write('\n');

for (const [folder, id] of formats) {
  const out = path.join(root, 'out', 'probe', folder);
  mkdirSync(out, { recursive: true });
  const composition = await selectComposition({ serveUrl, id });
  for (const frame of frames) {
    const output = path.join(out, `f${String(frame).padStart(5, '0')}.png`);
    await renderStill({
      composition,
      serveUrl,
      output,
      frame,
      imageFormat: 'png',
      overwrite: true,
    });
    console.log(`${folder} ${frame} -> ${path.relative(root, output)}`);
  }
}
