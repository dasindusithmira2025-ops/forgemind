---
id: system.decisions-moc
type: system
name: decisions-moc
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:53:17.734Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - repository:.
related:
tags:
  - paralith
  - system
---
<!-- PARALITH:AUTO:START -->

# Decisions MOC

- [[Fragment match cuts preserve screen position and terminology.]] - Fragment match cuts preserve screen position and terminology.
- [[🔴 swarmevidence.payloadjson is never populated]] - 🔴 `swarm_evidence.payload_json` is never populated
- [[The worker starts at boot, not on Project open, so a job left retrying by a cras]] - The worker starts at boot, not on Project open, so a job left `retrying` by a crash is picked up even if that Project is
- [[PushBranch { forcewithlease } — force-push is expressed as --force-with-lease, n]] - **`PushBranch { force_with_lease }`** — force-push is expressed as `--force-with-lease`, never bare `--force`.
- [[Interrupted operations are detected, not resumed. recoveronstartup() logs a warn]] - **Interrupted operations are detected, not resumed.** `recover_on_startup()` logs a warning; `repository_recovery_checkp
- [[repositorygraph tables are written but never displayed.]] - **`repository_graph_*` tables are written but never displayed.**
- [[DESIGNONLY never reaches the write path.]] - **`DESIGN_ONLY` never reaches the write path.**
- [[A destructive change never reaches it either, unless the caller acknowledged tha]] - **A destructive change never reaches it either, unless the caller acknowledged that exact destructive change set.**
- [[The tool-panel divider mutates a CSS variable and the store only — the layout tr]] - The tool-panel divider mutates a CSS variable and the store only — the layout tree is never rebuilt, so **terminals neve
- [[windows.hydratefromdisk() — -a stale placement must never stop the app from open]] - `windows.hydrate_from_disk()` — "a stale placement must never stop the app from opening"
- [[event emission — a failed emit must not fail the operation]] - event emission — a failed emit must not fail the operation
- [[Product invariants encoded as assertions (-never fabricate-, -never invent usage]] - Product invariants encoded as assertions ("never fabricate", "never invent usage")
- [[18 planned-never-built (MCP fabric ×5, Bases ×2, Canvas ×3, Skills ×2, verificat]] - 18 planned-never-built (MCP fabric ×5, Bases ×2, Canvas ×3, Skills ×2, verification ×3, project contexts ×2, branch merg
- [[9 dead-never-wired (incl. GitHub App + webhooks ×3, repository recovery checkpoi]] - 9 dead/never-wired (incl. GitHub App + webhooks ×3, repository recovery checkpoints ×1)
- [[Usage — real Claude and Codex quota, read from the same CLIs that run the agents]] - **Usage** — real Claude and Codex quota, read from the same CLIs that run the agents. When a provider is unavailable or
- [[Existing AgentHandoff and knowledge candidate policy remain authoritative for cu]] - Existing `AgentHandoff` and knowledge candidate policy remain authoritative for current writes.
- [[Treating the audit documents as authoritative over code- the audit is evidence a]] - Treating the audit documents as authoritative over code: the audit is evidence and a starting map,
- [[Cancellation and cleanup pass through the runtime owner and preserve terminal-pr]] - Cancellation and cleanup pass through the runtime owner and preserve terminal/process semantics.
- [[semantic retrieval contributes candidates only and never silently reranks determ]] - semantic retrieval contributes candidates only and never silently reranks deterministic results;
- [[handoffs contribute bounded prior-work findings and remaining work, not canonica]] - handoffs contribute bounded prior-work findings and remaining work, not canonical rules;
- [[Provider-reported completion is an observation and never sufficient proof by its]] - Provider-reported completion is an observation and never sufficient proof by itself.
- [[Every required criterion resolves to pass, fail, blocked, or unavailable; absenc]] - Every required criterion resolves to pass, fail, blocked, or unavailable; absence is not pass.
- [[A retry never rewrites proof from an earlier attempt.]] - A retry never rewrites proof from an earlier attempt.
- [[Manual acceptance is recorded as a decision and cannot erase the original failed]] - Manual acceptance is recorded as a decision and cannot erase the original failed/unverified result.
- [[canonical Memory items, revisions, claims, relations, and sources;]] - canonical Memory items, revisions, claims, relations, and sources;
- [[Every canonical claim has source-provenance, confidence, revision identity, and]] - Every canonical claim has source/provenance, confidence, revision identity, and lifecycle state.
- [[Candidate promotion requires the existing policy-review path; model-provider out]] - Candidate promotion requires the existing policy/review path; model/provider output never earns
- [[A derived index or Markdown mirror is rebuildable and never outranks SQLite cano]] - A derived index or Markdown mirror is rebuildable and never outranks SQLite canonical state.
- [[Treat transcript text as canonical knowledge- not reproducible or source-attribu]] - Treat transcript text as canonical knowledge: not reproducible or source-attributed.
- [[Make Markdown authoritative- breaks structured claims, revisions, and conflict h]] - Make Markdown authoritative: breaks structured claims, revisions, and conflict handling.
- [[CLI execution remains argv-based, never a shell command string.]] - CLI execution remains argv-based, never a shell command string.
- [[Domain services do not reach around another canonical owner with raw process or]] - Domain services do not reach around another canonical owner with raw process or raw domain SQL.
- [[Let frontend stores become authoritative for backend lifecycle- breaks restart a]] - Let frontend stores become authoritative for backend lifecycle: breaks restart and multi-window
- [[Semantic- configured embeddings add weak candidates; they never replace determin]] - Semantic: configured embeddings add weak candidates; they never replace deterministic sources.
- [[Semantic retrieval requires an already configured-populated index; launch never]] - Semantic retrieval requires an already configured/populated index; launch never performs a bulk
- [[A Project is one canonical local directory. Canonical roots are unique.]] - A Project is one canonical local directory. Canonical roots are unique.
- [[quality — the promotion ladder- working → observed → supported → verified → cano]] - **quality** — the promotion ladder: `working → observed → supported → verified → canonical`,
- [[Path containment. Memory never touches the filesystem except through ProjectPath]] - **Path containment.** Memory never touches the filesystem except through `ProjectPathGuard`,
- [[Invariants- state is derived evidence, never guessed-and-stored as fact; heurist]] - Invariants: state is *derived evidence*, never guessed-and-stored as fact; heuristic states are marked as inferred (AGEN
- [[Completion flow- merge-back assist - create PR - discard worktree (never destruc]] - [ ] Completion flow: merge-back assist / create PR / discard worktree (never destructive without explicit confirm).
- [[F8. macOS + Linux First-Class — planned — required for the revenue goal]] - F8. macOS + Linux First-Class — `planned` — **required for the revenue goal**
- [[Cloud agent execution (-agents keep working when my laptop sleeps-) — the bridge]] - [ ] Cloud agent execution ("agents keep working when my laptop sleeps") — the bridge to usage-priced revenue. Local-firs
- [[One authoritative owner for placement state; exclusive terminal ownership; never]] - One authoritative owner for placement state; exclusive terminal ownership; never two windows owning one interactive reso
- [[Forward-safe migrations, pre-migration backups, never recreate the user DB.]] - Forward-safe migrations, pre-migration backups, never recreate the user DB.
- [[GitHub API authorization is delegated to gh and its secure credential store. PAR]] - GitHub API authorization is delegated to `gh` and its secure credential store. PARALITH never
- [[swarmevents.sequence is monotonic per Swarm. swarms.revision versions authoritat]] - `swarm_events.sequence` is monotonic per Swarm. `swarms.revision` versions authoritative UI
- [[2. Dividers are an alpha wash, never an opaque grey]] - 2. Dividers are an alpha wash, never an opaque grey
- [[github-artifacts-publisher.mjs verifies the canonical manifest anonymously throu]] - `github-artifacts-publisher.mjs` verifies the **canonical** manifest anonymously through
- [[sqlite- expects users, notes; FK notes.userid -- users.id; adapter must record f]] - `sqlite`: expects `users`, `notes`; FK `notes.user_id -> users.id`; adapter must record file URL evidence without persis
- [[multilogicaldb- primary PostgreSQL has Customer, Invoice; events MySQL has strea]] - `multi_logical_db`: primary PostgreSQL has `Customer`, `Invoice`; events MySQL has `streams`, `events`; adapter must not

<!-- PARALITH:AUTO:END -->
