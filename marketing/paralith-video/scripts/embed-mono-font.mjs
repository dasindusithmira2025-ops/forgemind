// Embeds the terminal typeface the PARALITH product actually renders with.
//
// `--font-mono` in the product is "Cascadia Code", "Cascadia Mono", ui-monospace, Consolas.
// The film's terminals are the emotional centre of several scenes, so drawing them in a
// substitute face would undo the point of a twin.
//
// Cascadia Mono rather than Cascadia Code: the product loads xterm.js with the fit, search and
// web-links addons and no ligature addon, so xterm draws every cell independently and Cascadia
// Code's ligatures never form on screen. Mono is the same face with the ligature table removed —
// it is what the user is really looking at, and it is smaller.
//
// It is inlined as a data URI for the same reason Geist is (see src/fonts.ts): a fetched face
// once wedged a render tab three quarters of the way through a full encode. A face that arrives
// with the stylesheet has no load promise to hang on.
//
//   node scripts/embed-mono-font.mjs [path-to-CascadiaMono.ttf]

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO_ROOT = resolve(HERE, '..');
const OUT = join(VIDEO_ROOT, 'src/mono-font-data.ts');

const DEFAULT_SOURCE = 'C:/Windows/Fonts/CascadiaMono.ttf';

async function main() {
  const source = resolve(process.argv[2] ?? DEFAULT_SOURCE);
  const bytes = await readFile(source).catch(() => null);

  if (!bytes) {
    throw new Error(
      `Could not read ${source}.\n` +
        'Cascadia Mono ships with Windows Terminal and Visual Studio; it is also available from\n' +
        'https://github.com/microsoft/cascadia-code/releases. Pass the .ttf path as an argument.',
    );
  }

  const digest = createHash('sha256').update(bytes).digest('hex');
  const dataUri = `data:font/ttf;base64,${bytes.toString('base64')}`;

  const file = [
    '/* GENERATED FILE — DO NOT EDIT.',
    ` * Source:  ${basename(source)} (${bytes.length.toLocaleString()} bytes)`,
    ` * SHA-256: ${digest}`,
    ' * Regenerate: node scripts/embed-mono-font.mjs [path-to-CascadiaMono.ttf]',
    ' *',
    ' * Cascadia Mono, Copyright (c) Microsoft Corporation, licensed under the SIL Open Font',
    ' * License 1.1. The required notice is included at public/fonts/OFL-CascadiaMono.txt.',
    ' */',
    '',
    'export const CASCADIA_MONO_TTF =',
    `  '${dataUri}';`,
    '',
  ].join('\n');

  await writeFile(OUT, file, 'utf8');
  console.log(`wrote src/mono-font-data.ts (${file.length.toLocaleString()} bytes, sha-256 ${digest.slice(0, 16)}…)`);
}

await main();
