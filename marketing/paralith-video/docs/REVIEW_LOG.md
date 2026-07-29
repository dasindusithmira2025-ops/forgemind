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
