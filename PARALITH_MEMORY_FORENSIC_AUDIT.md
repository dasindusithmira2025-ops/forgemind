# 1. Executive Verdict

Overall verdict: PARTIALLY OPERATIONAL.

Paralith Memory is not UI-only and not mocked. The current implementation has real SQLite persistence, revisions, provenance, lexical/structured search, manual capture, project-scoped UI, a background job queue, deterministic project analysis, path/provenance-based impact analysis, staleness marking, ContextCompiler retrieval/ranking/dedupe/budgeting, and prompt assembly paths that pass compiled context into Claude/Codex CLI arguments for Runs and Swarms.

The intended closed loop is not fully operational. The first unconditional break is that opening a project does not itself start file watching; the Code Surface starts watching when it mounts. The larger product break is that source edits do not semantically update arbitrary stored knowledge. A changed source file can queue an impact job and mark load-bearing Memory stale when that Memory cites the changed path, but it does not rewrite "A" into "B" or infer contradictions from source semantics. Stale memories are discounted and flagged in ContextCompiler, not excluded by default.

# 2. End-to-End Pipeline

Actual implemented flow:

```text
Memory UI (/memory/:projectId)
  -> MemoryWorkspace / MemoryEditor / MemorySearch / MemoryGraph / MemoryContext / MemoryActivity
  -> memoryStore / intelligenceStore
  -> invoke("fabric_memory" | "fabric_intelligence")
  -> fabric_ipc operation allow-list
  -> memory_commands / intelligence_commands
  -> MemoryService / KnowledgeIntelligence / ContextCompiler
  -> SQLite memory_* and knowledge_* tables
  -> Markdown mirror under .paralith/memory for manual Memory saves
```

Manual capture/search/context flow:

```text
MemoryEditor save
  -> memory_save
  -> MemoryService::save
  -> database.save_memory
  -> memory_items + memory_revisions + derived tags/properties/links/chunks/FTS
  -> optional markdown mirror
  -> memory_search / knowledge_search / context_compile can retrieve it
```

Project open flow:

```text
open_project(path)
  -> project upsert
  -> KnowledgeLifecycle::request_project_analysis("project open")
  -> memory_jobs(kind=AnalyzeProject)
  -> worker
  -> project_analyzer deterministic facts/candidates
  -> knowledge_understanding / candidates / timeline / context cache invalidation
```

File-change flow, when a Code Surface watcher is active:

```text
CodeSurface mount
  -> native.watchProjectFiles(projectId)
  -> watch_project_files command
  -> FileWatchService::watch
  -> notify watcher + 150ms debounce
  -> FileWatchService::flush
  -> KnowledgeLifecycle::handle_changed_paths
  -> relevance filter
  -> memory_jobs(kind=AnalyzeImpact, dedup_key=analyze_impact)
  -> worker
  -> MemoryService::impact
  -> database.impact_report(path)
  -> direct Memory hits by stored source file path
  -> staleness_decision
  -> MemoryService::mark_stale
  -> memory_items.stale_reason/stale_at
  -> memory-knowledge-updated event
  -> MemoryWorkspace listener refreshes jobs/list/detail/review/timeline
```

Broken/disconnected edges:

```text
Open Project -X-> FileWatchService
```

Project open queues analysis but does not start file watching. File watching requires a mounted Code Surface subscription.

```text
Source edit -X-> semantic impact analysis -X-> automatic body update/replacement
```

The impact path is provenance/path-based. It marks existing cited memories stale; it does not semantically analyze changed code and update arbitrary Memory content.

Context-to-agent flow:

```text
Run/Swarm task
  -> ContextRequest
  -> ContextCompiler::compile_cached
  -> Memory candidates from focus ids, focus files, lexical search, structured query, standing rules, graph, optional embeddings
  -> ranking/dedupe/token budget
  -> ContextPack / CompiledContextPack
  -> RunExecutor::instruction or swarm_service::runtime_instruction
  -> AgentInvocation.prompt
  -> provider_arguments
  -> Claude/Codex CLI terminal request
```

# 3. Capability Matrix

| Capability | Status | Static Evidence | Runtime Evidence | Notes |
| --- | --- | --- | --- | --- |
| Memory persistence | WORKING | `MemoryService::save`, `database.save_memory`, `memory_items`, `memory_revisions` | `cargo test services::memory_service::tests --lib`: 32 passed | DB is canonical; markdown mirror is secondary. |
| Project isolation | WORKING | project_id on commands/tables/queries | memory_service and context_compiler tests include cross-project isolation | Scope checks are consistent for Memory/search/context. |
| File watcher integration | PARTIALLY WORKING | `FileWatchService`, `watch_project_files`, CodeSurface subscription | `CodeSurface.test.tsx`: 5 passed; lifecycle tests pass changed-path handling | Watcher is conditional on Code Surface mount, not project open. |
| Debounce | WORKING | `DEBOUNCE = 150ms`, pending path coalescing | `a_burst_of_saves_produces_one_job_covering_every_path` passed | Backend coalesces impact jobs. |
| Relevance filtering | WORKING | `is_knowledge_relevant` ignores generated/noisy paths | `irrelevant_changes_never_reach_the_queue` passed | Excludes `.git`, target/dist/build, lockfiles, memory mirror, etc. |
| Job creation | WORKING | `KnowledgeLifecycle::enqueue_impact`, `queue_knowledge_job` | knowledge_lifecycle and knowledge_jobs tests passed | Uses dedup key to merge pending impact jobs. |
| Worker execution | WORKING | lifecycle worker starts in app setup, claim/complete/fail/recover methods | `enqueue_then_claim_moves_the_job_to_running`, lifecycle loop tests passed | Restart recovery requeues interrupted running jobs. |
| Impact analysis | PARTIALLY WORKING | `database.impact_report` direct citations + one-hop relations | memory_service impact tests passed | Path/provenance analysis, not semantic source reasoning. |
| Automatic knowledge update | PARTIALLY WORKING | AnalyzeProject and ProcessCandidates can add facts/candidates/memories | `analysis_learns_what_the_project_is...` passed | Arbitrary source edits do not rewrite existing Memory content. |
| Staleness detection | PARTIALLY WORKING | `staleness_decision` marks direct load-bearing hits | `a_changed_file_marks_the_knowledge_that_cites_it_stale` passed | Not semantic contradiction detection. |
| Stale persistence | WORKING | `memory_items.stale_reason`, `stale_at`; `mark_memories_stale` | `a_staleness_change_invalidates_the_cache` passed | First stale reason is preserved. |
| Memory events | PARTIALLY WORKING | `memory-knowledge-updated` emitted after jobs; UI listener exists | covered by frontend listener tests indirectly; no live Tauri event capture run | Event updates UI, not persistence. Jobs with no changed ids still emit. |
| Activity UI | WORKING | `MemoryActivity` reads `memory_jobs` | frontend Memory tests: 112 passed | Shows real jobs, status, payload/result parsing, cancel. |
| Knowledge UI | WORKING | MemoryWorkspace tabs call backend APIs | frontend Memory tests passed | No production fixture result data found. |
| Search | WORKING | `memory_chunks_fts`, `knowledge_search` | memory_service search tests passed | Lexical/structured. Semantic only if embeddings configured. |
| Provenance | PARTIALLY WORKING | `memory_sources`, `memory_revision_sources`, `memory_claim_sources` | source attach/path containment tests passed | File/path/line/excerpt are persisted; commit/user/task provenance is limited. |
| Decisions | PARTIALLY WORKING | Memory type/state/quality and candidates/conflicts | Memory CRUD/search works | Decisions exist as Memory type; not a separate full decision lifecycle. |
| Relationships/graph | WORKING | `memory_relations`, links/tags/properties, graph API | graph/relation tests passed | Graph is real DB projection, not sample nodes. |
| Manual capture | WORKING | MemoryEditor -> `memory_save` -> MemoryService | MemoryService tests passed | "Remember this" phrasing not present, but add/save Memory exists. |
| ContextRequest integration | WORKING | `context_compile`, RunExecutor, Swarm runtime | 33 ContextCompiler tests passed | UI preview and agent paths both use ContextRequest. |
| Memory ranking | WORKING | weighted reasons, quality, importance, stale discount | `provenance_outranks_word_matching`, stale discount tests passed | Deterministic ranking. |
| Deduplication | WORKING | dedupe by `(source_type, id)` | ContextCompiler tests passed | Reports diagnostics. |
| Token budgeting | WORKING | budget clamp, section packing, rejected entries | budget tests passed | Estimates tokens by content size. |
| CompiledContextPack | WORKING | Swarm persists full pack; Runs attach context_pack_id | context pack persistence test exists; cargo check passed | Standalone Run does not persist full pack in a dedicated Run pack table. |
| Agent injection | PARTIALLY WORKING | prompt assembly includes context sections, passed to provider args | provider argument tests passed; no live provider canary executed | Proven to CLI argument construction, not to live model response. |
| Closed-loop refresh | PARTIALLY WORKING | watcher/job/event/cache invalidation | lifecycle tests passed for stale loop | Full ALPHA -> BETA learn/replace loop is not implemented/proven. |

# 4. Runtime Evidence

Test: Memory persistence, revisions, source safety, impact, search, graph.

Action: `cargo test services::memory_service::tests --lib`

Expected: Memory service behavior passes against real in-memory SQLite/temp project fixtures.

Actual: 32 passed, 0 failed.

Evidence: Passed tests include `editing_appends_a_revision_and_an_identical_save_does_not`, `the_markdown_mirror_is_a_complete_portable_document`, `search_combines_full_text_with_structured_filters`, `one_projects_memory_is_invisible_to_another`, `file_evidence_must_resolve_inside_the_project_root`, `impact_finds_direct_citations_and_their_neighbours`.

Verdict: WORKING for manual persistence/search/provenance basics.

Test: File-change relevance, job insertion, job worker, staleness.

Action: `cargo test services::knowledge_lifecycle --lib`

Expected: Relevant changes enqueue work; irrelevant changes do not; burst changes coalesce; changed cited files mark knowledge stale.

Actual: 19 passed, 0 failed.

Evidence: Passed tests include `a_changed_file_marks_the_knowledge_that_cites_it_stale`, `irrelevant_changes_never_reach_the_queue`, `a_burst_of_saves_produces_one_job_covering_every_path`, `one_projects_change_never_touches_another_projects_knowledge`, `analysis_learns_what_the_project_is_and_queues_what_is_worth_knowing`.

Verdict: WORKING for conditional watched-change staleness and deterministic analysis; not semantic replacement.

Test: Job queue state transitions and retries.

Action: `cargo test database::knowledge_jobs::tests --lib`

Expected: queued -> running -> complete/retrying/failed/cancelled transitions work and are project-scoped.

Actual: 8 passed, 0 failed.

Evidence: Passed tests include `enqueue_then_claim_moves_the_job_to_running`, `completion_records_the_result_and_clears_the_error`, `failure_retries_until_attempts_are_exhausted`, `a_second_enqueue_coalesces_into_the_pending_job`.

Verdict: WORKING.

Test: ContextCompiler retrieval/ranking/budget/stale behavior.

Action: `cargo test services::context_compiler::tests --lib`

Expected: Memory enters context with ranking, provenance reasons, dedupe, budget, stale flags, and project isolation.

Actual: 33 passed, 0 failed.

Evidence: Passed tests include `provenance_outranks_word_matching`, `stale_knowledge_is_carried_but_flagged_and_discounted`, `a_knowledge_change_invalidates_the_cache_precisely`, `one_projects_context_never_contains_another_projects_knowledge`, `semantic_candidates_augment_but_do_not_replace_deterministic_ranking`, `constraints_survive_a_budget_that_cuts_everything_else`.

Verdict: WORKING, with stale Memory still included but marked/discounted.

Test: Provider argument boundary.

Action: `cargo test agents::invocation::tests --lib`

Expected: Claude/Codex arguments carry the prompt in the expected position and preserve provider/session controls.

Actual: 10 passed, 0 failed.

Evidence: Passed tests include `the_claude_prompt_precedes_the_variadic_allowed_tools_option`, `a_read_only_codex_run_uses_the_read_only_sandbox_rooted_at_its_working_directory`, `resuming_a_codex_session_passes_the_provider_session_id_to_the_resume_subcommand`.

Verdict: WORKING for prompt-to-CLI argument construction. No live model execution was run.

Test: Memory frontend surfaces.

Action: `npm test -- --run src/features/memory src/screens/MemoryScreen.test.tsx`

Expected: Memory UI calls real API seams and handles state/actions.

Actual: 12 test files passed, 112 tests passed.

Evidence: Vitest reported `Test Files 12 passed (12), Tests 112 passed (112)`.

Verdict: WORKING for frontend wiring under mocked Tauri invoke seam.

Test: Code Surface watcher subscription.

Action: `npm test -- --run src/features/code-surface/CodeSurface.test.tsx`

Expected: CodeSurface starts/stops watcher and responds to `project-file-changed`.

Actual: 1 test file passed, 5 tests passed.

Evidence: Vitest reported `Test Files 1 passed (1), Tests 5 passed (5)`.

Verdict: PARTIALLY WORKING for watcher reachability; only CodeSurface mounts it.

Test: Frontend typecheck.

Action: `npm run typecheck`

Expected: TypeScript compiles.

Actual: Exit 0.

Evidence: `tsc -b --pretty false` completed successfully.

Verdict: PASS.

Test: Rust library check.

Action: `cargo check --lib`

Expected: Rust library compiles.

Actual: Exit 0.

Evidence: `Finished dev profile`.

Verdict: PASS.

Not executed: live Tauri app UI session, real provider canaries, external Claude/Codex task execution, destructive/corrupt DB testing, production build. Real-provider canaries are ignored in source because they spend quota and require authenticated CLIs.

# 5. UI Reality

Route/component: `/memory/:projectId` -> `MemoryScreen`.

What user sees: project-scoped Memory workspace.

Real data source: `native.getProject` plus MemoryWorkspace stores.

Working actions: route load and project-name lookup.

Dead actions: none found.

Mock/hardcoded values: none in production path.

Missing states: live project switch with real app was not manually exercised.

Route/component: `MemoryWorkspace`.

What user sees: Document, Overview, Search, Graph, Context, Review, Timeline, Activity tabs.

Real data source: `useMemoryStore.load(projectId)` and `useIntelligenceStore.load(projectId)`, with backend calls.

Working actions: loads Memory, intelligence, subscribes to `memory-knowledge-updated`.

Dead actions: none found.

Mock/hardcoded values: tab labels only.

Missing states: no live event capture was run.

Route/component: `MemoryEditor`.

What user sees: create/edit Memory title, type, state, quality, tags, body, pin/archive/save controls.

Real data source: store detail from backend and local draft.

Working actions: save, discard, quality, pin, archive.

Dead actions: none found.

Mock/hardcoded values: placeholders only.

Missing states: external markdown import is not supported.

Route/component: `MemoryInspector`.

What user sees: detail, claims, evidence, relations, provenance/history surfaces.

Real data source: `memory_get`, `memory_connections`, `memory_history`, save claim/source/relation APIs.

Working actions: add claim, attach source, add relation, select related memory.

Dead actions: none found.

Mock/hardcoded values: form placeholders.

Missing states: richer commit/task/user provenance is not populated generally.

Route/component: `MemorySearch`.

What user sees: query/filter UI, semantic status, results.

Real data source: `knowledge_search`.

Working actions: exact/lexical/structured search.

Dead actions: semantic mode only reports active when embeddings provider/index are available; it is not semantic by default.

Mock/hardcoded values: example query hints.

Missing states: no live semantic provider test.

Route/component: `MemoryGraph`.

What user sees: graph nodes/edges with overlay controls.

Real data source: `memory_graph`, `memory_health`.

Working actions: refresh, focus, overlay toggles, select nodes.

Dead actions: none found.

Mock/hardcoded values: none in production path.

Missing states: graph is local/project bounded; no global graph beyond query limit/sample.

Route/component: `MemoryContext`.

What user sees: context preview/debugger with sections, reasons, token cost, rejections, conflicts.

Real data source: `context_compile`.

Working actions: compile preview for a task.

Dead actions: none found.

Mock/hardcoded values: none in production path.

Missing states: preview does not prove live agent execution by itself.

Route/component: `MemoryActivity`.

What user sees: Memory jobs list, status, payload/result, cancel for pending/retrying.

Real data source: `memory_jobs`.

Working actions: refresh and cancel eligible jobs.

Dead actions: cancel returns false for non-pending work by design.

Mock/hardcoded values: none in production path.

Missing states: no live UI auto-refresh event test.

Route/component: `MemoryReview`.

What user sees: candidate queue/conflicts/health.

Real data source: intelligence APIs.

Working actions: accept/reject candidates and resolve conflicts.

Dead actions: none found.

Mock/hardcoded values: none in production path.

Missing states: source semantic conflict generation is not automatic from arbitrary file edits.

Route/component: `MemoryTimeline`.

What user sees: timeline and actor filters.

Real data source: `knowledge_timeline` and actors.

Working actions: filter/refresh.

Dead actions: none found.

Mock/hardcoded values: none in production path.

Missing states: automated activity depends on jobs/events.

# 6. Database Reality

| Table | Classification | Notes |
| --- | --- | --- |
| `memory_settings` | ACTIVE | Settings table exists; limited current surface found. |
| `memory_events` | DEAD SCHEMA | Created and referenced by `memory_sources.event_id`; no production insert/select/update/delete caller found. |
| `memory_items` | ACTIVE | Canonical item metadata, quality, stale state. |
| `memory_revisions` | ACTIVE | Immutable revision history with trigger. |
| `memory_sources` | ACTIVE | Provenance/evidence source table. |
| `memory_revision_sources` | ACTIVE | Revision-source join. |
| `memory_chunks` | ACTIVE | Derived chunks for search. |
| `memory_chunks_fts` | ACTIVE | FTS5 index rebuilt from chunks. |
| `memory_links` | ACTIVE | Derived wiki/prose links. |
| `memory_tags` | ACTIVE | Derived tags. |
| `memory_properties` | ACTIVE | Derived frontmatter/properties. |
| `memory_claims` | ACTIVE | Claim storage. |
| `memory_claim_sources` | ACTIVE | Claim evidence join. |
| `memory_relations` | ACTIVE | Typed relationships/graph. |
| `memory_jobs` | ACTIVE | Queue, status, retry, result/error payloads. |
| `knowledge_project_facts` | ACTIVE | Deterministic project facts. |
| `knowledge_fact_evidence` | ACTIVE | Evidence paths for project facts. |
| `knowledge_understanding` | ACTIVE | Project understanding revisions. |
| `knowledge_entities` | ACTIVE | Extracted project entities. |
| `knowledge_entity_aliases` | ACTIVE | Entity aliases. |
| `knowledge_candidates` | ACTIVE | Review/auto-accept candidate queue. |
| `knowledge_candidate_evidence` | ACTIVE | Candidate evidence. |
| `knowledge_conflicts` | ACTIVE | Conflict detection/resolution records. |
| `knowledge_handoffs` | ACTIVE | Agent handoff knowledge inputs. |
| `knowledge_timeline` | ACTIVE | UI activity/timeline backing. |
| `knowledge_context_cache` | ACTIVE | ContextCompiler cache. |
| `knowledge_embeddings` | PARTIALLY ACTIVE | Used when embeddings provider/index exist; default health can be disabled. |
| `swarm_context_packs` | READ ONLY / LEGACY | Historical v18 pack table; read/query migration compatibility remains. |
| `swarm_compiled_context_packs` | ACTIVE | Current Swarm compiled context persistence. |
| `runs.context_pack_id` | ACTIVE METADATA | Run bindings store context pack id; full pack is not persisted in a dedicated Run pack table. |

Important relation findings:

- Project isolation is present through `project_id` on Memory, sources, jobs, facts, candidates, search, and context queries.
- Stale state is persisted on `memory_items`.
- Provenance is persisted in `memory_sources`, including `source_type`, `uri`, `file_path`, line range, content hash, captured timestamp, excerpt, and sensitivity.
- Confidence/quality/importance exist and affect ranking.
- Timestamps are used for revision, capture, stale, job, timeline, and cache records.
- Deletion/update behavior is mostly append/update, not destructive: archiving hides Memory from search; revisions remain.

# 7. Context Injection Proof

Concrete trace proven to provider argument construction:

```text
Stored Memory
  -> database.search_memories / impact_report / standing_context / query_memory_ids
  -> ContextCompiler::compile_cached(ContextRequest)
  -> ContextPack.sections[].entries[]
  -> CompiledContextPack
  -> RunExecutor::instruction or swarm_service::runtime_instruction
  -> AgentInvocation.prompt
  -> provider_arguments
  -> Claude/Codex CLI args used for terminal launch
```

Evidence:

- `cargo test services::context_compiler::tests --lib`: 33 passed, including Memory ranking, stale flagging, project isolation, cache invalidation, semantic augmentation, and budget tests.
- `cargo test agents::invocation::tests --lib`: 10 passed, including Claude prompt argument ordering and Codex sandbox/session argument behavior.
- Static trace: `RunExecutor::start` compiles context, records `ContextCompiled`, builds `AgentInvocation { prompt: Self::instruction(..., &compiled) }`, converts it with `provider_arguments`, then passes args to `prepare_run_terminal`.
- Static trace: Swarm runtime persists `swarm_compiled_context_packs`, builds `runtime_instruction(..., context)`, and sends that prompt through `provider_arguments`.

AGENT MEMORY INJECTION NOT PROVEN by live model canary. The provider-bound prompt/CLI argument path is implemented and tested in pieces, but I did not execute ignored real-provider canaries because they spend quota and require authenticated Claude/Codex CLIs. I also did not insert a live `FORENSIC_AGENT_CONTEXT_CANARY` into the user's real database.

# 8. Closed-Loop Proof

Strongest safe proof achieved:

```text
Manual Memory persists
  -> Memory search retrieves it
  -> ContextCompiler can retrieve/rank/pack Memory
  -> watched changed path can queue impact job
  -> direct cited load-bearing Memory becomes stale
  -> context cache invalidates
  -> stale Memory is flagged/discounted in future context
```

This partial loop is proven by the passing MemoryService, KnowledgeLifecycle, KnowledgeJobs, and ContextCompiler tests.

The complete intended loop is not proven and is not implemented as described:

```text
ALPHA knowledge
  -> source changes to BETA
  -> Memory semantically learns BETA
  -> ALPHA is replaced/superseded
  -> future agent receives BETA and not ALPHA
```

The system can flag cited ALPHA knowledge stale after a file edit. It does not automatically infer BETA from arbitrary changed source code or remove stale ALPHA from context by default.

# 9. Broken / Missing Connections

P0:

- Project open does not start file watching. The watcher starts from CodeSurface mount via `watchProjectFiles`; Memory automation is conditional on that UI surface being mounted.
- Full closed-loop knowledge replacement is not implemented. Impact jobs mark stale or run deterministic project analysis; they do not semantically update arbitrary Memory from source edits.

P1:

- Staleness is path/provenance-based, not contradiction-based. A Memory item must cite the changed file and be load-bearing quality to be marked stale.
- Stale Memory is still eligible for context, flagged and discounted. It can contaminate agent context if consumers ignore the stale label.
- Live provider-bound Memory canary was not proven; only provider argument boundary is proven.
- `memory_events` is dead schema; activity is job/timeline-backed instead.

P2:

- Search is lexical/structured by default. `knowledge_search` reports semantic availability but does not become semantic unless embeddings are configured and indexed.
- Standalone Run persists a `context_pack_id` but not the full compiled pack in a Run-specific table; Swarm persists full compiled packs.
- Markdown mirror is one-way. External edits to `.paralith/memory/*.md` are not imported.
- Provenance does not consistently include commit, mission/task, user, or agent identity for every Memory entry.

P3:

- Jobs with no `changedItemIds` still emit `memory-knowledge-updated`; UI refresh behavior is mixed.
- Impact analysis labels affected memories by path and one-hop graph relation, not semantic subsystem impact.

# 10. Fake-Completeness Findings

- `memory_events` table exists and `memory_sources.event_id` references it, but no production caller writes or reads Memory events.
- The Memory UI can imply automatic learning activity, but automatic source edits do not rewrite Memory content.
- "Impact analysis" is operational but is provenance/path graph impact, not semantic dependency reasoning.
- Semantic search controls/status exist, but semantic retrieval is not the default search behavior and depends on embeddings provider/index availability.
- Context preview UI can show a ContextPack, but that preview alone is not agent injection.
- Stale detection exists, but only for direct cited load-bearing memories. It does not detect arbitrary contradictory source changes.
- Real-provider Run/Mission canaries exist but are ignored and require external authenticated provider CLIs/quota.
- Legacy `swarm_context_packs` remains as compatibility/read schema while current execution uses `swarm_compiled_context_packs`.

# 11. Final Score

Persistence: 8 / 10

Automation: 5 / 10

Knowledge maintenance: 5 / 10

Staleness: 6 / 10

Search: 7 / 10

Provenance: 6 / 10

UI integration: 8 / 10

Context Fabric: 8 / 10

Agent injection: 6 / 10

Closed-loop behavior: 5 / 10

TOTAL: 64 / 100

# 12. Exact Remaining Work

Must fix:

- Start or explicitly manage file watching as part of the project/session lifecycle, not only CodeSurface mount, if Memory is expected to react after project open.
- Implement or clearly limit automatic source-change knowledge maintenance. Today it is staleness plus deterministic project facts, not semantic Memory update.
- Prevent stale Memory from blindly reaching agents, or make stale handling explicit in the agent instruction contract with stronger exclusion/downranking rules.
- Add an integrated non-quota test that stores a Memory canary, compiles context, builds a Run/Swarm provider invocation, and asserts the canary reaches provider args.

Should fix:

- Either wire `memory_events` or remove/rename it as legacy/dead schema.
- Persist full compiled context packs for standalone Runs or document why only `context_pack_id` is retained.
- Make semantic search status and behavior explicit in UI copy/API diagnostics.
- Expand provenance population for commit, mission/task, actor, and agent-origin captures.

Not implemented yet:

- Semantic contradiction detection from arbitrary source changes.
- Automatic replacement/supersession from ALPHA to BETA source changes.
- Import/sync from edited markdown Memory files.
- Live provider canary that proves selected Memory reaches Claude/Codex without spending normal user quota.

Optional future product work:

- Richer review workflow for stale Memory.
- More precise subsystem impact summaries from code graph/project facts.
- Better observability around event payloads and UI refresh decisions.
