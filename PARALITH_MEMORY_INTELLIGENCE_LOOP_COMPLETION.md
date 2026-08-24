# Paralith Memory Intelligence Loop Completion

Date: 2026-08-25
Branch: `feat/run-engine-mission-control`

## 1. Architecture Before

The forensic gap was not missing Memory infrastructure. The repository already had SQLite Memory persistence, revisions, project isolation, manual capture, FTS and structured search, provenance, relations, graph support, `memory_jobs`, retry/recovery, relevance filtering, debounce/coalescing, deterministic project analysis, path/provenance impact analysis, stale marking, `KnowledgeLifecycle`, `MemoryService`, `ContextRequest`, `ContextCompiler`, ranking, deduplication, token budgeting, context cache invalidation, and provider argument construction.

The missing loop was ownership and semantic maintenance:

```text
Project open did not own file watching.
File changes could enqueue impact work only when a UI surface had started watching.
Impact analysis identified affected memories mostly by path/provenance.
Changed source truth could mark knowledge stale, but did not deterministically create a current replacement.
ContextCompiler discounted stale knowledge but could still carry it as normal context.
No canary proved source truth changed future provider-bound agent input.
```

## 2. Architecture After

The loop now runs through existing services:

```text
Project open / active project restore
  -> FileWatchService project-session subscriber
  -> debounced/coalesced ProjectFileChange batch
  -> KnowledgeLifecycle::handle_file_change_batch
  -> AnalyzeImpact memory job
  -> deterministic ChangeUnderstanding
  -> safe knowledge maintenance
  -> revisions / sources / claims / relations / stale metadata
  -> context cache invalidation
  -> ContextCompiler eligibility policy
  -> AgentInvocation provider_arguments for Claude and Codex
```

No second watcher, MemoryService, ContextCompiler, job queue, review queue, database, candidate system, or conflict system was added.

## 3. Watcher Ownership Change

Project sessions now own one project-level watcher subscription through `FileWatchService`:

- `open_project_session` and `set_active_project` call `ensure_project_session_watch`.
- `close_project_session` releases the project-session subscription.
- app startup restores watchers for hydrated open sessions.
- Code Surface can still subscribe as a window listener, but Memory no longer depends on Code Surface mounting.

Code anchors:

- `Paralith-tauri/src-tauri/src/commands/window_commands.rs:39`
- `Paralith-tauri/src-tauri/src/commands/window_commands.rs:51`
- `Paralith-tauri/src-tauri/src/commands/window_commands.rs:67`
- `Paralith-tauri/src-tauri/src/lib.rs:477`
- `Paralith-tauri/src-tauri/src/services/file_watch_service.rs:120`
- `Paralith-tauri/src-tauri/src/services/file_watch_service.rs:141`
- `Paralith-tauri/src-tauri/src/services/file_watch_service.rs:386`
- `Paralith-tauri/src-tauri/src/services/file_watch_service.rs:789`

The watcher still uses the existing native watcher map and subscriber set. Repeated project-open calls add no duplicate native watcher.

## 4. Semantic / Change-Understanding Architecture

`AnalyzeImpactPayload` now preserves the old `paths` field and adds typed `changes`.

Structured change understanding was added in existing Memory models:

- `ChangedPath`
- `ChangeUnderstanding`
- extended `ImpactOutcome` with `understandings`, `superseded`, `learned`, and `needs_review`.

Code anchors:

- `Paralith-tauri/src-tauri/src/models/knowledge.rs:128`
- `Paralith-tauri/src-tauri/src/models/knowledge.rs:142`
- `Paralith-tauri/src-tauri/src/models/knowledge.rs:149`
- `Paralith-tauri/src-tauri/src/models/knowledge.rs:173`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:421`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:611`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:948`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:962`

The deterministic implementation uses:

- changed paths and change kinds from the watcher or commit analysis;
- source provenance already attached to Memory;
- direct source snippets from the changed file;
- literal assignment/value deltas when unambiguous;
- source disappearance and rename detection;
- existing candidates when inference is uncertain.

No repository-wide model prompt or external quota is required.

## 5. Knowledge Transition Policy

The transition policy is conservative:

- unchanged: no Memory write;
- deleted sole evidence: preserve Memory, mark stale for review;
- rename-like delete/create: attach the new source path and keep knowledge current;
- one old literal in current cited Memory and one new literal in changed source: create a new current Memory, mark old Memory superseded/stale, supersede old claims, and add a `supersedes` relation;
- ambiguous or multi-literal change: queue `knowledge_candidates` for review and do not rewrite truth silently.

Code anchors:

- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:614`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:739`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:798`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:881`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:890`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:1097`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:1128`

Historical knowledge is not destroyed. The old Memory remains discoverable with stale/superseded metadata and a relation from the replacement.

## 6. Stale / Superseded Context Policy

`ContextCompiler` now treats stale and superseded state as eligibility, not a numeric ranking tweak.

Default task/agent context:

- current knowledge is eligible normally;
- stale knowledge is rejected from normal project truth;
- superseded/deprecated knowledge is rejected from normal project truth;
- explicit named historical lookup can still include a superseded item;
- rejected items are recorded with reasons such as `stale` or `superseded`.

Code anchors:

- `Paralith-tauri/src-tauri/src/services/context_compiler.rs:369`
- `Paralith-tauri/src-tauri/src/services/context_compiler.rs:395`
- `Paralith-tauri/src-tauri/src/services/context_compiler.rs:400`
- `Paralith-tauri/src-tauri/src/services/context_compiler.rs:411`
- `Paralith-tauri/src-tauri/src/services/context_compiler.rs:1732`
- `Paralith-tauri/src-tauri/src/services/context_compiler.rs:1922`

## 7. Provenance Behavior

New replacement knowledge receives source provenance back to the changed file excerpt. Source dedupe now includes excerpt content in the source content hash, so the same file path and line can cite changed evidence without incorrectly reusing an old source row.

Code anchors:

- `Paralith-tauri/src-tauri/src/database/memory.rs:677`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:798`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2088`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2095`

## 8. Closed-Loop Canary Design

The non-quota canary is:

`services::knowledge_lifecycle::loop_tests::closed_loop_canary_source_truth_change_reaches_provider_bound_prompt`

It uses a disposable project and drives the production path as far as practical without launching Claude or Codex:

1. write `src/app.rs` with `greeting = "ALPHA"`;
2. store current Memory: `The application greeting is ALPHA.`;
3. attach source evidence to `src/app.rs`;
4. compile greeting context and assert `ALPHA` is present;
5. warm the context cache;
6. write `greeting = "BETA"`;
7. dispatch a typed watcher change through `FileWatchService`;
8. drain `KnowledgeLifecycle` jobs deterministically;
9. assert job outcome records understanding, supersession, learned replacement, provenance, relation, and cache invalidation;
10. compile the same context again and assert active truth contains `BETA`, not `ALPHA`;
11. construct real Claude and Codex `AgentInvocation` values and inspect `provider_arguments`;
12. assert provider-bound input contains `BETA`, not `ALPHA`.

Code anchors:

- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:1946`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2036`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2050`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2106`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2115`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2132`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2141`
- `Paralith-tauri/src-tauri/src/services/knowledge_lifecycle.rs:2144`

## 9. Runtime / Test Evidence

Executed and passed:

```text
cargo test services::memory_service::tests --lib
32 passed

cargo test services::knowledge_lifecycle --lib
23 passed

cargo test database::knowledge_jobs::tests --lib
8 passed

cargo test services::context_compiler::tests --lib
33 passed

cargo test agents::invocation::tests --lib
10 passed

cargo test services::file_watch_service::tests --lib
10 passed

npm test -- --run src/features/memory src/screens/MemoryScreen.test.tsx
12 files passed, 112 tests passed

npm test -- --run src/features/code-surface/CodeSurface.test.tsx
1 file passed, 5 tests passed

npm run typecheck
passed

cargo check --lib
passed with no warnings

cargo clippy --lib --tests -- -D warnings
passed

cargo test services::knowledge_lifecycle::loop_tests::closed_loop_canary_source_truth_change_reaches_provider_bound_prompt --lib
1 passed after final formatting and clippy fixes
```

## 10. Mutation-Test Evidence

The closed-loop canary was intentionally broken and restored for these failure modes:

```text
knowledge supersession disabled
canary failed because source change no longer produced the expected completed transition.

context cache invalidation disabled
canary failed because the warmed ALPHA context cache row survived BETA maintenance.

stale exclusion disabled
canary failed because stale ALPHA decoy knowledge contaminated normal greeting context.

new knowledge creation disabled
canary failed because the learned replacement did not contain BETA.
```

Each mutation was restored and the canary passed afterward.

## 11. Intentionally Unsupported Semantic Cases

This pass does not implement a compiler-grade semantic engine for every language.

Current deterministic support is strongest for:

- literal/config value changes;
- file added/removed/modified;
- rename-like delete/create of the same filename;
- source-evidence deletion;
- ambiguous literal changes routed to review;
- project-scoped relevance and isolation;
- rapid change coalescing through the existing job queue;
- stale/superseded context exclusion.

Still intentionally limited:

- deep cross-file architectural inference;
- complex symbol rename tracking across language-specific ASTs;
- dependency semantics beyond existing deterministic project analysis and changed-file classification;
- model-assisted synthesis. The interface is ready for richer analyzers later, but correctness does not require quota.

## 12. Remaining Risks

- Rename detection is intentionally conservative and currently recognizes same-filename delete/create pairs. More advanced rename similarity should be added only with deterministic evidence.
- Literal extraction is deliberately narrow. Broader language parsing should be added behind the same change-understanding path instead of replacing it.
- Ambiguous source changes correctly enter candidate/review instead of auto-promoting truth, so some changes still require human review.

## Final Forensic Trace

```text
PROJECT OPEN
  -> window_commands.rs ensure_project_session_watch

WATCHER
  -> file_watch_service.rs project-session subscriber and native watcher map

SOURCE CHANGE
  -> FileWatchService debounced ProjectFileChange batch

RELEVANCE FILTER
  -> KnowledgeLifecycle relevant change filtering and payload coalescing

JOB
  -> AnalyzeImpact memory job in existing knowledge_jobs queue

CHANGE UNDERSTANDING
  -> ChangeUnderstanding with kind, summaries, affected memory ids, candidate knowledge, confidence, evidence

KNOWLEDGE MAINTENANCE
  -> deterministic literal supersession, stale marking, review candidates

SUPERSESSION / REVIEW
  -> old Memory quality Superseded, stale metadata, new Memory, supersedes relation, or knowledge_candidates for review

PERSISTENCE
  -> MemoryService revisions, claims, sources, relations, timeline

CACHE INVALIDATION
  -> clear_context_cache on truth-changing maintenance and candidate processing

CONTEXT COMPILER
  -> stale/superseded exclusion from normal project truth

RUN / SWARM PROMPT
  -> closed-loop canary composes a real prompt from ContextPack entries

CLAUDE / CODEX PROVIDER ARGUMENTS
  -> AgentInvocation provider_arguments include BETA and exclude ALPHA
```
