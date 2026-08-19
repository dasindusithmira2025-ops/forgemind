# 03 — Feature Maturity Matrix

Every catalogued capability, classified. Columns: **UI** (a user-reachable surface exists) · **BE** (backend implementation exists) · **P** (persists across restart) · **A** (automation — runs without direct user action) · **T** (tests) · **I** (integrates with ≥1 other Paralith subsystem).

Legend: ● yes · ◐ partial · ○ no · — not applicable

---

## Status definitions used

| Status | Meaning |
|---|---|
| **COMPLETE** | Fully wired and reasonably production-capable |
| **FUNCTIONAL-INCOMPLETE** | Core behaviour works; important capability/UX/error handling missing |
| **PARTIAL** | Meaningful pieces exist; not end-to-end |
| **PROTOTYPE** | Experimental; shape is right, substance is thin |
| **UI-ONLY** | Surface exists without real backend execution |
| **BACKEND-ONLY** | Capability exists; user cannot reach it normally |
| **STUB** | Placeholder |
| **LEGACY** | Old system superseded by another |
| **DEAD** | No reachable execution path |
| **BROKEN** | Evidence strongly suggests the intended flow cannot complete |
| **UNKNOWN** | Insufficient evidence |

---

## Project System

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Open project folder | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Working-directory validation | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| Git detection on open | ○ | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Recent projects | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Projects overview | ● | ● | ● | ○ | ◐ | ● | COMPLETE | HIGH |
| Relocate moved project | ● | ● | ● | ○ | ◐ | ● | COMPLETE | HIGH |
| Multi-project sessions | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Project path guard | — | ● | — | — | ● | ● | COMPLETE | HIGH |
| Missing-project handling | ◐ | ● | ● | ○ | ◐ | ● | FUNCTIONAL-INCOMPLETE | MEDIUM |

## Workspace System

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Setup wizard | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Allocation compiler | ● | — | — | ○ | ● | ● | COMPLETE | HIGH |
| Setup draft persistence | ● | ○ | ◐ | ○ | ◐ | ○ | COMPLETE | MEDIUM |
| Preset migration | — | — | ● | ● | ● | ● | COMPLETE | HIGH |
| Layout presets | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Save/load workspace | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Canvas dock/split/drag/resize | ● | — | ● | ○ | ● | ● | COMPLETE | HIGH |
| Canvas layout persistence | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Rename/reorder/duplicate/delete | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Suggested names | ● | ● | — | ○ | ○ | ● | COMPLETE | MEDIUM |
| Recent workspaces | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Reopen on startup | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Fresh terminals | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Startup command | ● | ● | ● | ● | ◐ | ● | COMPLETE | HIGH |

## Multi-Window & Monitor

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Detach workspace | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Attach workspace | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Exclusive interactive lease | ● | ● | ○ | ○ | ● | ● | COMPLETE | HIGH |
| Two-phase handoff + rollback | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Registry hydration at boot | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Detached window restore | — | ● | ● | ● | ◐ | ● | COMPLETE | HIGH |
| Monitor enumeration + alias | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Move to monitor | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Off-screen recovery | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Geometry persistence | — | ● | ● | ● | ◐ | ● | COMPLETE | HIGH |
| Native dark chrome | — | ● | — | ● | ○ | ○ | COMPLETE | HIGH |

## Terminal System

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Create session | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Shell detection | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Custom shell profiles | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Agent CLI detection | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Terminal input (lease-gated) | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| Output streaming (bounded) | ● | ● | ◐ | ● | ● | ● | COMPLETE | HIGH |
| Resize / PTY geometry | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| Machine-protocol mode | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Agent state detection | ● | ● | ● | ● | ◐ | ● | FUNCTIONAL-INCOMPLETE | MEDIUM |
| Provider session identity | — | ● | ● | ● | ◐ | ● | COMPLETE | MEDIUM |
| Exit watcher | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Output logging + retention | ○ | ● | ● | ● | ◐ | ● | COMPLETE | MEDIUM |
| Terminate session/workspace/all | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Session restoration + circuit breaker | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Drop image into terminal | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Pane menu / actions | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |

## Code Surface

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Docked tool panel | ● | ○ | ● | ○ | ● | ● | COMPLETE | HIGH |
| Surface registry (4 kinds) | ● | — | ● | ○ | ● | ● | COMPLETE | HIGH |
| File explorer | ● | ● | ◐ | ○ | ● | ● | COMPLETE | HIGH |
| Monaco editor | ● | — | — | ○ | ◐ | ● | COMPLETE | HIGH |
| Editor tabs + dirty state | ● | ○ | ◐ | ○ | ● | ● | COMPLETE | HIGH |
| Optimistic-concurrency save | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| External-change detection | ● | ● | — | ● | ● | ● | COMPLETE | HIGH |
| File operations (CRUD) | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Quick Open (Ctrl+P) | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| Binary detect + size limits | — | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| Diff surface | ● | ● | ○ | ○ | ◐ | ● | FUNCTIONAL-INCOMPLETE | MEDIUM |
| Agents surface | ● | ● | ○ | ● | ● | ● | COMPLETE | MEDIUM |
| Find/replace across files | ○ | ○ | — | — | ○ | ○ | **not implemented** | HIGH |
| LSP / diagnostics | ○ | ○ | — | — | ○ | ○ | **not implemented** | HIGH |
| Merge-conflict resolution UI | ○ | ○ | — | — | ○ | ○ | **not implemented** | HIGH |

## Embedded Browser

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Child-webview browser | ● | ● | ◐ | ○ | ● | ● | COMPLETE | HIGH |
| Scheme allow-list | — | ● | — | ● | ● | ● | COMPLETE | HIGH |
| Zero-capability isolation | — | ● | — | ● | ○ | ● | COMPLETE | HIGH |
| Navigate/reload/stop | ● | ● | ◐ | ○ | ● | ● | COMPLETE | HIGH |
| Address bar + URL normalisation | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| Bounds/visibility/zoom | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Inspect mode (page → Rust) | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| Send to active agent | ● | ● | — | ○ | ● | ● | COMPLETE | HIGH |
| URL redaction in logs | — | ● | — | ● | ◐ | ● | COMPLETE | HIGH |
| Session store | ● | ○ | ◐ | ○ | ● | ● | COMPLETE | HIGH |
| Tabs / DevTools / downloads / cookies / console / network / screenshot | ○ | ○ | — | — | ○ | ○ | **not implemented** | HIGH |

## Git

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Repository inspection | ● | ● | ◐ | ○ | ● | ● | COMPLETE | HIGH |
| Branch listing | ● | ● | ○ | ○ | ● | ● | COMPLETE | HIGH |
| Diff viewing | ● | ● | ○ | ○ | ● | ● | COMPLETE | HIGH |
| History + commit detail | ● | ● | ○ | ○ | ● | ● | COMPLETE | HIGH |
| 36 typed operations | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Queue + cancel + timeout | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Approval policy | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Agent worktree leases | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Worktree conflict risk | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Per-pane Git review | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Interrupted-op recovery | ○ | ◐ | ● | ● | ◐ | ● | FUNCTIONAL-INCOMPLETE | MEDIUM |
| Stderr redaction | — | ● | — | ● | ● | ● | COMPLETE | HIGH |

## Repository Command Center (GitHub via `gh`)

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Provider status | ● | ● | ○ | ○ | ● | ● | COMPLETE | HIGH |
| Remote projection refresh | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Pull requests (full lifecycle) | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Workflow runs (+rerun/cancel) | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Releases | ◐ | ◐ | ● | ○ | ◐ | ● | FUNCTIONAL-INCOMPLETE | MEDIUM |
| Issues | ● | ◐ | ● | ● | ● | ● | PARTIAL (read-only) | MEDIUM |
| Security alerts | ● | ◐ | ● | ● | ● | ● | PARTIAL (read-only) | MEDIUM |
| Repository intelligence | ● | ● | ● | ◐ | ● | ● | FUNCTIONAL-INCOMPLETE | MEDIUM |
| Merge readiness gate | ● | ● | ○ | ○ | ● | ● | COMPLETE | MEDIUM |
| Operation ledger | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Context rail / stat strip | ● | ● | ○ | ○ | ● | ● | COMPLETE | MEDIUM |
| Webhooks / GitHub App | ○ | ○ | ◐ | ○ | ○ | ○ | DEAD (schema only) | HIGH |
| Repository graph browsing | ○ | ● | ● | ● | ◐ | ◐ | BACKEND-ONLY | MEDIUM |

## Database Studio

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Source discovery | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Relevance classification + evidence | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| SQLite introspection | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| ORM schema extraction (Prisma, Drizzle) | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Schema graph | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| ER canvas + layout worker | ● | — | ● | ○ | ● | ● | COMPLETE | HIGH |
| Layout persistence | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Declared-vs-observed compare | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Migration listing | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Code usage refs | ● | ● | ● | ● | ◐ | ● | COMPLETE | MEDIUM |
| Health / issues / unavailable states | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Design drafts + approval workflow | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Repository-native implementation | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Agent context pack | ◐ | ● | ● | ○ | ◐ | ◐ | BACKEND-ONLY (no agent consumes it) | MEDIUM |

## Memory / Context Fabric

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Items + revisions | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Full-text search | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Claims + sources | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Relations + link graph | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Graph visualisation | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Quality / pin / archive | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Staleness marking | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Impact analysis | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| **Auto change→impact→staleness loop** | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Durable job queue | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Deterministic project analysis | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Candidate → review pipeline | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Conflict detect + resolve | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Timeline + actors | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Agent handoffs → knowledge | ● | ● | ● | ● | ● | ◐ | COMPLETE (Swarm-only) | HIGH |
| Markdown mirror | ○ | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| **Context pack compilation** | ◐ | ● | ○ | ○ | ● | ○ | **BACKEND-ONLY for agents** | HIGH |
| Structured query | ● | ● | ○ | ○ | ● | ● | COMPLETE | MEDIUM |
| Health reports | ● | ● | ● | ● | ● | ● | COMPLETE | MEDIUM |

## Code Graph — entire subsystem

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| `code_index_state` | ○ | ● | ● | ● | ● | ◐ | BACKEND-ONLY | HIGH |
| `code_reindex` | ○ | ● | ● | ● | ● | ◐ | BACKEND-ONLY | HIGH |
| `code_search_symbols` | ○ | ● | ● | — | ● | ○ | BACKEND-ONLY | HIGH |
| `code_file_symbols` | ○ | ● | ● | — | ● | ○ | BACKEND-ONLY | HIGH |
| `code_symbol_detail` | ○ | ● | ● | — | ● | ○ | BACKEND-ONLY | HIGH |
| `code_dependencies` | ○ | ● | ● | — | ● | ○ | BACKEND-ONLY | HIGH |
| `code_impact` | ○ | ● | ● | — | ● | ○ | BACKEND-ONLY | HIGH |
| `code_files` | ○ | ● | ● | — | ● | ○ | BACKEND-ONLY | HIGH |

## Semantic Index — entire subsystem

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| `semantic_status` | ○ | ● | ● | ○ | ◐ | ○ | BACKEND-ONLY | HIGH |
| `semantic_save_settings` | ○ | ● | ● | ○ | ◐ | ○ | BACKEND-ONLY | HIGH |
| `semantic_regenerate` | ○ | ● | ● | ○ | ◐ | ○ | BACKEND-ONLY | HIGH |
| `semantic_clear` | ○ | ● | ● | ○ | ◐ | ○ | BACKEND-ONLY | HIGH |
| `semantic_nearest` | ○ | ● | ● | ○ | ◐ | ○ | BACKEND-ONLY | HIGH |
| `knowledge_semantic_health` (adjacent) | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |

## Swarms

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Creation with roles | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Role pools | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Presets (immutable snapshot) | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Execution defaults + model config | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Runtime readiness gate | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Background scheduler (900 ms) | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Lifecycle start/pause/resume/stop/archive | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Task graph + dependencies | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Real agent execution (PTY) | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Provider JSONL normalisation (Claude/Codex) | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| `SwarmRuntimeKind::Auto` normalisation | — | ○ | — | ● | ○ | ○ | **BROKEN** | MEDIUM |
| Worktree isolation + file ownership | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Evidence records | ● | ● | ● | ● | ● | ● | FUNCTIONAL-INCOMPLETE (`payload_json` always `{}`) | HIGH |
| Test records + retry | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Reviews | ● | ● | ● | ● | ◐ | ● | COMPLETE | MEDIUM |
| Attention / decisions / messages | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Command drafts | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Report export | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Recovery + project-close policy | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Global concurrency ceiling | — | ● | — | ● | ● | ● | COMPLETE | HIGH |
| Per-swarm operation lock | — | ● | — | ● | ● | ● | COMPLETE | HIGH |

## Agent Resume

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Reconcile sessions | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| List/dismiss/remove | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Resume session | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Relocate worktree | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Resume Center overlay | ● | — | ○ | ○ | ● | ● | COMPLETE | HIGH |
| Swarm provider-session resume | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |

## Orchestration Kernel

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Session state machine (14 states) | ● | ● | ● | ○ | ● | ◐ | PARTIAL (3 of 14 reachable) | HIGH |
| Capability registry (6) | ● | ● | ● | ○ | ● | ● | PROTOTYPE | HIGH |
| Risk / approval policy | ● | ● | ● | ○ | ● | ● | COMPLETE (for 6 caps) | HIGH |
| I/O redaction | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Send message | ● | ● | ● | ○ | ◐ | ○ | **STUB** (no model, no work) | HIGH |
| Operating modes (observe/assist/execute/autopilot) | ● | ○ | ○ | ○ | ○ | ○ | **UI-ONLY** | HIGH |
| Interrupted-session listing | ● | ● | ● | ● | ◐ | ● | COMPLETE | MEDIUM |

## Provider Usage

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Claude usage | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Codex usage (app-server protocol) | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Auth detection | ● | ● | ○ | ● | ● | ● | COMPLETE | HIGH |
| Typed unavailable states | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| History + daily rollup | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Status bar | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Usage page | ● | ● | ● | ● | ● | ● | COMPLETE | MEDIUM |
| Cost estimation | ● | ○ | ○ | ○ | ● | ◐ | FUNCTIONAL-INCOMPLETE (hardcoded pricing) | MEDIUM |
| System/GitHub telemetry | ● | ● | ○ | ● | ◐ | ● | PARTIAL (in flight) | MEDIUM |
| Diagnostics | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |

## Updates & Recovery

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Update journal + status | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Check for updates | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Download with progress | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Signature verification (minisign) | — | ● | — | ● | ● | ● | COMPLETE | HIGH |
| Safe-restart assessment | ● | ● | ○ | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Install now / on exit | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Pre-migration DB backup | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Staged backup restore | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Recovery mode | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Safe mode / restart after recovery | ● | ● | ● | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Post-update health confirmation | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Legacy profile migration | — | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Metadata repair + quarantine | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| **Preview channel** | — | ● | ● | ● | ● | ◐ | **PARTIAL — no publish workflow** | HIGH |

## Settings / Theme / Shell / Diagnostics

| Feature | UI | BE | P | A | T | I | Status | Conf |
|---|---|---|---|---|---|---|---|---|
| Settings screen (39 fields) | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| 5 themes / 151 tokens | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| System follow + cross-window sync | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Pre-mount theme paint | ● | — | ● | ● | ○ | ● | COMPLETE | HIGH |
| UI scale + density | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Sidebar preferences | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Sidebar attention routing | ● | ● | ● | ● | ● | ● | COMPLETE | HIGH |
| Collapsed rail | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Terminal appearance | ● | ● | ● | ○ | ● | ● | COMPLETE | HIGH |
| Inactive-workspace policy | ● | ● | ● | ● | ◐ | ● | COMPLETE | MEDIUM |
| Diagnostics panel | ● | ● | ○ | ○ | ● | ● | COMPLETE | HIGH |
| Health check | ● | ● | ○ | ○ | ● | ● | COMPLETE | HIGH |
| Redacted support bundle | ● | ● | ○ | ○ | ◐ | ● | COMPLETE | MEDIUM |
| Rotating file log | — | ● | ● | ● | ○ | ● | COMPLETE | HIGH |
| **Notification centre / toasts / OS notifications** | ○ | ○ | ○ | ○ | ○ | ○ | **not implemented** | HIGH |
| **Global command palette / shortcut registry** | ○ | ○ | ○ | ○ | ○ | ○ | **not implemented** | HIGH |

## Dead / legacy

| Item | Status | Conf |
|---|---|---|
| MCP capability fabric (5 tables) | DEAD | HIGH |
| Bases (2 tables) | DEAD | HIGH |
| Knowledge Canvases (3 tables) | DEAD | HIGH |
| Skills (2 tables) | DEAD | HIGH |
| Missions (2 tables) | DEAD | HIGH |
| `mission_tasks` FK validation in `repository.rs:475` | **BROKEN** | HIGH |
| Verification profiles (3 tables) | DEAD | HIGH |
| Usage v1 (9 tables) | LEGACY | HIGH |
| Evidence v1 / task graph v1 (5 tables) | LEGACY | HIGH |
| GitHub App + webhooks (3 tables) | DEAD | HIGH |
| `repository-intelligence-updated` event | DEAD | HIGH |
| `ChangeOrigin::parse`, `ChangeOrigin::as_str`, `SelfWriteLedger::recently_written` | DEAD (compiler-confirmed) | HIGH |
| Crate name `forgemind` / `forgemind-*` thread names | LEGACY | HIGH |

---

## Roll-up

| Status | Count |
|---|---|
| COMPLETE | 34 systems-level features (≈145 matrix rows) |
| FUNCTIONAL-INCOMPLETE | 22 |
| PARTIAL | 19 |
| PROTOTYPE | 6 |
| UI-ONLY | 3 |
| BACKEND-ONLY | 13 |
| STUB | 2 |
| LEGACY | 4 subsystems |
| DEAD | 11 |
| BROKEN | 1 (`SwarmRuntimeKind::Auto`; plus the `mission_tasks` zombie FK) |
| UNKNOWN | 3 (runtime-only behaviours: agent-state accuracy, WAL/checkpoint behaviour on crash, monitor recovery on real multi-display hardware) |
