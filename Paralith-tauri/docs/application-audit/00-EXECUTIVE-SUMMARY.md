# Paralith — Executive Summary

**Audit date:** 2026-08-15
**Repository:** `Corelith-Official-Project-Repo`
**Branch inspected:** `feat/usage-telemetry-dashboard`
**HEAD commit:** `ba26c482178f0e5ecbc5b224a187d7aaf3b7f8f6` (`feat(usage): ship analytics workspace surfaces`, 2026-08-13)
**Product version:** `0.4.14` (npm `paralith`, crate `forgemind` — crate name is a legacy identifier)
**Working tree at audit start:** dirty (34 modified, ~40 untracked application files — a large in-flight "Context Fabric" feature branch). Recorded in full in §Repository safety of `14-CRITICAL-FINDINGS.md`.

---

## What Paralith is today

Paralith is a **Windows-first Tauri 2 desktop application** that provides a multi-project, multi-window development workspace built around **real PTY terminals** and **CLI-based coding agents** (Claude Code, Codex CLI, OpenCode). Around that core it layers a Monaco editor, an embedded Chromium browser, a Git/GitHub command centre driven by the `git` and `gh` CLIs, a schema-design tool ("Database Studio"), a deterministic project-knowledge system ("Context Fabric" / Memory), and a signed auto-update pipeline.

It is **not** a chat application and contains **no direct LLM API integration**. Every AI capability is delivered by launching a vendor CLI inside a PTY and parsing its structured JSONL output.

Full narrative: **`12-TECHNICAL-DEBT.md` §What Paralith Actually Is Today` is superseded by `15-STRATEGIC-READINESS.md`; the canonical prose description lives in `01-APPLICATION-MAP.md` §1.**

---

## Architecture summary

| Layer | Technology | Size |
|---|---|---|
| Shell | Tauri 2.11.3 (`unstable` feature for multi-webview) | — |
| Frontend | React 19.2 + TypeScript 6.0, Vite 8, Zustand 5, react-router-dom 7 (HashRouter) | 311 files / 49,905 LOC |
| Backend | Rust 2021 (MSRV 1.77.2), rusqlite (bundled SQLite), portable-pty, tokio, parking_lot | 128 files / 89,267 LOC |
| Editor | Monaco 0.54 | — |
| Terminal | xterm.js 6 ↔ portable-pty 0.9 (ConPTY on Windows) | — |
| Persistence | One SQLite file, schema version **34**, 147 tables | — |
| IPC | 257 Tauri commands, 23 events | — |
| Distribution | MSI + NSIS, minisign-signed Tauri updater, GitHub Actions | — |

The backend carries **1.8× the code of the frontend**. This ratio is the single most important structural fact in the audit: a large amount of backend capability has no user-reachable surface.

---

## Major systems (17)

Projects · Workspaces & Canvas · Multi-window/Monitor · Terminals · Agent detection & resume · Swarms (multi-agent) · Orchestration Kernel · Code Surface (files/editor/diff/agents) · Embedded Browser · Git · Repository Command Center (GitHub) · Database Studio · Memory / Context Fabric · Code Graph · Semantic index · Provider Usage · Update & Recovery.

---

## Maturity overview

Of **118 catalogued features** (see `02-FEATURE-CATALOG.md`):

| Status | Count |
|---|---|
| COMPLETE | 34 |
| FUNCTIONAL-INCOMPLETE | 22 |
| PARTIAL | 19 |
| PROTOTYPE | 6 |
| UI-ONLY | 3 |
| BACKEND-ONLY | 13 |
| STUB | 2 |
| LEGACY | 4 |
| DEAD | 11 |
| BROKEN | 1 |
| UNKNOWN | 3 |

---

## Strongest foundations

1. **Terminal / PTY engine** (`services/terminal_manager.rs`) — process lifetime decoupled from React, bounded output queues, machine-protocol mode for agents, exit watchers, deterministic teardown, lease-gated input. Genuinely production-grade.
2. **Release & update pipeline** (`.github/workflows/release-stable.yml`, `services/update_service.rs`) — SHA-pinned actions, environment approval gate, tag-provenance proof, minisign signing, atomic manifest activation, post-update health confirmation with database backup/restore and recovery mode. Unusually mature for a 0.4.x product.
3. **Repository Command Center** (`services/repository_service.rs`, 4,436 LOC) — 36 typed, queued, cancellable, audited Git/GitHub operations over `git` + `gh` CLIs with approval policy and stderr redaction.
4. **Multi-window / workspace lease system** (`services/window_registry.rs`) — exclusive interactive leases, two-phase handoff with rollback, off-screen monitor recovery, monitor aliasing.
5. **Engineering discipline** — 0 `TODO`/`FIXME`/`HACK` in 139k LOC; 0 hardcoded hex colours in TSX; 788 frontend tests green, 576 Rust tests present and gated in CI; every module carries a design-rationale header comment.

---

## Largest problems

1. **The knowledge that agents actually receive is the crudest of three retrieval systems.** The 1,621-line `ContextCompiler`, the semantic embedding index, and the code graph are *all* bypassed at agent-launch time. Swarm agents get `SELECT … ORDER BY pinned DESC, updated_at DESC LIMIT 8` (`database/swarm.rs:326`). See `07-AGENTIC-SYSTEMS.md` §5.
2. **The Orchestration Kernel cannot orchestrate.** It has 6 capabilities (5 read, 1 write), no model invocation, and no code path that moves a session out of `idle`. Its UI advertises `planning`, `executing`, `verifying`, `autopilot` — all unreachable. See `07-AGENTIC-SYSTEMS.md` §7.
3. **44 of 147 database tables (30%) are never read or written by any code.** Whole planned subsystems (MCP fabric, Bases, Canvases, Skills, Missions, verification profiles, usage alerting) exist as schema only. See `05-DOMAIN-AND-DATA-MODEL.md` §4.
4. **13 registered Tauri commands have zero frontend callers** — the entire `code_*` (8) and `semantic_*` (5) families. ~2,900 LOC of backend capability is unreachable by users. See `03-FEATURE-MATURITY-MATRIX.md`.
5. **No notification centre, no toast system, no command palette, no global shortcut registry.** Cross-cutting user feedback is delivered ad hoc per surface.

---

## Top risks

| # | Risk | Severity |
|---|---|---|
| 1 | Context delivery is the product's differentiator and is currently its weakest link | P0 |
| 2 | Schema carries 30% dead weight, and `migrations.rs` is a 5,048-line single file | P0 |
| 3 | `swarm_service.rs` at 6,764 LOC with no `mod tests` in `database/swarm.rs` (2,538 LOC) | P0 |
| 4 | 5 OS threads per terminal session; linear scaling to many panes | P1 |
| 5 | Evidence content is discarded — `swarm_evidence.payload_json` is hardcoded to `'{}'` on insert, so a completion gate can check that evidence exists but never what it says | P1 |

---

## Top opportunities

1. **Wire `ContextCompiler` + code graph + semantic index into agent launch.** All three exist and are tested. The connection is a single call-site change in `swarm_service.rs`, not new architecture.
2. **Surface the code graph.** 8 commands, a parser, and 4 tables already work; there is no UI. This is the cheapest large feature in the repository.
3. **Extend the handoff→knowledge loop to non-Swarm terminal agents.** The loop is proven end-to-end for Swarms only.
4. **Collapse the Orchestration Kernel into the Swarm engine** or delete it — two control planes compete for the same domain.
5. **Delete the 44 orphan tables and the 4 legacy subsystems** to make the schema legible before the next expansion.

---

## Validation performed

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **PASS** (exit 0) |
| Frontend tests | `npm test -- --run` | **PASS** — 90 files, 788 tests |
| Rust tests | `cargo test --all-targets --all-features` | **NOT COMPLETED** — blocked by a concurrent developer build holding the toolchain (`LNK1104` at link). Not a repository defect; see `11-TEST-COVERAGE.md` §2.1 |
| Lint / build / clippy | not run this session | NOT RUN |

---

## Repository safety

- Application source modified: **NO**
- Commit created: **NO**
- Pushed: **NO**
- Files added: only under `Paralith-tauri/docs/application-audit/`

---

## Final assessment

**Paralith needs targeted stabilisation and consolidation before major expansion — but the foundations are sound and the required work is connective, not reconstructive.**

The infrastructure layer (terminals, windows, Git, releases, persistence machinery, testing discipline) is genuinely strong and would support a much larger product. The problem is not quality; it is that several subsystems were each built to a high standard *in isolation* and never joined. Paralith today has three knowledge systems that do not feed each other, two agent control planes that do not know about each other, and roughly a third of its schema representing designs that were never implemented.

Expanding on top of that without first connecting it would multiply the integration debt. Connecting it is comparatively cheap, because both ends of every missing link already exist and are tested.

See `15-STRATEGIC-READINESS.md` for the evidence-based readiness assessment.
