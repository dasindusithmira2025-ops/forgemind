# PARALITH — "The only way through"

The gate film. `src/gate`, composition `ParalithGate4K`, 78 seconds at 60fps.

This is a new film, not a re-cut. It shares no scene, layout, motion curve, score, stem, copy line
or delivered filename with the narrated explainer (`src/scenes`), the brand cut (`src/film`) or the
campaign cut (`src/campaign`). Those three stay registered and their delivered masters stay
reproducible from source.

## Why another film

The three previous cuts all make the same argument — development is fragmented, PARALITH is the
control plane — and all three make it by touring the product. A fourth tour would have been the
same film with new furniture.

This one argues something none of them state: **not what PARALITH lets you do, but what it refuses
to let happen.** The product page already publishes three guarantees under the heading "Three
states, and only one way through":

1. The agent writes, but not into your project.
2. The change has to pass before it can move.
3. You are the one who lets it through.

Those three are the film. It follows one change — from the sentence that asks for it to the commit
that lands it — through three gates it is not allowed to skip.

## The conceit

A single direction of travel. In all seven sequences the work enters from the left, crosses a
horizontal rail at a fixed height, and leaves to the right. Nothing in this film ever moves
backwards, because the argument is that in PARALITH nothing does.

The rail sits at design-space y=612 in every sequence, which is what makes seven hard cuts read as
one uninterrupted move: the camera has advanced along the line, the horizon has not.

The three gates are literal mechanisms — two shutters that meet on the rail and occlude it. They
open vertically, never horizontally, because a shutter that slides aside implies it could slide
back. In `verification` one of them does not open at all, and the film stops and waits for four and
a half seconds. That is the most important stretch in it.

## The cut

| # | Sequence | In | Frames | What happens | On-screen copy |
| --- | --- | ---: | ---: | --- | --- |
| 01 | instruction | 0:00 | 600 | One sentence is typed and then collapses into a single object on the rail. | `It starts with one instruction.` |
| 02 | split | 0:10 | 720 | The object becomes six. Six agents, six branches, one lane each. | `Six agents take it apart.` / `Each one gets a branch of its own.` |
| 03 | isolation | 0:22 | 780 | **Gate one, closed the whole sequence.** Five lanes of visible work on the near side; the project on the far side, head hash unchanged for thirteen seconds. | `The agent writes.` / `Not into your project.` |
| 04 | verification | 0:35 | 780 | Six checks. Five pass. `contract` fails at 0:41.2, the gate holds, and everything stops until the debugger clears it at 0:45.7. | `Every change is checked.` / `A failure stops where it is.` |
| 05 | consent | 0:48 | 720 | The review — what changed and what was left alone — then four still seconds, then a cursor. | `You are the one who lets it through.` / `There is no override.` |
| 06 | through | 1:00 | 480 | The change lands on `main`. The record is sealed with the failure still in it. | `Then, and only then, it lands.` |
| 07 | close | 1:08 | 600 | The rail terminates. Mark, category, title, domain. | `The only way through.` |

Total 4,680 frames — 78.000 seconds.

## Product truth

Every noun on screen is one the product uses.

| On screen | Source |
| --- | --- |
| coordinator, scout, builder, debugger, reviewer, integrator | `SwarmAgentRole`, `models/swarm.rs` |
| understanding, planning, building, verifying | `SwarmPhase`, `models/swarm.rs` |
| `decision_required`, `ready_for_review` | `SwarmStatus`, `models/swarm.rs` |
| `paralith/swarm-4f2a/builder-91cb` | the format `swarm_service.rs` writes |
| the change never entering the working tree | the published isolation guarantee |
| a failed check stopping the change where it is | the published verification guarantee |
| no way through without a human approval | the published consent guarantee |

Nothing in this film claims a speed, a productivity multiple, a token count or a cost. It shows one
change taking seventy-eight seconds and one of its checks failing.

The failing check is the second clause of the instruction. The person asked for the callback
contract to stay intact, and the check that fails is the contract check — not a lint rule chosen
because something needed to go red. The record in sequence six keeps the failure in it: `6 · 1
failed · 1 repaired`. A record that quietly drops the check that failed would be the exact
dishonesty this film is about.

## Design system

Drawn as a schematic that happens to be lit, rather than as product photography. No bloom, no
reflection, no perspective, no rounded containers, no floating window. The subject is a mechanism,
and a mechanism drawn with soft edges looks like it might yield.

Colour follows the product's own rule: chroma is reserved for meaning. There are three chromatic
values in the entire film and each means exactly one thing.

| Token | Value | Means |
| --- | --- | --- |
| `--accent` | `#a78bfa` | the work itself — the object on the rail, and nothing else |
| `--success` | `#86efac` | a condition that has been satisfied |
| `--warning` | `#fbbf24` | a condition that has not, and has therefore stopped |

Type is split by voice: **the machine speaks in JetBrains Mono and the film speaks in Chakra
Petch.** Every string the product would render itself — branches, checks, paths, states, the
instruction — is monospaced. Every string that is the film talking to the viewer is not.

## Score

`scripts/build-gate-score.mjs`. Entirely synthesised from oscillators and seeded noise: no samples,
no stems, no library, no network. `ffmpeg` encodes the finished buffer and nothing else.

The piece is in D and spends seventy of its seventy-eight seconds refusing to resolve — the harmony
is stacked fifths and seconds with no third in it, so it is neither major nor minor. The only third
arrives at 57.4s, on the frame a person approves the change.

The arrangement exists to carry one event. At 41.2s, the frame the contract check fails, the pulse,
the pad, the rail ticks and the shimmer all **cut** — not fade — and four and a half seconds play
under a single detuned tone over the bare drone. It is the loudest thing in the score and it is a
silence. `loudnorm` is deliberately not applied at the score stage: its loudness-range target
compresses exactly the dynamic this arrangement exists to create.

## Deliverables

`npm run render:gate` writes to `media/exports`. Every filename is new; nothing overwrites a
previously delivered film.

| Key | Composition | File |
| --- | --- | --- |
| `4k` | `ParalithGate4K` | `paralith-gate-film-4k.mp4` |
| `1080p` | `ParalithGate1080p` | `paralith-gate-film-1080p.mp4` |
| `captioned` | `ParalithGateCaptioned` | `paralith-gate-film-captioned.mp4` |
| `60s` | `ParalithGate60` | `paralith-gate-film-60s.mp4` |
| `30s` | `ParalithGate30` | `paralith-gate-film-30s.mp4` |
| `15s` | `ParalithGate15` | `paralith-gate-film-15s-teaser.mp4` |
| `loop` | `ParalithGateLoop` | `paralith-gate-hero-loop.mp4` (silent) |
| — | `ParalithGatePoster` | `paralith-gate-film-poster.png` |

Plus SRT and VTT per cut, generated from `LINES` by `scripts/generate-gate-captions.mjs`.

The short cuts are **excerpts of the master timeline, not re-edits.** Each plays a sequence from an
internal frame through the same component, and every scene is a pure function of its
sequence-local frame, so a trailer renders exactly the frames the master renders at that point. No
scene knows it is in a trailer.

## No vertical

There is no 9:16 or 1:1 composition, and that is a decision rather than an omission.

The film's subject is a horizontal transport line roughly 1,900 design-pixels wide, and every
sequence reads left to right across the full frame. A vertical was rendered and checked at frame
900: scaled into a 1080-wide canvas the machine text lands at about seven physical pixels, which is
not small, it is illegible, and the elements past x=1250 — the project plate, the commit node —
fall outside the frame entirely.

A credible vertical needs its own layout, with the rail running down the frame instead of across
it. That is a second design pass, not a responsive rule. Until it exists, the captioned 16:9 cut is
the sound-off delivery.

## Commands

```
npm run score:gate        # synthesise the score (needs ffmpeg)
npm run captions:gate     # SRT + VTT from LINES
npm run render:gate       # full delivery batch, then poster and captions
npm run render:gate 30s   # one delivery
npm run verify:gate       # container, duration, loudness and sidecar checks
npm run typecheck
```

`verify:gate` imports `CUT_FRAMES` from `src/gate/script.ts` and asserts each delivered file's
duration against it, so a re-timed sequence that has not been re-rendered fails there rather than
shipping.
