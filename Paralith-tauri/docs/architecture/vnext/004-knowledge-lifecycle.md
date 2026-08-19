# ADR 004: Knowledge Fabric lifecycle and provenance

Status: accepted for Generation 0
Date: 2026-08-18

## Context

Memory items, revisions, claims, relations, sources, candidates, conflicts, handoffs, and lifecycle
jobs already form a durable Context Fabric. `AgentHandoff` is generated from Swarm runs and passed
through candidate extraction and review policy. The boundary risk is allowing runtime code or a
provider to write canonical knowledge directly, or treating an activity summary as a fact.

## Decision

Knowledge Fabric owns:

- canonical Memory items, revisions, claims, relations, and sources;
- KnowledgeCandidate creation, deduplication, conflict detection, review, and promotion;
- Handoff persistence and extraction into candidates;
- lifecycle jobs and stale/impact decisions.

`MemoryService` owns canonical Memory persistence. `KnowledgeIntelligence` owns candidate/conflict
policy. `KnowledgeLifecycle` owns queued derived work. `AgentHandoff` is the durable run summary and
provenance bridge; it is not a direct Memory write.

## Canonical owner

The Knowledge Fabric owns canonical knowledge lifecycle. MemoryService owns MemoryItem persistence;
KnowledgeIntelligence owns candidate/conflict decisions; KnowledgeLifecycle owns derived jobs.

## Existing implementation involved

- `models/intelligence.rs::AgentHandoff`, `KnowledgeCandidate`, `KnowledgeConflict`;
- `services/agent_handoff.rs`, `memory_service.rs`, `knowledge_intelligence.rs`,
  `knowledge_lifecycle.rs`, `memory_markdown.rs`;
- `database/memory.rs`, `knowledge_jobs.rs`, and related schema;
- `SwarmService` handoff trigger after a run completes.

## Interfaces

```text
HandoffStore.write(AgentHandoff) -> HandoffId
Knowledge.extract(handoff) -> [KnowledgeCandidate]
Knowledge.review(candidate/conflict, decision) -> Memory revision or rejection
KnowledgeLifecycle.enqueue(project, job) -> JobId
```

The existing functions remain the compatibility interfaces. A provider adapter has no Knowledge
Fabric handle and cannot promote a candidate.

## Invariants

- Every canonical claim has source/provenance, confidence, revision identity, and lifecycle state.
- Handoff fields are derived from observable run artifacts; missing artifacts remain missing.
- Candidate promotion requires the existing policy/review path; model/provider output never earns
  automatic canonical status.
- A derived index or Markdown mirror is rebuildable and never outranks SQLite canonical state.
- Conflicts are surfaced, not silently resolved by retrieval or a provider.
- Lifecycle jobs are durable, bounded, and safe to retry.

## Compatibility constraints

Current Swarm handoff extraction, redaction, candidate review, Memory UI, and Markdown mirror remain
unchanged. Generation 0 does not add pane-agent handoffs or change source semantics.

## Rejected alternatives

- Provider writes Memory directly: loses review and provenance boundaries.
- Treat transcript text as canonical knowledge: not reproducible or source-attributed.
- Make Markdown authoritative: breaks structured claims, revisions, and conflict handling.

## Migration implications

Future terminal-pane handoffs may use the existing `AgentHandoff` path. Context compilation must read
Knowledge Fabric services or a deliberate read adapter, never repeat raw SQL semantics in Swarm.

## Explicitly deferred

Pane-agent handoffs, knowledge schema cleanup, automatic promotion, MCP/Skills/Bases/Canvas, and
semantic indexing policy changes.
