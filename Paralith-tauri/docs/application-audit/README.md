# Paralith Application Audit

Forensic reconstruction of Paralith as it exists in the repository, performed **2026-08-15** against branch `feat/usage-telemetry-dashboard`, HEAD `ba26c482178f0e5ecbc5b224a187d7aaf3b7f8f6`, product version `0.4.14`, schema version `34`.

**The implementation is the source of truth.** Every conclusion here was derived from code, config, schema or CI definitions — not from documentation, plans, comments or feature names. Where documentation and implementation disagreed, implementation won. Where a conclusion could not be proven, it is marked `UNKNOWN` or given a `LOW`/`MEDIUM` confidence rating.

**Nothing was implemented, fixed, refactored or deleted.** Application source is untouched; the only files added are in this directory.

---

## Read in this order

| For | Read |
|---|---|
| A 5-minute picture | `00-EXECUTIVE-SUMMARY.md` |
| "What *is* this thing?" | `15-STRATEGIC-READINESS.md` § *What Paralith Actually Is Today* |
| "What decisions do we need to make?" | `14-CRITICAL-FINDINGS.md` then `15-STRATEGIC-READINESS.md` |
| Onboarding a new engineer | `01` → `04` → `05` → `08` → `07` |

## Documents

| # | File | Contents |
|---|---|---|
| 00 | `00-EXECUTIVE-SUMMARY.md` | Highest-level conclusions, maturity roll-up, top risks and opportunities |
| 01 | `01-APPLICATION-MAP.md` | Repository cartography, tech stack with evidence, boot and shutdown architecture |
| 02 | `02-FEATURE-CATALOG.md` | The exhaustive 118-feature inventory — the canonical "what features exist?" |
| 03 | `03-FEATURE-MATURITY-MATRIX.md` | Every capability classified across UI / backend / persistence / automation / tests / integration |
| 04 | `04-UI-SURFACE-MAP.md` | Routes, screens, sidebars, sections, surfaces, dialogs, overlays, shortcuts, theming |
| 05 | `05-DOMAIN-AND-DATA-MODEL.md` | Domain entities, full SQLite analysis, ownership, orphan tables, migration architecture |
| 06 | `06-RUNTIME-AND-AUTOMATION.md` | Threads, watchers, workers, event matrix, polling, child processes, data-flow diagrams |
| 07 | `07-AGENTIC-SYSTEMS.md` | Agents, swarms, evidence, review, **context delivery**, the Orchestration Kernel |
| 08 | `08-DEVELOPER-ENVIRONMENT.md` | Filesystem, editor, terminal, browser, Git, GitHub, Database Studio |
| 09 | `09-INFRASTRUCTURE-AND-UPDATES.md` | CI/CD, editions, release pipeline, updater trust boundary, packaging, CSP |
| 10 | `10-SECURITY-RELIABILITY-PERFORMANCE.md` | Security audit, concurrency, performance, error handling, observability |
| 11 | `11-TEST-COVERAGE.md` | Test architecture, what the tests guarantee, structural gaps, validation run |
| 12 | `12-TECHNICAL-DEBT.md` | Dead, zombie, duplicated, planned-but-unbuilt and legacy systems; the debt ledger |
| 13 | `13-INTEGRATION-MATRIX.md` | How subsystems connect — and the 9 missing links the architecture implies |
| 14 | `14-CRITICAL-FINDINGS.md` | Ranked P0/P1/P2/P3 findings with evidence, consequence and direction |
| 15 | `15-STRATEGIC-READINESS.md` | *What Paralith Actually Is Today* + the nine readiness questions + confidence statement |

## Machine-readable inventories — `data/`

| File | Generated from | Contents |
|---|---|---|
| `tauri-commands.json` | `lib.rs` invoke_handler × `invoke()` sites | 257 commands, module, frontend callers, LIVE/BACKEND-ONLY status |
| `database-tables.json` | `migrations.rs` × SQL-context references | 148 CREATE TABLE statements, 147 persistent, 44 orphans |
| `events.json` | emit sites × `listen()` sites | 23 events, producers, consumers, payloads, scope, 1 dead |
| `routes.json` | `App.tsx` + screens + nav definitions | 11 routes, sections, commands per route, overlays, non-routed shells |
| `background-jobs.json` | thread spawn sites + job model + timers | 3 lifetime threads, 5 per-session threads, 4 job kinds, 10 polling loops |
| `integrations.json` | manifests, spawn sites, HTTP clients | External integrations, credential handling, explicitly-absent list |
| `features.json` | this audit | Representative features with full field detail |

`tauri-commands.json` and `database-tables.json` are **regenerable**; the generator logic is documented in each file's `generated_from` field.

---

## Headline findings

1. **Context delivery is the weakest link.** Three knowledge-retrieval systems exist; the one connected to agents is a `ORDER BY updated_at DESC LIMIT 8` query. The purpose-built 1,621-line Context Compiler reaches only a human preview panel. → `07` §5, `14` P0-1
2. **The Orchestration Kernel cannot orchestrate.** 6 capabilities, no model invocation, 11 of 14 states unreachable, an Autopilot mode no backend reads — while a working Swarm engine occupies the same domain. → `07` §7, `14` P0-2
3. **44 of 147 tables (30%) are dead**, including whole planned subsystems (MCP, Bases, Canvas, Skills, verification). → `05` §4, `14` P0-3
4. **`mission_tasks` is a zombie FK** that silently nulls the task provenance on every repository audit event. → `05` §4, `14` P0-4
5. **~3,200 LOC of actively-maintained backend capability has no user surface** — the entire code graph and semantic index. → `12` §1, `14` P1-1

## What the audit found that is genuinely strong

The terminal/PTY engine, the release and update pipeline, the multi-window lease system, the Repository Command Center, the filesystem security boundary, the knowledge-lifecycle automation — and an engineering discipline that produced **zero** `TODO`/`FIXME`/`HACK` markers, ~6 `.unwrap()` calls in 89k lines of production Rust, and zero hardcoded colours in TSX.

**The debt in this repository is things built and not connected, or designed and not built. It is not rot.**
