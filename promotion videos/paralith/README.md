# Paralith promotional film

A Remotion project that renders the Paralith brand film locally. No stock footage,
no product screenshots, no music — every frame is drawn and animated from vector
primitives, brand colour tokens and the traced Paralith logo geometry.

## Output

`Paralith-Promo-4K.mp4` — 3840x2160, 60 fps, H.264 / yuv420p, BT.709, CRF 14, no audio track.
Composed at 1920x1080 and rendered at `--scale=2`, so all text and vector art is
resolved natively at 4K.

## Commands

```powershell
npm install
npm start                  # Remotion Studio, for scrubbing the timeline
npm run render -- ParalithPromo "Paralith-Promo-4K.mp4" --scale=2 --muted --concurrency=10
node scripts/stills.mjs 100 652 1476   # bundle once, dump review frames to out/stills
node scripts/trace-mark.mjs mark       # regenerate src/lib/markPath.ts from the logo pack
node scripts/trace-mark.mjs wordmark   # regenerate src/lib/wordmarkPath.ts
```

## Structure

| Path | Role |
| --- | --- |
| `src/timeline.ts` | Scene order, per-scene length, cross-dissolve overlap |
| `src/Film.tsx` | Shot shell: dissolve, slow push, open/close fade to black |
| `src/lib/Backdrop.tsx` | Persistent canvas: bloom, engineering grid, grain, vignette |
| `src/lib/Mark.tsx` | Logo monolith — outline draw, gradient fill, specular sweep |
| `src/lib/Wordmark.tsx` | PARALITH letterforms, revealed letter by letter |
| `src/lib/type.tsx` | Headline / label / sub typography with word-stagger motion |
| `src/lib/ui.tsx` | Panels, dots, chips shared by the product scenes |
| `src/scenes/*` | One file per beat of the film |

`markPath.ts` and `wordmarkPath.ts` are generated: `scripts/trace-mark.mjs` decodes the
4K brand PNGs, traces their silhouettes with marching squares, simplifies the contours
and emits SVG paths. That is why the logo is true vector in the film rather than a bitmap.

## Fonts

Inter and JetBrains Mono (latin + latin-ext subsets) are vendored in `src/fonts/` and
loaded through `fonts.css`, so rendering never depends on a network fetch.
