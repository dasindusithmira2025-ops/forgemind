# PARALITH Product Roadmap — Beating Every ADE in the Market

> Living document. Status values: `planned` → `designing` → `building` → `shipped` → `improving`.
> Update this file whenever a feature moves state, gets rescoped, or is rejected (record why).
> Last updated: 2026-07-16 (initial version, derived from full-repo deep dive).

---

## 1. Strategic thesis

Developers are moving from *using one agent* to *managing a fleet of agents*. The scarce
resource is no longer code generation — it is **human attention and review bandwidth**.
The winning Agentic Development Environment (ADE) answers, at all times:

1. **Which agent needs me right now?** (attention)
2. **Can these agents work in parallel without corrupting my repo?** (isolation)
3. **What did each agent actually change, and do I accept it?** (review)
4. **What is the verified record of what happened?** (evidence)

Paralith already owns the hardest technical layer (native PTY runtime, strict tiling,
multi-monitor window authority, durable persistence). No competitor has this base.
The moat is built **on top of** the runtime: agent awareness → attention routing →
isolation → review → evidence → orchestration → teams.

**Defining gap today:** Paralith launches agents but does not understand them. An Agent
Session is only provider metadata attached to a PTY. Closing that gap is Feature F1 and
everything else depends on it.

---

## 2. Competitive landscape and how we beat each one

| Competitor | What they are | Their strength | Their weakness we exploit |
| --- | --- | --- | --- |
| **Cursor** | AI-native VS Code fork (editor-first) | Best-in-class inline editing, tab prediction, huge distribution | Editor-centric: one primary agent in one window. Weak at *fleets* of CLI agents, no multi-monitor terminal orchestration, Electron performance under many sessions. We don't fight the editor war — we own the layer where 5–20 agents run in parallel. |
| **Bridgespace / cloud agent platforms** | Browser/cloud agent workspaces | Zero-install, agents run server-side | No native terminals, no local repo truth, latency, trust/privacy concerns for enterprise code. We are local-first with real PTYs and real git state; cloud becomes our *add-on* (F9), not our dependency. |
| **Warp** | AI terminal | Polished single-terminal UX, blocks/AI command search | Single-surface, login-gated, telemetry concerns, not agent-fleet aware, weak multi-window. Our strict-tiling multi-monitor canvas + per-agent state beats "one smart terminal." |
| **Conductor / Crystal / Vibe Kanban** | Multi-agent Claude orchestrators | Early movers on parallel-agent UX (worktrees, kanban) | Thin runtimes (Electron/web wrappers), macOS-only or web-only, no real PTY ownership, no durable persistence/repair/restore, single-provider lock-in. We match their orchestration ideas on an industrial runtime, provider-agnostic. |
| **VS Code + Copilot (agent mode)** | Incumbent editor + agents | Distribution, ecosystem | Agents live inside one editor window; terminal multiplexing and fleet attention are afterthoughts. Paralith runs *alongside* any editor — we don't ask users to switch editors. |
| **tmux / Zellij / WezTerm** | Terminal multiplexers | Free, scriptable, beloved by experts | Zero agent awareness, no GUI docking, no restore-with-repair, no diff review, no attention routing. We are "the multiplexer that understands agents." |
| **Zed (+ ACP)** | High-performance editor defining Agent Client Protocol | Speed, open protocol momentum | Editor-first again. We *adopt* ACP as a signal source (F1) instead of competing with it. |

**Positioning sentence:** *Paralith is the native command deck for agent fleets — it runs
beside any editor, on any provider, and makes managing ten agents feel like managing one.*

Durable advantages already shipped (defend these, never regress them):

- Rust-owned PTYs with bounded pipelines, ordered replay, process-tree cleanup (`terminal_manager.rs`)
- Strict-tiling docking canvas with geometry engine, snap resolver, no-remount rendering
- Lease-based multi-window/multi-monitor authority with atomic handoff + rollback (`window_registry.rs`)
- Forward-only migrations, pre-migration backup, idempotent repair, quarantine
- Restoration scheduler with budgets and circuit breakers
- Stable/Preview editions, signed updates, Safe Recovery
- Provider-agnostic launch (Claude Code, Codex CLI, OpenCode, any shell/custom command)

---

## 3. Feature program

### Tier 1 — Defining features (build these first, in order)

#### F1. Agent State Engine — `building` — **highest priority; everything depends on it**
Make the runtime *understand* agent activity. Every Terminal Session with a coding-agent
provider gains a live state: `working / needs-input / needs-permission / idle / finished / failed`.

- Signal layers (increasing fidelity, all feeding one state machine):
  - [x] L1 Heuristic PTY analysis: coding-agent output cadence, silence windows, and prompt-pattern detection.
  - [ ] L1 provider coverage for every provider with zero configuration, including plain shells without Agent Session rows.
  - [x] L2 OSC 133 prompt/command boundary parsing for coding-agent terminal output.
  - [ ] L2 Shell integration marks (OSC 133 prompt/command boundaries) for plain shells.
  - [ ] L3 First-class provider hooks: Claude Code hooks (tool-use, permission prompt, stop events); Agent Client Protocol (ACP) where supported; Codex/OpenCode equivalents.
- Architecture anchors: extend `AgentAdapter` trait (`src-tauri/src/agents/adapter.rs`) with a signal parser; state lives on the Agent Session row (new migration); typed state-transition events through the existing event pipeline; renderer subscribes via `TerminalRuntimeStore`.
- Invariants: state is *derived evidence*, never guessed-and-stored as fact; heuristic states are marked as inferred (AGENTS.md §4.6); zero overhead for plain-shell panes.
- Beats: everyone — no shipping ADE has cross-provider fleet state.

#### F2. Attention Router — `building`
Built on F1. Answers "which agent needs me right now" across all windows and monitors.

- [x] Pane visual state: border/badge color per agent state (working pulse, needs-input, finished, failed).
- [x] Per-window attention count and focus-next action ordered by wait time.
- [ ] Visible ordered per-window attention queue: show which agents are waiting, not only the count.
- [ ] Sidebar attention queue: mirror the same ordered queue in the project/sidebar surface.
- [ ] OS notifications + taskbar flash when an agent needs input or finishes (respect focus/do-not-disturb, per-workspace setting).
- [x] Current-window hotkey: jump focus to next pane needing attention.
- [ ] Global hotkey across native windows/monitors.
- [ ] Idle-agent alarm: agent finished N minutes ago and nobody looked (wasted parallelism metric).
- Beats: Cursor/Warp (single-surface), Conductor (no native multi-window focus routing).

#### F3. Git Worktree Isolation per Pane — `building`
One-click "run this agent in its own worktree/branch." Automates our own AGENTS.md §6.2.

- [x] Pane menu launch option: `isolated worktree`.
- [x] Auto-create branch with naming convention.
- [x] Auto-create worktree under managed directory.
- [ ] Setup wizard launch option for isolated worktrees.
- [ ] Pane shows branch name + dirty/ahead-behind status live.
- [ ] Completion flow: merge-back assist / create PR / discard worktree (never destructive without explicit confirm).
- [x] Worktree registry persisted.
- [ ] Worktree registry repair/adoption for orphaned or manually removed worktrees.
- [ ] Guardrail: warn when ≥2 non-isolated agents share one working directory.
- Beats: Conductor/Crystal (their headline feature) — matched on a real runtime, any provider.

#### F4. Diff & Review Surface — `building`
Where the human actually spends time. Owning review = owning the workflow.

- [x] Per-pane "Review" panel: working-tree diff of that pane directory/worktree.
- [x] Per-pane review file tree.
- [x] Unified diff mode.
- [ ] Split diff mode.
- [x] Stage per file.
- [x] Discard tracked and untracked changes per explicit file path.
- [ ] Accept/apply reviewed files beyond staging.
- [ ] Fleet review: all pending changes across every agent in the project, in one queue.
- [ ] Cross-agent conflict pre-detection: two agents touched the same file → surface *before* merge time (unique in market).
- [ ] Not a full editor — optimized for "review five agents' output faster than five `git diff`s". Open-in-editor escape hatch.
- Beats: everything terminal-shaped; neutralizes the editor-ADEs' review advantage.

### Tier 2 — Orchestration & evidence (the moat deepens)

#### F5. Agent Run Records — `planned`
Every agent launch becomes a durable, provenance-backed **Run**: prompt/command, transcript
pointer (rotating logs already exist), state-transition timeline (from F1), resulting diff
snapshot, exit status, duration, cost where available.

- [ ] Run table + migration; runs attach to Agent Session lifecycle automatically.
- [ ] Searchable run history per project ("what did agents do here last week").
- [ ] Evidence discipline: real signals only; inferred vs. verified clearly separated (AGENTS.md §4.6). This is Mission Control reborn *correctly* — derived from runtime truth, not a dashboard beside it.
- Beats: everyone; enterprise procurement loves audit trails (feeds F10).

#### F6. Dispatch, Command Palette & Templates — `planned`
- [ ] Command palette (app currently has none — table stakes): every workspace/pane/agent action, fuzzy search.
- [ ] "Send prompt to pane" / broadcast prompt to selected panes.
- [ ] Saved prompt templates per project; workspace launch templates ("3× Claude on isolated branches + test-watch shell") — the setup wizard's allocation compiler already half-implements this.
- [ ] Keyboard-first pane navigation (directional focus, swap, resize) without mouse.

#### F7. Fleet Dashboard — `planned`
One glance = whole fleet. Sidebar or dedicated surface listing every live agent across all
projects/windows: state, runtime, branch, pending diff size, attention flags. Click → focus
pane (cross-window). Strictly derived from F1/F3/F5 data — no fake metrics (AGENTS.md §5.2).

### Tier 3 — Market expansion

#### F8. macOS + Linux First-Class — `planned` — **required for the revenue goal**
Most paying agent-heavy developers are on macOS. Codebase already avoids blocking this
(AGENTS.md §4.3), but needs: PTY/shell detection ports, window-management parity, CI build
matrix, signing/notarization, platform installers.

#### F9. Remote & Cloud Workspaces — `planned`
- [ ] SSH-backed panes (agent runs on remote box, Paralith is the deck).
- [ ] Devcontainer-backed panes.
- [ ] Cloud agent execution ("agents keep working when my laptop sleeps") — the bridge to usage-priced revenue. Local-first remains the trust story; cloud is additive, never required.

#### F10. Teams & Enterprise — `planned`
- [ ] Shared workspace/prompt templates (org registry).
- [ ] Org-distributed agent policy (ship AGENTS.md/rules to every seat).
- [ ] Run-record audit export, retention policy.
- [ ] SSO, seat management, offline licensing for air-gapped enterprise.

### Tier 4 — Hardening & polish of what exists (parallel track, low risk)

- [ ] **WebGL renderer** (`@xterm/addon-webgl`): currently CPU-rendered; 10+ panes will feel it. — `planned`
- [ ] **Full scrollback persistence** (opt-in) beyond the 64 KiB native tail; scrollback export. — `planned`
- [ ] **Terminal search UI** (search addon is installed but needs a proper find bar + fleet-wide search). — `planned`
- [ ] **Cost/usage awareness**: per-run token/cost readout where providers expose it (folds into F5). — `planned`
- [ ] **Opt-in telemetry**: we currently have zero product signal; can't steer a business blind. Privacy-respecting, off by default, documented. — `planned`
- [ ] **Onboarding + public preview channel + website**: requires a separately approved channel; current release automation is Stable-only (`INTERNAL_RELEASES.md`). — `planned`
- [ ] **Theming + reduced motion + accessibility audit** (AGENTS.md §5.2 checklist). — `planned`
- [ ] **Broadcast input mode** (type into N panes at once, with explicit armed-state UI). — `planned`

---

## 4. Monetization shape

| Tier | Price anchor | Contents |
| --- | --- | --- |
| **Free** | $0 | Everything already built: terminals, strict tiling, multi-monitor, restore. This is the funnel — deliberately generous. |
| **Pro** | ~$20–40/mo | F1 fleet state, F2 attention routing, F4 review surface, F5 run history, F7 dashboard. |
| **Team** | ~$50–70/seat/mo | F10: shared templates, policy distribution, audit, SSO. |
| **Cloud add-on** | usage-priced | F9 remote agent execution. |

Reality anchor: category-defining dev tools land at $100M–$1B ARR (Cursor ~$500M ARR,
Copilot ~$500M/yr, JetBrains ~$500M/yr). That is the honest world-class target;
plan capacity and pricing for 300K–1.5M paying developers.

---

## 5. Build order (current plan)

1. **F1 Agent State Engine** — unlocks everything; start with L1 heuristics + Claude Code hooks (L3).
2. **F2 Attention Router** — immediately demoable, viral ("it pings me when Claude needs me").
3. **F3 Worktree isolation** — the safety story competitors market hardest.
4. **F4 Diff review** — owns the human's time.
5. **F5 Run Records** + **F7 Fleet Dashboard** — the moat.
6. **F8 macOS** — the market.
7. F6 / Tier 4 items interleaved as capacity allows; F9/F10 after product-market fit signals.

---

## 6. Non-negotiables while executing (from AGENTS.md — do not trade away)

- Root-cause fixes only; no placeholder/mock paths in production.
- One authoritative owner for placement state; exclusive terminal ownership; never two windows owning one interactive resource.
- Forward-safe migrations, pre-migration backups, never recreate the user DB.
- Evidence integrity: inferred ≠ verified; no fake metrics or fake activity anywhere in the UI.
- Professional desktop-tool visual language; no generic AI-dashboard aesthetics. The rules are written down in `docs/UI_GENOME.md` and enforced by the `design genome` tests — surfaces stay achromatic, chroma is spent on meaning only.
- Windows stays first-class while F8 lands; no platform regressions.

---

## 7. Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-07-16 | Mission Control / Memory / AI Capacity removed | Dashboards beside the agents, not systems aware of them; rebuilt correctly as F5/F7 on top of F1 runtime truth. |
| 2026-07-27 | UI genome adopted (achromatic surfaces + alpha hairlines + neutral solid controls), derived from a study of stablyai/orca | An agent workbench is mostly someone else's colour — terminal output, syntax, diffs, CI status. Chrome that competes with that turns the window into noise. Documented in `docs/UI_GENOME.md`. |
| 2026-07-16 | Roadmap created; F1 chosen as first build | Agent awareness is the single defining gap; all differentiating features depend on it. |
