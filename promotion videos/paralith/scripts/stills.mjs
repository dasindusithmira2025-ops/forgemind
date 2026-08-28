/** Bundle once, then dump review stills for the frames passed on argv. */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";

const frames = process.argv.slice(2).map(Number);
if (!frames.length) {
  console.error("usage: node scripts/stills.mjs <frame> [frame...]");
  process.exit(1);
}

const outDir = path.resolve("out/stills");
fs.mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "ParalithPromo" });

for (const frame of frames) {
  const output = path.join(outDir, `f${frame}.png`);
  await renderStill({ composition, serveUrl, output, frame, overwrite: true });
  console.log("wrote", output);
}
process.exit(0);
