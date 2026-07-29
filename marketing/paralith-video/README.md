# PARALITH cinematic product film

Remotion source for the 82-second PARALITH launch film and its landscape, vertical, square,
captioned, clean, trailer, teaser, and poster deliveries.

The story, product-truth boundary, final copy, voice-over, audio plan, transition plan, capture
list, and frame-accurate timing sheet are in
[`docs/PRODUCTION_BIBLE.md`](docs/PRODUCTION_BIBLE.md). Asset provenance and license notes are in
[`docs/ASSET_LICENSES.md`](docs/ASSET_LICENSES.md).

This is an independent npm package with its own lockfile. It is deliberately not an npm
workspace, so video dependencies cannot rewrite the website or PARALITH desktop lockfiles.

## Requirements

- Node.js compatible with the checked-in lockfile
- ffmpeg and ffprobe on `PATH`
- Windows PowerShell with `System.Speech` only when regenerating the delivered narration

The committed score and narration assets are sufficient to preview and render on any supported
Remotion platform. Regeneration is optional.

## Install and preview

```powershell
Set-Location marketing/paralith-video
npm ci
npm run typecheck
npm run dev
```

Remotion Studio uses `http://localhost:4100`; the renderer uses port 4101 and IPv4. Those ports
avoid the renderer-port collision previously observed on this Windows workstation.

## Compositions

| ID | Output | Size | Runtime |
| --- | --- | ---: | ---: |
| `ParalithHero4K` | 4K narrated master | 3840×2160 | 82s |
| `ParalithHero1080p` | 1080p narrated master | 1920×1080 | 82s |
| `ParalithHeroVertical` | Captioned vertical social | 1080×1920 | 82s |
| `ParalithHeroSquare` | Captioned square social | 1080×1080 | 82s |
| `ParalithTrailer30` | Condensed trailer | 1920×1080 | 30s |
| `ParalithTeaser15` | Teaser | 1920×1080 | 15s |
| `ParalithHeroCaptioned` | Captioned landscape master | 1920×1080 | 82s |
| `ParalithHeroClean` | Score/SFX, no narration | 1920×1080 | 82s |
| `ParalithPoster` | Poster still | 3840×2160 | still |

List the live registry:

```powershell
npx remotion compositions
```

## Audio assets

The score and UI effects are deterministic original synthesis. Narration is generated locally
from the final script.

```powershell
npm run assets
```

This runs:

- `scripts/generate-audio.mjs`
- `scripts/generate-voiceover.ps1`

The raw WAV intermediates stay under ignored `out/audio-source/`. Render-ready MP3 stems live
under `public/audio/`.

## Review stills

```powershell
npm run probe
npm run probe:formats
node scripts/probe.mjs 1080 2600 4470
```

The probes bundle once and write representative PNG frames to ignored `out/probe/`.
`probe:formats` checks the vertical and square safe layouts rather than cropping the landscape
frames.

## Render

Render the single masters:

```powershell
npm run render:1080
npm run render:4k
npm run still
```

Render every required delivery:

```powershell
npm run render
```

Outputs are written outside the package to `media/exports/`:

```text
paralith-hero-film-4k.mp4
paralith-hero-film-1080p.mp4
paralith-hero-film-vertical.mp4
paralith-hero-film-square.mp4
paralith-trailer-30s.mp4
paralith-teaser-15s.mp4
paralith-hero-captioned.mp4
paralith-hero-clean.mp4
paralith-poster.png
```

The render script uses PNG intermediates, BT.709, yuv420p, AAC 320 kbps, H.264 at CRF 14 for
4K and CRF 16 for the other videos, and a conservative concurrency cap. This preserves 1 px UI
rules and small monospace text without exhausting Chrome tabs during the 4K render. It then
normalizes each mix to -16 LUFS with a -1.5 dBTP ceiling while stream-copying the encoded video.
The individual 1080p and 4K render commands normalize their own output as well.

## Verify

```powershell
npm run typecheck
npm run validate
npm run verify
```

`validate` checks the composition registry, required assets, font payload, unsupported-claim
guardrails, and that every narration clip fits its scene. `verify` uses ffprobe and ffmpeg to
assert every required filename, codec, duration, resolution, frame rate, pixel format, 48 kHz
stereo audio stream, integrated loudness, and true peak. The review process also inspects rendered
contact sheets and targeted frames; successful encoding alone is not visual approval.

## Source map

```text
public/
  audio/             generated score and narration
  brand/             official PARALITH alpha assets
  fonts/             shipped Geist variable font
scripts/
  generate-audio.mjs
  generate-voiceover.ps1
  normalize-audio.mjs
  probe.mjs
  render-all.mjs
  verify-exports.mjs
src/
  components/        reusable product, motion, caption, and audio primitives
  compositions/      film and poster compositions
  data/              centralized timing and copy
  scenes/            nine narrative scenes
  styles/            centralized visual tokens
  utils/             deterministic layout and motion helpers
```

Do not reintroduce the removed Mission Control or Memory dashboards into the film. Current
product truth and omitted roadmap functionality are documented in the production bible.
