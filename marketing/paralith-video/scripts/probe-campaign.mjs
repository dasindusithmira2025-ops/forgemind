/**
 * Contact sheet for the campaign cut. Bundles once and pulls stills from every sequence so the
 * film can be reviewed frame by frame without waiting on a full encode.
 *
 *   node scripts/probe-campaign.mjs                 # the default sheet, 1080p
 *   node scripts/probe-campaign.mjs 1200 3400       # named frames
 *   node scripts/probe-campaign.mjs --id=ParalithCampaignVertical30 --frames=200,900
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const out = path.join(root, 'out', 'probe');

const { STARTS } = await import(pathToFileURL(path.join(root, 'src/campaign/script.ts')).href);

/**
 * Two stills per sequence, chosen where something lands rather than at the midpoint — the moment
 * copy is fully up, the moment a camera move settles, the moment a list finishes populating.
 */
const DEFAULT_FRAMES = [
  STARTS.fragments + 200, // three surfaces up
  STARTS.fragments + 520, // all six, copy up
  STARTS.arrival + 190, // mark and wordmark
  STARTS.arrival + 560, // handed off into the product
  STARTS.direct + 170, // mission typed
  STARTS.direct + 430, // roster staffed
  STARTS.direct + 700, // task graph with dependencies
  STARTS.parallel + 260, // the split to six
  STARTS.parallel + 520, // one pane waiting, unannounced
  STARTS.parallel + 800, // the Fleet Bar, read close
  STARTS.repository + 300, // attribution
  STARTS.repository + 600, // the diff
  STARTS.proof + 200, // tests
  STARTS.proof + 520, // evidence + ready banner
  STARTS.continuity + 240, // the resume list
  STARTS.continuity + 470, // resumed
  STARTS.close + 120, // the whole environment
  STARTS.close + 300, // the statement
  STARTS.close + 500, // the lockup
];

const args = process.argv.slice(2);
const idArg = args.find((value) => value.startsWith('--id='));
const framesArg = args.find((value) => value.startsWith('--frames='));
const positional = args.filter((value) => !value.startsWith('--')).map(Number).filter(Number.isFinite);

const id = idArg ? idArg.slice('--id='.length) : 'ParalithCampaign1080p';
const wanted = framesArg
  ? framesArg.slice('--frames='.length).split(',').map(Number).filter(Number.isFinite)
  : positional.length
    ? positional
    : DEFAULT_FRAMES;

mkdirSync(out, { recursive: true });

const serveUrl = await bundle({
  entryPoint: path.join(root, 'src', 'index.ts'),
  onProgress: (p) => process.stdout.write(`\rbundling ${p}%   `),
});
process.stdout.write('\n');

const composition = await selectComposition({ serveUrl, id });
const prefix = id.replace('ParalithCampaign', 'c').toLowerCase();

for (const frame of wanted) {
  const output = path.join(out, `${prefix}-${String(frame).padStart(5, '0')}.png`);
  await renderStill({ composition, serveUrl, output, frame, imageFormat: 'png', overwrite: true });
  console.log(`still  ${frame}  ->  ${path.relative(root, output)}`);
}

console.log('done');
process.exit(0);
