# Review log

This file records concrete observations and corrections for the three required review passes.
Commands and rendered evidence are added as each pass completes.

## Pass 1 — narrative cut

- Rendered 16 representative `ParalithHero1080p` frames across all nine scenes to
  `out/probe/pass1-contact-sheet.png`.
- Rendered the complete 82.048-second 1080p narrative cut to
  `media/exports/paralith-hero-film-1080p.mp4`.
- Confirmed the problem is explicit before ten seconds, the product category lands during the
  16–23 second reveal, and scenes 04–08 remain inside one product system.
- Confirmed no current scene markets the removed Mission Control or Memory dashboards, obsolete
  `v0.9.4` copy, fake performance statistics, or the dead product-page URL.
- Corrected the closing category statement remaining faintly visible behind the final logo.
- Audio analysis found -15.8 LUFS integrated, but a -0.2 dBFS true peak and insufficient score
  separation under narration. Added frame-accurate score ducking and lowered narration/score gain
  before the next encode.

## Pass 2 — motion and visual refinement

- Rendered eight representative frames for both `ParalithHeroVertical` and
  `ParalithHeroSquare`.
- Confirmed the social compositions use their own product-window dimensions and layout branches;
  they are not landscape center crops.
- Found captions colliding with scene statements in both social formats.
- Moved social captions into a lower safe band, removed redundant social secondary statements,
  moved the primary statement upward, and reduced long-headline size.
- Re-rendered the same 16 format frames. Confirmed product UI, statements, and caption bands are
  separated in Workspace, Parallel, Repository, Record, Decision, and the final brand hold.
- Confirmed vertical and square layouts retain the actual Project/Workspace, Swarm, Repository,
  evidence, and review hierarchy without exposing the rejected live browser capture.

## Pass 3 — final polish

- Rendered all eight video deliveries and the poster from the frozen source. The batch completed
  with no stderr output.
- Inspected contact sheets generated from the encoded 1080p, vertical, square, 30-second, and
  15-second exports, plus targeted 4K and teaser closing frames and the 4K poster.
- Confirmed the product hierarchy, caption safe areas, final logo hold, verified root URL, and
  responsive UI remain legible in the delivered files.
- Measured the first final mix at -18.3 LUFS integrated and -4.0 dBTP. It was safely unclipped but
  below the delivery target.
- Added deterministic two-pass EBU R128 normalization with video stream-copy. Final narrated
  masters measure -15.9 LUFS / -1.5 dBTP; the clean master measures -16.0 LUFS / -2.5 dBTP;
  trailer and teaser measure -16.0 / -15.9 LUFS with peaks below -2.8 dBTP.
- Verified all videos are H.264, 60 fps, yuv420p, and include 48 kHz stereo AAC. Durations are
  82.048 seconds for hero variants, 30.059 seconds for the trailer, and 15.061 seconds for the
  teaser.
- Confirmed the final 4K master is 3840×2160 and the poster is a rendered 3840×2160 PNG.

## Brand film — build and review

A separate deliverable from the narrated explainer above. See `docs/BRAND_FILM.md`.

### Why a new cut rather than a revision

Reviewed the existing film against the brief (brand piece, digital twin, not machine-assembled)
and found three problems that a revision could not reach:

- The palette was invented. `src/styles/tokens.ts` defined `#04060b`, `#0f1118`, `#22d3ee`,
  `#4f6bff`; the product's real tokens are `#0a0a0a`, `#171717` and an iris `#a78bfa` accent used
  only for state. The film's blue-cyan chrome contradicted PARALITH's own genome rule that chrome
  stays achromatic and chroma is spent on meaning.
- The interface was a generic abstraction — a `Panel` component, a `CodeTexture` of grey
  placeholder bars, `StatusDot` with a coloured `box-shadow` glow. The product's status dot is a
  flat 7px circle with no shadow, and its panes are `.terminal-pane` / `.terminal-header`.
- `font.mono` was set to Geist. The product renders terminals in Cascadia Mono at 13px / 1.15.

### Product twin

- Built `scripts/sync-product-ui.mjs`, which copies `Paralith-tauri/src/index.css` and calls the
  product's own `toCssVars()` on its own `paralith-dark` theme. Verified it emits 92 CSS custom
  properties and the full xterm palette.
- Rewrote the stylesheet's 14 width media queries as `@container paralith-window` queries after
  confirming that a 1440-wide window inside a 1920 canvas would otherwise never cross the
  product's own `max-width: 1440px` breakpoint, showing chrome no user has.
- Confirmed the terminal face against `src-tauri/src/models/settings.rs`:
  `terminal_font_family` is `"Cascadia Mono, Consolas, monospace"`, size 13, line height 1.15.
- Rendered `ParalithTwinProof` and inspected it at 1:1 and at 2.4x. The amber status dot, the 2px
  inset warning edge on the waiting pane's header, the `waiting 11m` badge, and the Fleet Bar's
  four-step pressure bars (tall at 11m, short at 38s) all resolve exactly as the product's CSS
  specifies.
- Added `sync:product:check` to `npm run validate`. Confirmed it fails on drift and passes after
  regeneration.

### Corrections made during the cut

- Pane rects were double-offset by the chrome: `.pane-window-layer` already sits inside
  `.app-canvas`, so adding the sidebar width and header height again pushed the tiling off the
  window. Pane coordinates are now canvas-local.
- The terminal was bottom-anchored from its first row, leaving a blank band above the output.
  Corrected to fill downward from the top and only scroll once the buffer exceeds the pane.
- Three-column tilings were legal (392px clears the 280px docked minimum) but squeezed
  `.terminal-title strong` past its 160px cap, hiding the pane name the Fleet Bar refers to. All
  tilings moved to two columns.
- The Fleet Bar reported six agents over a canvas holding one, and the sidebar row claimed six
  panes. Both now derive from the pane list.
- `hold()` degenerated to a zero-width `interpolate` range and killed six of fourteen probe
  frames. `ramp()` now answers a zero-length ramp as a step.
- Camera moves were easing on the product's UI curve, `cubic-bezier(.16, 1, .3, 1)`, which spends
  three quarters of its travel in the first fifth of its time — a seven-second pull-back read as a
  snap. Long moves moved to `EASE_CAMERA`.
- Two push-ins left the scaled window narrower than the frame, so `contain` re-centred them and
  the move did not register. Raised past the 1.34x threshold.
- Copy was unreadable over pushed-in shots. Added a scrim keyed to the copy's own timing rather
  than a permanent lower-third grade.
- The opening pane held four rows of output in a full-canvas terminal. Extended the transcript
  with earlier work and joined the session already in progress.
- `public/brand/mark-alpha.png` and `wordmark-alpha.png` are named for an alpha channel they do
  not have — the logo pack's navy plate is baked in, and both showed as a rectangle on black.
  Sampled the plate at `rgb(0, 4, 15)` and cut true transparent masters from the 4K pack. A first
  attempt using a flat per-channel subtraction pulled the white wordmark to cream and was
  corrected to rescale each channel across its real range.
- The film was cutting to the explainer's score, whose swells land mid-beat over this edit.
  Wrote `scripts/generate-brand-score.mjs` against the brand cut's own beat map.

### Delivery

- 1080p master rendered from frozen source: H.264, 1920x1080, 60fps, yuv420p, 48 kHz stereo AAC,
  82.048s.
- Score measured at -18.3 LUFS integrated, -7.2 dBTP before master normalisation.
- `npm run verify:brand` checks the delivered masters against the duration imported from
  `src/film/script.ts`, so a re-timed beat cannot ship against a stale render.
