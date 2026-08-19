# Generation 2 result: Context Fabric convergence

Date: 2026-08-18
Status: implemented; validation recorded below

## Precondition state

Generation 0 contracts and Generation 1 task provenance, deterministic runtime resolution,
bounded structured evidence, VerificationPolicy, and authorization boundaries remain in place.
Schema at mission start was 35.

## Old runtime path

`ProductionAgentRuntime::advance` called `DatabaseService::ensure_swarm_context_pack`, whose entire
relevance policy was pinned/updated ordering with a limit of eight. Provider adapters received that
memory-only projection directly.

## New runtime path

The scheduler claims a Task and creates its durable `swarm_agent_runs` attempt. At provider launch,
`ProductionAgentRuntime::advance` builds an attempt-scoped `ContextRequest`, calls the application
`ContextCompiler`, validates and persists `CompiledContextPack`, and passes the same artifact to
Claude/Codex runtime-instruction construction.

```text
Swarm Task + AgentRun
  -> ContextRequest
  -> ContextCompiler candidate providers
  -> deterministic dedupe/ranking/token packing
  -> CompiledContextPack
  -> swarm_compiled_context_packs
  -> runtime_instruction
  -> provider launch
```

## ContextRequest

Managed requests carry Project, Swarm mission, Task, Agent, AgentRun, provider/model/effort,
working directory/worktree, declared files, VerificationPolicy/acceptance requirements, operator
instructions, verified predecessor results, bounded local repository state, semantic preference,
and requested context strategy. Preview requests use the same type and compiler.

## Candidate providers and ranking

- Memory/Knowledge: lexical, explicit, file provenance, standing/pinned rules, structured filters,
  typed relations, confidence, quality and staleness.
- Project facts: bounded deterministic understanding facts, with core build/test facts and
  task-relevant dimensions.
- Code Graph: indexed symbols, imports and dependents for direct file scope plus bounded symbol-name
  matches from task terms. Compilation never starts an index rebuild.
- Semantic: configured embeddings add weak candidates; they never replace deterministic sources.
  Diagnostics distinguish not requested, unavailable, failed, available with no matches, and actual
  candidate contribution; none of the fallback states fail compilation.
- Database Studio: bounded database graph packs only when task text/file scope indicates schema,
  migration, ORM, query, persistence or related work.
- Repository: one bounded local worktree snapshot; no remote refresh or mutation.
- Predecessors: verified direct dependencies only, with grounded summaries, changed files, commit
  identity when recorded, and evidence ids.

Final ordering is deterministic by protected section, score and stable candidate identity. Task
contract and constraints are packed before code, predecessors, database, repository and background
knowledge. Semantic similarity is deliberately weaker than direct provenance. Recency is not a
standalone selection algorithm.

## Token budgeting and performance safeguards

Budgets retain the named 3k/6k/12k/24k profiles and bounded explicit 500..60k range. Bodies,
project facts, symbols, graph relations, schema objects, changed paths and predecessor fields are
all bounded before packing. A candidate that does not fit becomes a budget rejection. Compilation
uses existing incremental Code Graph/semantic/Database Studio state, performs no repository walk,
embedding rebuild, remote GitHub refresh or transcript load, and does not hold the database lock
around filesystem/network work.

The cache key includes the full serialized request, compiler version, and a composite revision that
now covers Memory, claims, relations, sources, understanding, handoffs, Code Graph files, embeddings,
and owned Database Studio sources. Managed attempts also carry unique Task/AgentRun and local
repository identities.

## Compiled artifact and provenance

Every entry records source type/id, exact Memory revision or source fingerprint where available,
confidence, staleness, source URIs, selection reasons, score, token estimate and truncation. The pack
records compiler version, budget/usage, semantic status, provider candidate counts, dedupe/stale/
truncation counts, provider fallbacks and compile duration. Persistence rejects packs over 512 KiB.

Schema 36 adds `swarm_compiled_context_packs`, unique by AgentRun. Existing v18
`swarm_context_packs` rows are preserved for historical reads and receive no new launch writes.

## Runtime prompt integration

Provider safety arguments are unchanged. Runtime instructions keep the task/mission/working
contract and explicit operator instructions, then render the compiled sections and bounded recent
handoffs. Internal JSON is not dumped into the prompt. Source/stale labels remain visible.

## Tests

Targeted tests cover task relevance, pinned/canonical constraints, different request cache identity,
staleness, Code Graph candidates, semantic augmentation and unavailable fallback, selective Database
Studio context, token bounds, exact persisted provenance, provider consumption, verified predecessor
and repository candidates, project facts, and a regression fixture with twelve newer irrelevant
memories proving latest-eight recency is not the selector.

## Validation

- ContextCompiler suite: PASS (33 tests after Generation 2 additions).
- Schema migration suite: PASS (25 tests, including v35 to v36 preservation).
- Swarm provider consumption and compiled-context persistence round trip: PASS (2 targeted tests).
- TypeScript typecheck: PASS.
- Frontend tests: PASS (90 files, 788 tests).
- Frontend lint and production build: PASS (the build retains its existing chunk-size advisory).
- Rust formatting: PASS.
- Rust clippy with warnings denied: PRE-EXISTING FAILURE in CodeLanguage, filesystem, embeddings,
  code-parser and usage-telemetry code; no diagnostic names a Generation 2 changed path.
- Full all-target/all-feature Rust tests: ENVIRONMENT BLOCKER; compilation exceeded ten minutes.
  All targeted Generation 2 suites completed successfully.
- Release/schema metadata and `git diff --check`: PASS.

## Known limitations and deferred work

- Code Graph candidates reflect deterministic parser/index confidence, not LSP precision.
- Semantic retrieval requires an already configured/populated index; launch never performs a bulk
  embedding pass.
- Repository context is local only and best-effort for non-Git Projects.
- Existing historical v18 rows remain visible in legacy Swarm detail; migration/cleanup is deferred.
- Manual-pane AgentRun convergence is Generation 3 and was not started.

## Repository safety

The checkout was already dirty. Unrelated user files were preserved. No reset, stash, commit, push,
PR, remote mutation, release or unrelated process termination was performed.
