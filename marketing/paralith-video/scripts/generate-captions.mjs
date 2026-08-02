/**
 * Subtitles for the campaign cut, generated from `src/campaign/script.ts`.
 *
 *   node scripts/generate-captions.mjs
 *
 * The film has no narration, so these caption the on-screen statements — which are the only words
 * in it. They are generated rather than transcribed for the same reason the score is: there is one
 * copy of every string in this project, in `LINES`, and a hand-written SRT would be a second one
 * that silently goes stale the first time a line is re-timed.
 *
 * A cue runs from the frame its line begins its fade-in to the frame it finishes its fade-out,
 * which is the interval the words are actually legible rather than the interval they are nominally
 * "on". One file per cut, because the derived cuts excerpt the master and their cue times differ.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(ROOT, '..', '..', 'media', 'exports');

const { BEATS, CUTS, FPS, LINES, STARTS } = await import(
  pathToFileURL(path.join(ROOT, 'src/campaign/script.ts')).href
);

/** `Copy.tsx` fades a line in over 24 frames and out over 18 after `stay`. */
const RISE = 24;
const FALL = 18;

const timecode = (frames) => {
  const total = Math.max(0, frames) / FPS;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
};

/** Every statement in the master, as absolute frame ranges. */
const masterCues = () => {
  const cues = [];
  for (const beat of BEATS) {
    for (const line of LINES[beat.id]) {
      cues.push({
        beat: beat.id,
        from: STARTS[beat.id] + line.from,
        to: STARTS[beat.id] + line.from + RISE + line.stay + FALL,
        text: line.text,
      });
    }
  }
  return cues.sort((a, b) => a.from - b.from);
};

/**
 * The same statements re-timed into a derived cut.
 *
 * A line only survives if its readable interval overlaps an excerpt, and it is clipped to that
 * excerpt — a trailer that cuts away mid-line should show the caption for exactly as long as the
 * words are on screen, not for the full duration they would have had in the master.
 */
const cuesForCut = (cutId) => {
  if (cutId === 'master') return masterCues();

  const cues = [];
  let cursor = 0;
  for (const excerpt of CUTS[cutId]) {
    const windowFrom = STARTS[excerpt.beat] + excerpt.from;
    const windowTo = windowFrom + excerpt.length;

    for (const line of LINES[excerpt.beat]) {
      const from = STARTS[excerpt.beat] + line.from;
      const to = from + RISE + line.stay + FALL;
      const clippedFrom = Math.max(from, windowFrom);
      const clippedTo = Math.min(to, windowTo);
      // Anything under a third of a second on screen is a flash, not a caption.
      if (clippedTo - clippedFrom < FPS / 3) continue;
      cues.push({
        beat: excerpt.beat,
        from: cursor + (clippedFrom - windowFrom),
        to: cursor + (clippedTo - windowFrom),
        text: line.text,
      });
    }
    cursor += excerpt.length;
  }
  return cues.sort((a, b) => a.from - b.from);
};

const toSrt = (cues) =>
  cues
    .map((cue, index) => `${index + 1}\n${timecode(cue.from)} --> ${timecode(cue.to)}\n${cue.text}\n`)
    .join('\n');

/** WebVTT as well: the website hero and any embedded player want VTT, not SRT. */
const toVtt = (cues) =>
  `WEBVTT\n\n${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${timecode(cue.from).replace(',', '.')} --> ${timecode(cue.to).replace(',', '.')}\n${cue.text}\n`,
    )
    .join('\n')}`;

mkdirSync(OUT, { recursive: true });

const FILES = [
  { cut: 'master', name: 'paralith-brand-film-captions' },
  { cut: 'sixty', name: 'paralith-brand-film-60s-captions' },
  { cut: 'thirty', name: 'paralith-brand-film-30s-captions' },
  { cut: 'teaser', name: 'paralith-brand-film-15s-captions' },
];

for (const { cut, name } of FILES) {
  const cues = cuesForCut(cut);
  writeFileSync(path.join(OUT, `${name}.srt`), toSrt(cues), 'utf8');
  writeFileSync(path.join(OUT, `${name}.vtt`), toVtt(cues), 'utf8');
  console.log(`${name}: ${cues.length} cues`);
}

console.log(`captions written to ${path.relative(path.resolve(ROOT, '..', '..'), OUT)}`);
