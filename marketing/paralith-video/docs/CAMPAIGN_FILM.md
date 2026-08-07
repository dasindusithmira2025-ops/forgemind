# PARALITH campaign film — "Build beyond the editor."

A 95-second brand film in eight sequences. It is the current master and supersedes the earlier
eight-beat brand cut documented in [`BRAND_FILM.md`](BRAND_FILM.md) and the narrated explainer in
[`PRODUCTION_BIBLE.md`](PRODUCTION_BIBLE.md); both remain registered and reproducible from source.

The product in it is not a mock-up. Every interface frame is rendered by `src/product/`, styled by
PARALITH's own stylesheet and coloured by PARALITH's own theme engine, both generated from
`Paralith-tauri` by `scripts/sync-product-ui.mjs`, with `npm run sync:product:check` failing the
build if the two have drifted apart. See [`BRAND_FILM.md`](BRAND_FILM.md#what-makes-it-a-digital-twin)
for how the twin is built; this document covers the campaign cut only.

**Accuracy is a floor, not the goal.** The earlier cut treated pixel-exactness as the top
constraint and produced something correct and inert: a flat rectangle of accurate interface on flat
black. This cut keeps the interface honest — the twin, the real surfaces, the real numbers — and
then lights it, tilts it, gives it a floor to stand on and a room to stand in. Where the two
priorities collide, the film is allowed to win, and `src/campaign/Cinema.tsx` records exactly where
that happens and why.

## Compositions

| Composition | Output | Size | Runtime |
| --- | --- | ---: | ---: |
| `ParalithCampaign4K` | 4K master | 3840×2160 | 95.0s |
| `ParalithCampaign1080p` | 1080p distribution / clean | 1920×1080 | 95.0s |
| `ParalithCampaignCaptioned` | Burned-in captions | 1920×1080 | 95.0s |
| `ParalithCampaign60` | Launch cut | 1920×1080 | 60.0s |
| `ParalithCampaign30` | Promotional cut | 1920×1080 | 30.0s |
| `ParalithCampaign15` | Teaser | 1920×1080 | 15.0s |
| `ParalithCampaignVertical30` | 9:16 social, captioned | 1080×1920 | 30.0s |
| `ParalithCampaignVertical` | 9:16 full length, captioned | 1080×1920 | 95.0s |
| `ParalithCampaignLoop` | Silent website hero loop | 1920×1080 | 12.0s |
| `ParalithCampaignPoster` | Poster still | 3840×2160 | — |

```powershell
npm run score:campaign      # the four scores, one per cut length
npm run captions:campaign   # SRT + VTT, generated from the copy table
npm run probe:campaign      # contact sheet across all eight sequences
npm run render:campaign     # the whole delivery batch
npm run verify:campaign     # ffprobe + loudness assertions against the cut
```

`ParalithCampaignVertical` is registered but not in the delivery batch: a 95-second vertical is
longer than any social surface will autoplay, and the 30-second vertical is the asset that gets
used. Render it with `npx remotion render ParalithCampaignVertical …` if a full-length 9:16 is ever
wanted.

## The cut

Eight sequences, frame-exact at 60fps, totalling 5,700 frames. Timings live in
`src/campaign/script.ts` and nothing restates them — the score generator, the caption generator and
the delivery verifier all import that file.

| # | Sequence | In | Length | What happens |
| --- | --- | ---: | ---: | --- |
| 1 | `fragments` | 0:00 | 12.0s | Six tool surfaces cascade over each other. The permission prompt that will matter is buried fifth. |
| 2 | `arrival` | 0:12 | 11.0s | Black. The mark, the wordmark, the category — then a hand-off straight into the workspace. |
| 3 | `direct` | 0:23 | 13.0s | A mission is typed as an acceptance criterion; the Swarm staffs up and the task graph appears. |
| 4 | `parallel` | 0:36 | 16.0s | The canvas divides 1→2→4→6, one agent stops unannounced, and the Fleet Bar answers. |
| 5 | `repository` | 0:52 | 12.0s | The working tree with per-file agent attribution, then the diff. |
| 6 | `proof` | 1:04 | 12.0s | The Swarm's Tests tab, then its Evidence tab and the ready-for-review banner. |
| 7 | `continuity` | 1:16 | 9.0s | Agent Resume: three interrupted sessions, tied to their worktrees, resumed. |
| 8 | `close` | 1:25 | 10.0s | Pull back over the whole environment, then the statement, then the mark. |

The one transition that is not a hard cut is the entry into `arrival`, which dips fully to black
first: a mark that cuts in from a busy interface reads as an interruption rather than an arrival.

### Shot list

| Sequence | Local frames | Shot |
| --- | ---: | --- |
| `fragments` | 0–640 | Locked wide, imperceptible 1.06→1.00 pull-back. Surfaces arrive at 0/34/62/96/128/160. |
| `arrival` | 30–190 | Mark fades and settles; wordmark wiped in from the left. |
| `arrival` | 200–330 | Category line under the wordmark. |
| `arrival` | 400–530 | Brand out, product up from black, rising 26px into its resting position. |
| `direct` | 40–190 | Locked on the Swarm canvas; mission types into the command bar. |
| `direct` | 150–490 | Slow push toward the board as the roster staffs up and edges connect. |
| `direct` | 500–780 | Cut to the Tasks list, held on the rows with a slow 1.40→1.52 push. |
| `parallel` | 0–330 | Wide. The canvas divides at 60, 150 and 250. |
| `parallel` | 360–620 | Wide, held. One pane stops; its wait timer climbs and nothing announces it. |
| `parallel` | 620–790 | Push to 1.95× on the title bar so the Fleet Bar can be read. |
| `parallel` | 850–960 | Pull back out with the waiting pane focused. |
| `repository` | 50–300 | Push to 1.72× on the changed-file list. |
| `repository` | 330–600 | Held; the diff walks open. |
| `proof` | 40–300 | Push to 1.42× on the Tests tab. |
| `proof` | 330–720 | Cut to Evidence with the ready-for-review banner. |
| `continuity` | 30–250 | Push to 1.24× on the Agent Resume modal; rows fill as the recheck completes. |
| `continuity` | 400–540 | Resume all: every row flips to running. |
| `close` | 0–190 | Pull back 1.16×→wide over the whole environment. |
| `close` | 235–390 | Black. "Build beyond the editor." |
| `close` | 392–600 | Mark, wordmark, category, company, domain. |

## What the film claims, and what it does not

Every sequence is anchored to a surface PARALITH actually ships. Two of the brief's sequences named
features that do not exist, and both were re-shot on the real equivalent rather than reconstructed.

**There is no Mission Control dashboard.** It was deleted from the product on 2026-07-16 along with
the Memory screen and the AI-capacity view. The mission sequence is therefore shot on **Swarms**,
which is what actually turns a described outcome into staffed, isolated work: the five phases in the
health strip are the real `SWARM_PHASES`, the roles are the real `SwarmRole` union, `dependsOn`
really is what renders as "N dependencies", and `agent.worktree` really is per-agent. The
"MISSION CONTROL" badge visible in the corner of the agent canvas is not the film's caption — it is
a `::after` on `.swarm-canvas` in the product's own stylesheet.

**There is no Memory feature to film.** The brief's seventh sequence asked for project memory
persisting across sessions. The read path for that is genuinely live — `swarm_context_packs`
snapshots project Memory revisions into an agent's prompt, with provenance — but nothing outside
migration tests writes `memory_items`, so a real installation's Memory tab shows its empty state.
Filming it populated would have presented an unshipped capability as shipped, so the sequence is
shot on **Agent Resume** instead, which is fully wired end to end (`services/agent_resume.rs`, its
commands, its migration, `AgentResumeCenter.tsx`) and makes the same point truthfully: the machine
restarts, and the exact provider session comes back in the worktree it was started in.

**One row of the Swarm screen is deliberately missing.** `SwarmOverview` renders a `ModelDefaults`
section whose classes are not styled anywhere in the product's only stylesheet, so it paints as
unstyled markup in the shipping app. Reproducing it faithfully would put malformed interface on
screen; restyling it here would be the film inventing a design the product does not have. It is
omitted, and the gap is filed against the product.

**The copy is timed to what is on screen.** "Six agents, working at once." lands at local frame 300
of `parallel`, after the tiling has actually reached six — an earlier version put it at 120, over a
canvas holding two, which is the kind of mismatch that costs a viewer their trust in everything else
the film asserts.

**The wait timer runs at 90 seconds of story per second of film.** It reaches 11m24s exactly as the
camera arrives at the Fleet Bar, which is the top step of the product's four-step wait ladder. This
is the film's one feature claim and the only number it rests on.

The work itself — a payments service called `orbital` — is invented, because filming a real
customer's repository is not something a brand film gets to do. The pane states, provider names,
wait formatting, git status letters, lifecycle labels, evidence types and runtime vocabulary are all
the product's.

## Why there is no narration

The only voice this workstation can synthesise is the Windows `System.Speech` one the earlier
explainer used, and a synthetic voice reading marketing copy is the single loudest signal that
nobody was in the room when a film was made. The brief allows either a real human read or no
narration at all; this cut carries its copy as type over an original score.

[`VOICEOVER.md`](VOICEOVER.md) holds the script for a real read, timed against the existing edit, so
a narrated version needs no re-timing. Every statement is already a caption cue in
`src/campaign/script.ts`, which is what `npm run captions:campaign` writes the SRT and VTT from.

### Captioned is a mode, not an overlay

Burning subtitles under type that is already on screen would print every line twice. So the
captioned deliverable sets the same strings, at the same frames, as standard centred subtitles in a
lower safe band, and suppresses the cinematic type. Neither version shows a line twice.

## Typography

The film is set in **Chakra Petch**, which is not a choice made in this project. It is the face
Corelith's own site sets everything in — `corelith-web/src/app/layout.tsx` loads it as
`--font-chakra` and `globals.css` maps both `--font-display` and `--font-sans` to it. Its squared
terminals and slight condensation are what let a headline sit under the PARALITH wordmark and read
as the same voice. **JetBrains Mono** is the brand's machine face and sets the film's own chrome.

The earlier cut set its copy in Geist. Geist is PARALITH's *interface* font — the right instrument
for a pane header and the wrong one for a brand statement, and it shared none of the wordmark's
geometry.

Both faces are vendored by `node scripts/fetch-brand-fonts.mjs` and inlined as data URIs; the film
never fetches a font at render time. Terminals inside the product twin stay Cascadia Mono, because
that is what a real PARALITH install draws them in.

`src/campaign/type.ts` holds the whole system, and the three things that had to change beyond the
family name are documented there: tracking goes **positive** (Chakra Petch's squared joins fill in
at display size under the negative tracking a neutral grotesk wants), weight comes **down** by
roughly one step, and leading comes **up**.

## The score

Built from stems generated by ElevenLabs and arranged by `scripts/build-campaign-score.mjs` against
the beat map imported from `script.ts`, so the music cannot drift out of sync with an edit.

ElevenLabs' Music API (`/v1/music`) is the right tool for this and is gated to paid plans — on the
key this project was given it answers `402 paid_plan_required`. The score is therefore built from
twelve *stems* generated through `/v1/sound-generation`, which the same key can reach: a sub drone,
two pads, a warm major-sixth swell, a pulse, two percussion beds, room tone, a riser, an impact, a
shimmer, a resolve and a tactile click.

That turned out to be the better architecture. A composed track has to be cut to the film; stems are
arranged *by* it. Every layer's gain is a function of time expressed in the edit's own terms, which
is how the percussion can collapse to a fifth of its level at the exact frame one agent stops and
return at the exact frame the Fleet Bar names it. The arrangement loses a member when the fleet
does.

```powershell
$env:ELEVENLABS_API_KEY = "..."          # never written to a file, never committed
npm run stems:campaign                    # once; stems are cached on disk afterwards
npm run score:campaign                    # offline from here on
```

The delivered arrangement measures roughly 15 dB between its quietest and loudest sequences —
-26 dB through the opening, -11 dB at the density peak, -14 dB at the drop into the proof sequence.
Getting that range required *removing* `loudnorm` from the encode: its `LRA` parameter is a
loudness-**range** target, and at `LRA=10` it compressed the near-silent opening to within 4 dB of
the peak. Levels are set by the arrangement, peaks by a soft-knee limiter, and the delivered mix is
normalised once, later, by `normalize-audio.mjs` against the finished video.

If a paid key appears, a composed track drops in as one more layer without any of this being thrown
away.

## Deliveries

Written to `media/exports/`:

```text
paralith-brand-film-master-4k.mp4        3840x2160  95.0s
paralith-brand-film-master-1080p.mp4     1920x1080  95.0s   (the clean version — no captions)
paralith-brand-film-captioned.mp4        1920x1080  95.0s
paralith-brand-film-60s.mp4              1920x1080  60.0s
paralith-brand-film-30s.mp4              1920x1080  30.0s
paralith-brand-film-15s-teaser.mp4       1920x1080  15.0s
paralith-brand-film-vertical-30s.mp4     1080x1920  30.0s
paralith-website-hero-loop.mp4           1920x1080  12.0s   (silent)
paralith-brand-film-poster.png           3840x2160
paralith-brand-film-captions.srt / .vtt
paralith-brand-film-60s-captions.srt / .vtt
paralith-brand-film-30s-captions.srt / .vtt
paralith-brand-film-15s-captions.srt / .vtt
```

The `master` infix is deliberate. `paralith-brand-film-4k.mp4` and `paralith-brand-film-1080p.mp4`
are the previous eight-beat cut's delivered masters; they are committed and still reproducible from
`ParalithBrandFilm4K`. Overwriting them because this cut inherited the same product would have
destroyed a deliverable to save a word. Retire them deliberately, or not at all.

`npm run verify:campaign` asserts every filename, codec, resolution, frame rate, pixel format, audio
stream, integrated loudness and true peak — and asserts each duration against the cut length
imported from `script.ts`, so a re-timed sequence that has not been re-rendered fails before it
ships.
