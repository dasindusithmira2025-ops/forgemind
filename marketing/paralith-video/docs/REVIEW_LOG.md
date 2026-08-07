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

## Campaign film — build and review

The current master. See `docs/CAMPAIGN_FILM.md`.

### Why a new cut rather than a revision

The brief specified an eight-sequence, 75–95 second structure with a mark at 0:12 and a ten-file
delivery matrix. The existing brand cut is eight beats in a different order, holds its mark to 0:31,
and ships three files. Two of the brief's sequences also named features — a Mission Control
dashboard and a Memory screen — that were deleted from the product on 2026-07-16.

### Product truth, established before any scene was written

- Confirmed Mission Control and Memory are absent from `Paralith-tauri/src`. The mission sequence
  moved to **Swarms** and the continuity sequence to **Agent Resume**, both verified wired end to
  end in Rust before being filmed.
- Considered and rejected the Swarm work view's **Memory tab** for the continuity sequence. Its read
  path is live (`swarm_context_packs` snapshots project Memory revisions into agent prompts), but
  the only writers of `memory_items` are migration tests and `seed_project_memory_for_test`, so a
  real install shows the empty state. Filming it populated would have been the one thing the brief
  forbids.
- Found `.swarm-model-defaults` has no styles anywhere in `Paralith-tauri/src/index.css`, so it
  paints as unstyled markup in the shipping app. Omitted from the twin; filed against the product.
- Corrected the Swarm twin's chrome. The first version wrapped it in the workspace `AppShell` with
  the sidebar and status bar; `SwarmsScreen.tsx` actually renders a full-screen `repo-shell` with a
  `settings-titlebar` and neither of those. It was a screen PARALITH has never drawn.

### Corrections made during the cut

- The Fleet Bar read **2h41m**. The wait timer was multiplying by frame rather than by elapsed
  seconds. Corrected to 90 seconds of story per second of film, which puts it at 11m24s exactly as
  the camera reaches the bar.
- The proof sequence claimed "Ready for review" over "2 active tasks · 2 queued". Split the task and
  test tables into `building` and `ready` stages so the metrics strip cannot disagree with the
  banner.
- "Six agents, working at once." was landing at local frame 120 of `parallel`, over a canvas holding
  two — the tiling does not reach six until 250. Moved to 300.
- The opening sequence rendered no copy at all: `Fragments` never mounted `Copy`.
- The opening also read as six tidy cards on a grid, which is not fragmentation. Rebuilt as a
  cascade where each new surface buries the corner of the last and older surfaces dim 9% per window.
- The endcard used `brand/lockup.png`, which has the *previous* cut's tagline baked into the
  artwork. The film would have ended on two competing taglines four seconds apart. Replaced with
  mark + wordmark + category line.
- The Agent Resume rows showed `D:\work\orbital\.worktrees/builder-1` — mixed separators — and put
  "Stopped for an update" in the slot where the component shows a relative timestamp.
- The Direct sequence pulled back to the whole window on the Tasks list, putting a third of the
  frame on the empty canvas below the last row. Camera now stays on the rows.

### Second pass — direction change

The first delivery was reviewed as too austere: correct but inert, with the wrong typeface and a
weak score. Three things changed.

- **Typography.** Replaced Geist with **Chakra Petch**, which is not a new choice but *the Corelith
  brand face* — `corelith-web/src/app/layout.tsx` loads it for both display and sans. Retuned the
  whole system for it: tracking positive rather than negative, weight down a step, leading up. Geist
  is PARALITH's interface font and was never the right instrument for a brand statement.
- **Score.** Replaced the deterministic synthesis with an arrangement built from twelve ElevenLabs
  stems. Two stems came back unusable — `pulse` at 48 dB below full scale and `machine` at 40 dB
  down — because the prompts asked for "soft" and "distant"; asking for "clearly audible" fixed
  both. Then found the encode's `loudnorm=…:LRA=10` was compressing the loudness *range* and had
  flattened the arrangement to within 4 dB across the whole film. Removed it; the delivered score
  now measures a 15 dB range with `parallel` as the peak and the opening at -26 dB.
- **Cinematography.** Added `src/campaign/Cinema.tsx`: a brand-tinted drifting atmosphere, a key
  light and falloff, a specular bezel, a contact shadow, a floor reflection, and a few degrees of
  perspective on the establishing and closing shots only. The reflection was cut from 12% to 7% and
  blurred harder after the first pass left the reflected terminal text readable upside-down.

### Third pass — the 9:16 cut

Rendered and inspected the vertical delivery for the first time and found it unusable on two counts,
both of which had been invisible in the landscape review.

- **The type was rendering at 22px.** `useScale()` returns `width / 1920`, which is correct for the
  landscape master and wrong for a 1080-wide portrait frame: it scaled every statement to 56% of its
  intended size. Copy now measures against a 1080-wide basis in portrait, and the portrait sizes were
  re-specified against that basis (62px primary, 47px secondary, 44px caption).
- **The window floated.** At 0.94× frame width the product sat 1015px wide in a 1080px frame with a
  third of the height empty above and below — a landscape video someone had letterboxed. It is now
  scaled slightly past the frame edge (1.06×) so it crops rather than floats, and parked at 36% of
  the frame height with the lower band left for copy.

Re-inspected after the fix: the per-file agent attribution in the Repository sequence — the single
most important thing the vertical cut has to carry — is legible at thumbnail size.
