# PARALITH — Product Film Production Bible

## Creative concept

**The control plane.**

The film begins with modern development as a collection of individually capable surfaces that
do not share an operational center. At the reveal, those surfaces do not explode or disappear:
they align. From that point forward the camera remains inside one coherent PARALITH system and
motion becomes calmer, more spatially legible, and more deliberate.

The visual argument is product-first:

1. fragmented tools consume attention;
2. PARALITH consolidates operational state;
3. parallel agents remain isolated and observable;
4. repository activity stays reviewable;
5. durable task, attempt, and evidence records preserve accountability;
6. a person makes the final decision.

The visual system is derived from `Paralith-tauri/src/index.css`,
`Paralith-tauri/src/theme/tokens.ts`, the shipped Geist font, and the official PARALITH logo
pack. Interface surfaces remain achromatic. Cyan, blue, violet, status green, warning amber, and
agent-role colors appear only when they communicate identity, state, provenance, or focus.

## Product truth boundary

The current product source and roadmap were audited before story lock.

### Shipped or implemented and safe to show

- Project and Workspace ownership.
- Native PTY terminal grids and provider sessions.
- Claude and Codex agent states.
- Attention routing and explicit permission gates.
- Per-pane isolated Git worktrees and branches.
- Swarm task decomposition, attempts, attention requests, and evidence.
- Repository Command Center: changes, diffs, branches, pull requests, issues, workflows,
  releases, rulesets, supported security signals, operations, approvals, and recovery.
- Diff review, file staging, validation state, and human-controlled merge actions.
- Multi-window/multi-monitor Workspace placement.
- Local-first project and runtime data boundaries.

### Deliberately not shown as shipped

- The removed Mission Control dashboard.
- The removed Memory graph/dashboard.
- A mystical or automatic knowledge graph.
- OS notifications, a fleet-wide dashboard, durable generic Agent Run history, automatic
  conflict prediction, or any roadmap item still marked planned.
- Fake speed, productivity, token, or cost statistics.

The requested “persistent project intelligence” beat is represented by the real Swarm/task model:
task ownership, attempts, sources, tests, and evidence remain attached to the work. It does not
claim that the removed Memory UI exists.

## Master format

- Composition: `ParalithHero4K`
- Runtime: 82 seconds
- Frame rate: 60 fps
- Frames: 4,920
- Master: 3,840 × 2,160, H.264, BT.709, yuv420p
- Working master coordinate system: 1,920 × 1,080
- Audio: 48 kHz stereo, original deterministic score and effects, generated narration
- Safe design: every scene has landscape, square, and vertical layout rules; no delivery relies
  on blind center-cropping.

## Storyboard and timing sheet

| Scene | Time | Frames | Story | Product proof | On-screen copy | Transition |
| --- | ---: | ---: | --- | --- | --- | --- |
| 01 Fragmentation | 00:00–00:07 | 0–419 | Near-black fragments surface one by one: terminal, agent reply, branch, PR, task, CI. Density increases without becoming unreadable. | Plausible surfaces only; no product claim yet. | `Development changed.` then `The environment didn’t.` | Fragments hold on their final coordinates. |
| 02 Pressure | 00:07–00:16 | 420–959 | The same work appears across separate windows and handoffs. A focus cursor crosses surfaces while context labels drift apart. | Real workflow nouns and technically consistent task state. | `Tools everywhere.` `Control nowhere.` | Motion arrests; audio narrows to near-silence. |
| 03 Alignment | 00:16–00:23 | 960–1379 | One thin structural line passes through the fragments. Their edges align into the PARALITH mark and then the product window. | Official mark and product-accurate chrome. | `Meet PARALITH.` `The agentic development environment.` | Shared edge becomes the product title bar. |
| 04 Workspace | 00:23–00:34 | 1380–2039 | A continuous camera move reveals Project navigation, active Workspaces, terminal grid, agent state, repository context, and attention. | Current Workspace hierarchy, native PTYs, status edges, and attention router. | `One environment.` `Complete control.` | Camera tracks toward the active Swarm. |
| 05 Parallel | 00:34–00:46 | 2040–2759 | One task decomposes into coordinator, scout, builder, reviewer, debugger, and integrator work. Each gets an isolated branch/worktree and real state. | Swarms, role pool, task ownership, attempts, isolated worktrees, attention gate. | `Parallel execution.` `Human control.` | The integrator branch becomes the repository branch rail. |
| 06 Repository | 00:46–00:57 | 2760–3419 | A single fluid path moves through changed files, diff, branch, PR, workflow, release, and security signal projections. | Repository Command Center contracts and safe operation ledger. | `Repository intelligence.` `Inside the workspace.` | Selected diff line becomes an evidence relationship. |
| 07 Record | 00:57–01:07 | 3420–4019 | Task → attempt → source → file → test → evidence connections accumulate into a compact operational record. | Real persisted Swarm tasks, attempts, tests, attention, and evidence. | `Context stays attached.` | Verified evidence rows fold into the review panel. |
| 08 Decision | 01:07–01:16 | 4020–4559 | Review shows files changed, tests passed, evidence present, and a final approval. The merge action waits for a human cursor. | Diff review, validation, approval, merge gate. | `Intelligence, with accountability.` | Completed state recedes into black. |
| 09 Direction | 01:16–01:22 | 4560–4919 | Category statement, official mark, company line, verified live root domain. | Brand only. | `Don’t just code with agents.` `Direct them.` `Build beyond the limits of a traditional IDE.` | Clean final impact; hold the logo. |

## Final narration

Narration is delivered calmly at approximately 142 words per minute, with silence around the
opening statement, product reveal, and final brand line.

| Scene | In | Narration |
| --- | ---: | --- |
| Fragmentation | 00:01.0 | Development changed. The environment didn’t. |
| Pressure | 00:07.6 | Development moves faster. Control is scattered everywhere. |
| Alignment | 00:17.3 | Meet PARALITH. The agentic development environment. |
| Workspace | 00:23.8 | PARALITH brings projects, agents, terminals, repositories, and development workflows into one operational workspace. |
| Parallel | 00:34.7 | Run specialized agents in parallel. Isolate their work. Track their state. Focus where human judgment is needed. |
| Repository | 00:46.7 | Review every change. Branches, diffs, pull requests, workflows, releases, and risks, without leaving the workspace. |
| Record | 00:57.8 | Tasks, attempts, sources, tests, and evidence stay attached to the work, so context survives every handoff. |
| Decision | 01:07.7 | Automate the work. Preserve the evidence. Keep the final decision human. |
| Direction | 01:16.6 | Don’t just code with agents. Direct them. PARALITH. |

## Final on-screen copy

- Development changed.
- The environment didn’t.
- Tools everywhere.
- Control nowhere.
- Meet PARALITH.
- The agentic development environment.
- One environment.
- Complete control.
- Parallel execution.
- Human control.
- Repository intelligence.
- Inside the workspace.
- Context stays attached.
- Intelligence, with accountability.
- Don’t just code with agents.
- Direct them.
- Build beyond the limits of a traditional IDE.
- By Corelith Technologies
- corelithtechnologies.com

## Sound design plan

The soundtrack is generated specifically for this film by `scripts/generate-audio.mjs`. It uses
seeded synthesis only—no samples or third-party music.

- 00:00–00:07: filtered sub tone, sparse mechanical ticks, narrow stereo field.
- 00:07–00:16: denser pulse and notification transients; no dramatic trailer percussion.
- 00:16–00:18: intentional subtraction and a short tonal reset.
- 00:18–00:34: wider suspended harmony and a stable pulse.
- 00:34–00:57: layered sixteenth-note activity, role-state ticks, restrained low percussion.
- 00:57–01:07: harmonic relationship tones and quieter rhythm.
- 01:07–01:16: verification impacts and a resolved rising interval.
- 01:16–01:22: rhythm clears; final three-note identity and a clean tail.

UI sounds are synchronized to state changes, not decoration: fragment entrances, structural
alignment, agent dispatch, attention request, repository selection, verification, approval, and
the logo resolve. The score target is approximately -18 LUFS integrated before narration; the
final mix target is -14 to -16 LUFS integrated with true peak below -1 dBFS.

## Transition plan

- Fragment match cuts preserve screen position and terminology.
- Scene 02 freezes rather than hard-cutting away from the problem.
- Scene 03 uses one structural line as a shared element into the app title bar.
- Scenes 04–08 remain inside one continuous product window.
- Agent task rails become repository branch rails.
- A selected diff line becomes an evidence relationship.
- Evidence rows fold directly into the final review gate.
- The close removes UI in depth order, leaving the mark rather than cutting to an unrelated card.

## Product capture list

The film uses controlled React reconstruction because it must be deterministic across 4K,
landscape, square, and vertical deliveries. Reconstruction is measured against current product
source and uses only verified entities.

- Project sidebar with open Workspaces and attention state.
- Native terminal grid with Claude, Codex, and shell sessions.
- Swarm overview with coordinator/scout/builder/reviewer/debugger/integrator roles.
- Worktree and branch identity per task.
- Permission/attention request.
- Repository changed-file list and unified diff.
- Pull request, workflow, release, and supported security signal projections.
- Task attempt, source, test, and evidence record.
- Final review gate with explicit human approval.

The live Tauri audit was also run. It reached `[ready]` with the isolated local-development
identity. The restored session contained personal browser content, so it was rejected as film
material and no private capture is included.

## Asset list

- Official PARALITH alpha mark and wordmark derived from the repository logo pack.
- Geist variable font shipped with the PARALITH desktop app.
- Generated soundtrack and UI effects.
- Generated narration.
- React-rendered product UI; no stock footage, people, external screenshots, or third-party
  interface captures.

## Technical architecture

```text
marketing/paralith-video/
  docs/
    PRODUCTION_BIBLE.md
    ASSET_LICENSES.md
    REVIEW_LOG.md
  public/
    audio/
    brand/
    fonts/
  scripts/
    generate-audio.mjs
    generate-voiceover.ps1
    probe.mjs
    render-all.mjs
    verify-exports.mjs
  src/
    components/
    compositions/
    data/
    scenes/
    styles/
    utils/
    Root.tsx
    index.ts
```

`src/data/timing.ts` is the only master scene boundary. `src/data/copy.ts` owns narration,
captions, and on-screen copy. `Film` receives an explicit format, cut, narration, and caption
configuration. Scene components query the adaptive layout rather than reading hard-coded delivery
dimensions. Random-looking texture is seeded.

## Review protocol

### Pass 1 — narrative cut

- Render representative stills and the 1080p master.
- Check that the problem is clear before ten seconds and the product arrives by 23 seconds.
- Remove any unsupported feature claim or dead product URL.

### Pass 2 — motion and visual refinement

- Review every scene at early/middle/late frames.
- Correct hierarchy, safe-area, camera, typography, and transition defects in landscape, square,
  and vertical layouts.

### Pass 3 — final polish

- Inspect mixed and clean audio waveforms and loudness.
- Validate captions, compression, end-card hold, poster legibility, and all export metadata.
- Watch rendered files through contact sheets and targeted frame inspection; do not approve only
  from Remotion Studio.
