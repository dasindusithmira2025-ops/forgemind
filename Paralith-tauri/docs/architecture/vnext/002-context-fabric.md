# ADR 002: Context Fabric and compiled context

Status: implemented through Generation 2
Date: 2026-08-18

## Context

Paralith has durable Memory/Knowledge services, `ContextCompiler`, a derived code graph, and an
optional semantic index. Generation 2 completes the live convergence: Swarm launch constructs a
`ContextRequest`, invokes the shared `ContextCompiler`, persists an attempt-scoped
`CompiledContextPack`, and passes that same artifact to provider prompt assembly. The former
latest-eight recent-memory selector has been removed.

## Decision

Context Fabric owns context selection and compilation. `ContextCompiler` is the canonical compiler;
MemoryService remains the canonical memory reader/writer and KnowledgeLifecycle remains the canonical
derived-job owner.

The compiler accepts `models::context::ContextRequest` and returns `models::context::ContextPack`.
`models::vnext::CompiledContextPack` adds immutable pack, Task, AgentRun, compiler-version and
creation identities and is the artifact persisted and delivered by managed execution.

Candidate sources have fixed roles:

- deterministic Memory/Knowledge retrieval contributes revision-backed candidates;
- deterministic project understanding contributes a bounded set of relevant facts;
- code graph contributes indexed task/file/symbol/import/dependent candidates without reindexing;
- semantic retrieval contributes candidates only and never silently reranks deterministic results;
- handoffs contribute bounded prior-work findings and remaining work, not canonical rules;
- Database Studio contributes bounded graph packs only for database-relevant requests;
- local Repository state and verified direct predecessors contribute bounded structured candidates.

## Canonical owner

`ContextCompiler` owns context selection and compilation. MemoryService and KnowledgeLifecycle own
their respective canonical storage and job boundaries; neither is a second compiler.

## Existing implementation involved

- `models/context.rs` and `services/context_compiler.rs`;
- `services/memory_service.rs`, `knowledge_intelligence.rs`, and `knowledge_lifecycle.rs`;
- `services/code_intelligence.rs`, `code_parser.rs`, `semantic.rs`, and `embeddings.rs`;
- `swarm_compiled_context_packs` immutable attempt-level persistence;
- `swarm_context_packs` remains readable historical compatibility data and has no launch writer.

## Interfaces

```text
ContextCompiler.compile_cached(ContextRequest) -> ContextPack
ContextCompiler.compile(ContextRequest) -> ContextPack
CompiledContextPack = { id, projectId, taskId, agentRunId, compilerVersion, createdAt, pack }
```

The request must carry Project identity, task text, focus files/items, role, branch, and budget.
The compiled result must carry selected entries, rejection reasons, conflicts, token accounting,
cache/semantic diagnostics, and source provenance already represented by `ContextPack`.

## Invariants

- A context pack is immutable after compilation and is scoped to one Project, Task, and AgentRun.
- Missing or stale candidates are reported honestly; they are not converted to zero-value facts.
- Context selection is deterministic for the same knowledge revision, request, and feature flags.
- A cache hit remains attributable to the request and knowledge revision that produced it.
- Semantic candidates cannot override deterministic constraints or hide conflicts.
- no Swarm database helper selects launch context independently of `ContextCompiler`.
- Context compilation cannot mutate Memory, KnowledgeCandidate, or provider state.

## Compatibility constraints

Memory Context preview and managed runtime use the same compiler and candidate/ranking rules. The
preview may request a different budget. Existing `swarm_context_packs` rows remain readable in
Swarm detail for history; schema 36 adds the canonical pack-level record without rewriting them.

## Rejected alternatives

- Keep both retrievers: guarantees relevance drift and makes provenance semantics diverge.
- Semantic-first retrieval: violates the existing deterministic/provenance contract.
- Put context selection in the provider adapter: couples provider behavior to project knowledge.
- Store only rendered prompt text: loses structured diagnostics, citations, and replayability.

## Migration implications

Schema 36 adds immutable pack-level provenance keyed by `agent_run_id`. Cache identity includes the
full request, compiler version and composite Memory/Knowledge/Code/Semantic/Database revision.

## Explicitly deferred

Manual-pane AgentRun convergence, code-graph editor navigation, remote repository refresh,
whole-project semantic indexing on launch, and automatic context mutation.
