# PARALITH brand film — "Many agents. One build."

An 82-second brand film. It is a separate deliverable from the narrated explainer documented in
[`PRODUCTION_BIBLE.md`](PRODUCTION_BIBLE.md), which remains registered and reproducible; this
document covers only the brand cut.

| Composition | Output | Size | Runtime |
| --- | --- | ---: | ---: |
| `ParalithBrandFilm4K` | 4K master | 3840×2160 | 82.0s |
| `ParalithBrandFilm1080p` | 1080p master | 1920×1080 | 82.0s |
| `ParalithBrandFilmSilent` | No score, for external mix or subtitling | 1920×1080 | 82.0s |
| `ParalithTwinProof` | Calibration still of the product twin | 1440×900 | — |

```powershell
npm run render:brand        # 1080p master + EBU R128 normalisation
npm run render:brand:4k     # 4K master
npm run still:twin          # the calibration still, for diffing against a real screenshot
```

## What makes it a digital twin

The brief was a film whose product footage is the real product, not an artist's impression of it.
Three things are generated from `Paralith-tauri` rather than authored here, and one script proves
they have not drifted.

**The stylesheet.** `scripts/sync-product-ui.mjs` copies `Paralith-tauri/src/index.css` into
`src/product/generated/paralith-ui.css` verbatim, with two mechanical edits: its `@font-face` rule
is dropped (the film installs the same Geist face itself), and its 14 width media queries become
`@container paralith-window` queries. That second edit is what keeps the twin dimensionally
honest — in the application the window *is* the viewport, so a 1440-wide window really does cross
`max-width: 1440px`. Inside a 1920 or 3840 canvas those rules would never fire and the film would
show chrome no user has.

**The palette.** The same script imports `Paralith-tauri/src/theme/themes.ts` and
`tokens.ts` — both pure, DOM-free modules — and calls the product's own `toCssVars()` on its own
`paralith-dark` definition, which is the exact call the application makes when it paints its first
frame. All 92 CSS custom properties and the full xterm ANSI palette land in
`src/product/generated/theme.ts`. Nothing in the film picks a colour.

**The typefaces.** Geist, from the product's bundled `.woff2`. Cascadia Mono for terminals,
because `AppSettings::default()` in the Rust crate sets `terminal_font_family` to
`"Cascadia Mono, Consolas, monospace"` at 13px / 1.15 line height — the film's terminals use those
three values. Cascadia *Mono* rather than *Code* because the product loads xterm.js without a
ligature addon, so ligatures never form on screen.

**The proof.** `npm run sync:product:check` re-derives all of the above in memory and fails if what
is checked in differs. It runs inside `npm run validate`, so a change to PARALITH's design system
cannot silently leave a stale film behind.

Everything else in `src/product/` is markup that mirrors its counterpart in `Paralith-tauri/src`
class for class — `.app-shell`, `.fleet-cell[data-pressure]`, `.ws-row`, `.terminal-pane`,
`.repo-owner-agent`. The only hand-written stylesheet is `src/product/twin.css`, which contains no
appearance at all: it re-roots the product's `:root` rules onto a window element, swaps `100dvh`
for `100%`, and stops CSS transitions, since Remotion renders each frame from a cold DOM and all
motion in this film is authored on the timeline instead.

The window is always laid out at 1440×900 — the product's own default from `tauri.conf.json` — and
scaled as a whole. The browser rasterises after the transform, so the 4K master draws that same
layout at full 4K sharpness, and no scene can quietly widen a column to make a composition work.

## The cut

Eight beats, frame-exact at 60fps, totalling 4,920 frames. Timings live in `src/film/script.ts`.

| # | Beat | In | Length | What happens |
| --- | --- | ---: | ---: | --- |
| 1 | `handoff` | 0:00 | 8.0s | One agent working alone. Opens close on the transcript, pulls back to reveal the window. |
| 2 | `multiply` | 0:08 | 11.0s | The canvas splits 1 → 2 → 4 → 6. Existing panes travel to their new rects. |
| 3 | `silence` | 0:19 | 12.0s | One agent stops. Nothing announces it. The wait timer climbs for eleven seconds. |
| 4 | `reveal` | 0:31 | 9.0s | The mark. |
| 5 | `command` | 0:40 | 11.0s | The Fleet Bar, read close: which agent, and how long. |
| 6 | `evidence` | 0:51 | 9.0s | The working tree, with the product's per-file agent attribution. |
| 7 | `authority` | 1:00 | 10.0s | The diff, the commit message, the human. |
| 8 | `close` | 1:10 | 12.0s | The lockup and the verified root domain. |

The two beat changes that are not hard cuts — into `reveal` and into `close` — dip fully to black
first, because a mark that cuts in from a busy interface reads as an interruption.

### Why there is no narration

The explainer cut is narrated by a synthesised Windows voice. For a brand film that is the single
loudest signal that the piece was assembled rather than made, so this cut carries its copy as type
over the existing original score. `ParalithBrandFilmSilent` exists for anyone who wants to lay a
real voice or a different mix over it.

### What the film claims

One feature claim, in beat 5: PARALITH tells you which agent needs you and how long it has been
waiting. That is the Fleet Bar, and it is real — `features/fleet/FleetBar.tsx`, including the
four-step wait-pressure ladder that drives the cell bar's height so the queue reads without relying
on hue.

Everything else on screen is behaviour, not assertion: strict tiling, per-pane agent state edges,
the sidebar echoing the same waiting state as the title bar, per-file agent attribution in the
Repository view. The work being done — a payments service called Orbital — is invented, because
filming a real customer's repository is not something a brand film gets to do. The pane states,
provider names, wait formatting, git status letters and runtime vocabulary are all the product's.

## Regenerating assets

```powershell
npm run sync:product     # stylesheet + theme, from Paralith-tauri
npm run brand:assets     # transparent mark / wordmark / lockup, from the 4K logo pack
npm run brand:font       # inline Cascadia Mono
npm run validate         # asset presence, twin freshness, claim checks, composition registry
```

`brand:assets` keys the logo pack's flattened PNGs against their measured `rgb(0, 4, 15)` plate and
unpremultiplies the result, which recovers the mark's gradient and its anti-aliased edges without
leaving the plate visible as a rectangle behind the artwork on black.
