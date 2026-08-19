# 15 — Strategic Readiness

Evidence-based conclusions for the next planning session. **This is not a roadmap.** It answers the nine readiness questions and stops.

---

# WHAT PARALITH ACTUALLY IS TODAY

*A new principal engineer should be able to read this section alone and understand the product.*

---

Paralith is a **Windows desktop application built with Tauri 2**, ~139,000 lines of code, currently at version 0.4.14. It ships as a signed MSI/NSIS installer with a working auto-updater. Its Rust crate is still named `forgemind` — the product was renamed and the crate never was.

**Its central object is a Workspace.** A user opens a folder; Paralith records it as a Project (canonicalising the path and detecting whether it is a Git repository). The user then creates a Workspace: a saved arrangement of terminal panes, each of which spawns a real PTY child process — a shell, or a coding-agent CLI (`claude`, `codex`, `opencode`). Workspaces persist, restore their sessions on reopen, can be detached into their own OS window, moved between monitors, and reattached. A lease system guarantees exactly one window can type into a Workspace at a time.

**Paralith contains no LLM API client.** No Anthropic SDK, no OpenAI SDK, no model endpoint, no API key. Every AI capability works by spawning a vendor CLI in a PTY and parsing the JSONL it writes to stdout. This is deliberate and consistently applied: Paralith holds no model credential, inherits each vendor's own sandbox and permission model, and adds a provider by writing an argv-construction adapter. It also means Paralith's agentic reach is bounded by what fits on a command line and what comes back on stdout.

**Beside the terminal canvas sits a docked tool panel** with four singleton surfaces: Files (a Monaco editor with a project explorer, fuzzy Quick Open, and optimistic-concurrency saves), Browser (a native child webview restricted to `http`/`https` and granted no IPC capability, with an Inspect mode that can pipe a page element into the active agent), Diff (working-tree review), and Agents (live per-pane agent activity).

**Six full-screen routes** are reachable from the sidebar:

- **Repository Command Center** — 36 typed Git and GitHub operations, queued, cancellable, timed out, approval-gated and audited, executed over the `git` and `gh` CLIs. Stage individual hunks, commit, amend, branch, stash, rebase, merge, tag, push with `--force-with-lease`, create and merge pull requests with head-matching, rerun workflows, create releases, and lease isolated worktrees for agents. GitHub authentication is entirely `gh`'s — Paralith stores no token.
- **Database Studio** — discovers databases in the project (compose files, connection config, SQLite files, ORM usage), introspects them, parses Prisma and Drizzle schemas, renders an ER canvas via a layout web-worker, reports declared-vs-observed drift, and — through an approve-first design workflow — **writes repository-native migrations** in whatever style the project already uses. It never executes DDL against a live database and never invents a technology the repository does not already use.
- **Memory** — a project-knowledge system with versioned items, claims, sources, relations, a link graph, timeline, activity feed, conflict review queue, and full-text search. Behind it runs a genuinely well-engineered automation: a file change is debounced into a durable job, a worker computes an impact report, and a **pure policy function with no database, no clock and no model** decides what to mark stale — recording both what it flagged and what it refused to flag, with reasons. All knowledge extraction is deterministic; a model's proposal never earns an automatic write.
- **Swarms** — multi-agent execution. A Swarm has typed roles (Coordinator, Scout, Builder, Debugger, Reviewer, Integrator), a task graph with dependencies, and a background scheduler ticking every 900 ms. Each agent gets its own PTY and its own Git worktree with declared file ownership. Provider output is parsed as structured JSONL, not scraped. A completion gate vetoes success for Integrator, Reviewer and test-named Builder tasks unless a passing test record and verified evidence are persisted. Finished runs produce a structured handoff that feeds the Memory system.
- **Usage** — real Claude and Codex quota, read from the same CLIs that run the agents. When a provider is unavailable or unauthenticated it says so with a typed status; it never invents a percentage.
- **Settings** — 39 persisted preferences, 5 themes, 151 design tokens, UI scale and density.

**Everything above works.** The infrastructure beneath it is stronger than the version number suggests: SQLite with enforced WAL and foreign keys, 34 transactional migrations with pre-migration backup and a recovery mode that can restore from that backup, a metadata repair pass at every boot, single-instance protection registered before any other plugin, and a release pipeline that proves a tag came through `main`, signs with minisign, activates the update manifest atomically, verifies the endpoint real clients poll, and sweeps its own credentials.

**What does not work is the part the product is named for.**

Paralith has three knowledge-retrieval systems. A 1,621-line Context Compiler with ranking, token budgeting, citations and staleness handling — reachable only from a preview panel a human can look at. A semantic embedding index — five commands, zero callers, nothing populates it. A code graph of symbols, imports and references, kept continuously current by the file watcher — eight commands, zero callers, no UI.

The one agents actually receive is a fifty-line SQL query: the eight most recently updated memories, pinned first, no relevance ranking of any kind.

Alongside this sits an Orchestration Kernel that presents fourteen lifecycle states and an "Autopilot" mode. It has six capabilities, invokes no model, and nothing in the codebase moves a session past `idle`.

And 44 of its 147 database tables — an MCP capability fabric, Bases, a knowledge Canvas, Skills, a verification framework, a GitHub App integration — are schema for features that were never built.

**So: Paralith today is a genuinely good multi-project agentic terminal workspace with excellent Git tooling, a real schema-design tool, an honest usage monitor, production-grade release engineering, and a deterministic project-knowledge system whose output does not yet reach the agents it was built for.**

The distance between what has been built and what has been connected is the entire story of this codebase.

---

# The nine readiness questions

## 1. What parts of Paralith are strong foundations?

| Foundation | Why it qualifies |
|---|---|
| **Terminal / PTY engine** | Process lifetime decoupled from React; bounded output with explicit drop accounting; machine-protocol geometry for agents; dedicated exit watchers; lease-gated input; deterministic teardown on three separate exit paths. 17 tests. |
| **Release & update pipeline** | SHA-pinned actions, environment approval gate, tag-provenance proof, minisign signing, atomic manifest activation, post-publish verification of the endpoint clients poll, credential sweep. Client side: pre-migration backup, health confirmation, recovery mode, staged restore. |
| **Multi-window / lease system** | Exclusive interactive leases, two-phase handoff with rollback, off-screen recovery, monitor aliasing, `hydrate_from_disk` best-effort restoration. Correctly refuses to persist leases. |
| **Repository Command Center** | 36 typed operations with queue, timeout, cancellation, approval policy, audit ledger and stderr redaction. Uses `--force-with-lease` and `--match-head-commit` — details that indicate real care. |
| **Persistence machinery** | Enforced WAL, foreign keys on, transactional migrations, pre-migration backup, metadata repair with quarantine, migration repair history. |
| **Knowledge lifecycle automation** | Coalescing durable queue, bounded batches, a pure auditable policy function, worker starting at boot rather than on project open. The best-designed subsystem in the repository. |
| **Filesystem security boundary** | Traversal, NUL, drive-prefix, UNC and symlink-escape all correctly handled, with canonicalisation and component-wise containment. 14 tests. No weakness found. |
| **Engineering discipline** | 0 TODO/FIXME/HACK in 139k LOC; ~6 `.unwrap()` in 89k LOC of production Rust; 0 hardcoded colours in TSX; `clippy -D warnings` + `oxlint --deny-warnings` as CI gates; behavioural test names that read as specification; test doubles `#[cfg(test)]`-gated so simulation cannot ship. |
| **Provider adapters** | Use each vendor's own permission primitives (`--permission-mode`, `--sandbox`, `--allowedTools` whitelists) rather than trusting the agent. |

## 2. What systems need stabilisation before expansion?

| System | What is unstable | Why it blocks expansion |
|---|---|---|
| **Context delivery** | the wrong retriever is connected | every agentic feature built on top inherits bad retrieval |
| **Persistence concurrency** | one global `Mutex<Connection>`, 279 lock sites | more background work makes contention worse, not better |
| **The IPC contract** | 1,285 hand-mirrored type lines, no generation, no test | every new command widens a surface nothing can verify |
| **Schema** | 30% dead, 5,048-line migration file | new migrations are authored against a misleading picture |
| **Evidence storage** | payloads discarded, gate partly title-heuristic | the proof layer cannot get stronger while its content is thrown away |
| **Terminal thread scaling** | 5 threads per session, 2 of them pollers | scales linearly against a product whose thesis is many concurrent agents |

## 3. What systems should be consolidated?

| Consolidate | Into | Rationale |
|---|---|---|
| Orchestration Kernel | Swarm engine (or vice versa) | two control planes for one domain; one works |
| `ensure_swarm_context_pack` | `ContextCompiler` | two retrievers, the weaker one connected |
| Direct `git` calls (7 sites) | `RepositoryService::run_program` | bypass queue, timeout, cancellation and audit |
| Raw memory SQL in `database/swarm.rs` | `MemoryService` | two readers with different semantics |
| `require_project_scope` × 6 | one module | six copies of a security control |
| `usage_*` (9 tables) | delete; `ai_usage_*` is live | naming does not signal liveness |
| `evidence_records` family (5 tables) | delete; `swarm_evidence` is live | dead richer model alongside a live simpler one |

## 4. What systems appear obsolete?

| Obsolete | Confidence |
|---|---|
| MCP capability fabric (5 tables) | HIGH — schema only |
| Bases (2 tables) | HIGH — schema only |
| Knowledge Canvas (3 tables) | HIGH — schema only |
| Skills (2 tables) | HIGH — schema only; only the `.paralith/skills/` *path* is used |
| Missions (2 tables) + `mission_tasks` | HIGH — dead, and actively harmful via the zombie FK |
| Verification framework (3 tables) | HIGH |
| GitHub App / webhooks (3 tables) | HIGH — superseded by the `gh` CLI approach |
| Usage v1 (9 tables) | HIGH |
| Evidence/task v1 (5 tables) | HIGH |
| `firebase.json` | HIGH — superseded by GitHub + SSH mirror |
| `forgemind` crate/thread naming | HIGH — cosmetic |

## 5. Where are the biggest integration opportunities?

Ranked by (value delivered ÷ work required):

| # | Opportunity | Both ends exist? | Est. shape |
|---|---|---|---|
| 1 | **Context Compiler → agent launch** | ✅ both tested | one call site + wiring |
| 2 | **Code graph → editor** (go-to-definition, find references) | ✅ backend done | a UI feature |
| 3 | **Code graph → context ranking** (task-relevant scope) | ✅ both | a ranking input |
| 4 | **Terminal-pane agent → handoff → Memory** | ✅ handoff exists, JSONL already parsed | extend one trigger |
| 5 | **Semantic index → Context Compiler candidates** | ✅ role already specified in code | a candidate source |
| 6 | **Database Studio schema → agent context** | ✅ `agent_ops.rs` exists | one call site |
| 7 | **Cross-system notification aggregation** | ◐ producers exist, no aggregator | a new small subsystem |
| 8 | **Swarm agent terminals → workspace canvas panes** | ✅ both are terminal sessions | composition work |
| 9 | **Memory → editor** (memories relevant to the open file) | ✅ index reads both ways | a UI feature |

Opportunities 1–6 are all *connection*, not construction. That is the defining strategic fact.

## 6. Which areas produce the highest architectural risk?

| Risk | Severity | Why |
|---|---|---|
| Building more agentic features on the current retriever | **Highest** | compounds; every feature inherits it |
| Adding capability to two competing control planes | **High** | doubles cost of everything agentic |
| New schema on top of 30% dead schema | **High** | migration authoring against a false picture |
| More background work against one DB mutex | **High** | contention grows superlinearly with subsystems |
| New Tauri commands with hand-mirrored types | **Medium-High** | widens an unverifiable surface |
| More persistence code in untested `database/*` | **Medium-High** | two real defects already live there |
| More per-session threads | **Medium** | linear against the product's scaling thesis |

## 7. Which areas produce the largest product value today?

| Value | Evidence of realisation |
|---|---|
| **Multi-project, multi-window terminal workspace with durable sessions** | the only thing every user touches; complete and robust |
| **Agent CLIs as first-class panes with detection, resume and usage** | the core daily loop |
| **Repository Command Center** | replaces most GitHub web usage for the covered operations |
| **Swarm execution with worktree isolation and a completion gate** | the most differentiated working capability |
| **Database Studio** | a genuinely uncommon capability, delivered honestly |
| **Update and recovery** | invisible when working; this one works |

## 8. Which missing connections prevent existing features from reaching their potential?

| Missing connection | What it currently prevents |
|---|---|
| Context → agent | the entire "typed evidence over transcript" thesis |
| Code graph → anything | ~2,400 LOC of maintained capability delivering zero value; no editor navigation |
| Semantic → context | the index cannot contribute the candidates it was designed to contribute |
| Pane agent → memory | the highest-frequency user action teaches the system nothing |
| Anything → notifications | a user must be on the right route to learn anything happened |
| Orchestrator → Swarm | the supervisory layer cannot supervise the thing it names |
| DB Studio → agent | schema context built for agents, delivered to none |

## 9. What should NOT be expanded until foundations are repaired?

| Do not expand | Until |
|---|---|
| **Agentic features** (new roles, more swarm capability, autonomous modes) | context delivery is routed through `ContextCompiler` and one control plane is chosen |
| **The Orchestration Kernel's capability registry** | the Kernel-vs-Swarm decision is made |
| **The database schema** | the 44 orphan tables are removed |
| **The Tauri command surface** | type generation exists |
| **Background automation** | the DB connection model is addressed |
| **New persistence modules** | `database/*` has boundary tests |
| **New UI surfaces** | there are enough primitives to build them consistently, and per-route error boundaries exist |
| **New product surfaces generally** | notifications exist, so a new surface is not another silo |

---

# Readiness verdict

**Paralith needs targeted stabilisation and consolidation before major expansion.**

Not because the engineering is weak — by most measures it is unusually strong for a 0.4.x product. Zero debt markers in 139k lines, six `.unwrap()`s in the production backend, behavioural tests that read as specification, a release pipeline with tag-provenance proof and credential sweeping, a filesystem guard with no findable weakness, and a knowledge-lifecycle design whose policy function deliberately has no database, no clock and no model.

The problem is **shape, not quality.** Several subsystems were each built to a high standard in isolation and never joined. Paralith has three knowledge-retrieval systems and the crudest one is connected. It has two agentic control planes and the one that works is not the one the UI advertises. It has 44 tables describing features that do not exist. It has 3,200 lines of continuously-maintained backend capability with no user surface at all.

Expanding on that shape multiplies the integration debt: every new agentic feature inherits bad retrieval, every new command widens an unverifiable IPC contract, every new migration is authored against a schema that lies about the product.

**But the repair is unusually cheap**, because the expensive halves are already built and tested. The top six integration opportunities are all wiring changes between components that exist, have tests, and were designed to fit together. Closing them would convert the single largest block of unused capability in the codebase into the product's primary differentiator — without writing a new subsystem.

The recommended sequence for the planning session to consider — **stated as evidence, not as a plan**:

1. **Decide** the Kernel-vs-Swarm question. Everything agentic depends on it.
2. **Connect** context delivery (P0-1). Highest value per unit of work in the repository.
3. **Clean** the schema (P0-3) and fix the zombie FK (P0-4) before authoring new migrations.
4. **Verify** the IPC contract (P1-5) and the authorisation guards (P1-6) before the command surface grows.
5. **Then** expand.

---

## Confidence statement

| Area | Confidence | Basis |
|---|---|---|
| Feature inventory and reachability | **HIGH** | exhaustive registered-vs-called command diff; event producer/consumer diff; table reference analysis with false-positive rejection |
| Schema analysis | **HIGH** | every `CREATE TABLE` matched against every `.rs` file, comment-only matches rejected |
| Security boundaries | **HIGH** (static) | guard implementations read line-by-line; all 14 spawn sites inspected |
| Context-delivery finding | **HIGH** | traced from `runtime_instruction()` through `ensure_swarm_context_pack` to raw SQL, and from `ContextCompiler` forward to its single UI caller |
| Orchestrator finding | **HIGH** | capability registry counted, command surface enumerated, `record_user_turn` read in full |
| Test coverage counts | **HIGH** | `#[test]` and test-file counts; frontend suite executed (788/788 pass) |
| **Rust suite pass/fail** | **NOT ESTABLISHED** | blocked by a concurrent developer build; see `11-TEST-COVERAGE.md` §2.1 |
| Performance impact | **MEDIUM** | structural analysis only; no profiling performed |
| Runtime behaviours (agent-state accuracy, detached-window lease UX, multi-monitor recovery, orphan PTYs after hard crash) | **LOW–MEDIUM** | not exercised at runtime; explicitly flagged UNKNOWN where relevant |
