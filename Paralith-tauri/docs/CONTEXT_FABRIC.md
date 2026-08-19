# PARALITH Context Fabric

The Context Fabric is the subsystem that answers, for one Project:

| Question | Surface |
| --- | --- |
| What does this project know? | Memory |
| How is it all related? | Graph |
| Why should we believe it? | Evidence |
| What was true at commit X? | History |
| What does this agent need right now? | Context |
| How should this agent operate? | Skills |
| What capabilities can an agent use? | MCP |

Those are seven different questions and they get seven different models. The failure mode this
document exists to prevent is collapsing them into one prompt blob: a system where "memory" is a
transcript archive, "context" is a vector search over it, and "evidence" is whatever the model
said last.

---

## The six concepts, kept apart

```
MCP       what an agent CAN DO
Skill     how and when it SHOULD DO IT
Memory    what the project KNOWS
Task      what an agent MUST DO
Evidence  how Paralith KNOWS something is true
Context   the minimum relevant subset needed RIGHT NOW
```

A Skill is not a prompt. A Memory is not a transcript. Context is not the whole knowledge base.
Evidence is not a claim about evidence.

---

## Storage: four layers, one of them canonical

**1. Runtime database (canonical).** SQLite owns memories, immutable revisions, claims, relations,
provenance, links, properties, and tags. Every multi-row write is one transaction. Foreign keys are
on. Revisions are immutable at the database level — a trigger aborts any update that would rewrite
a body, title, or content hash — which is what makes history and provenance trustworthy rather
than merely conventional.

**2. Portable knowledge (mirror).** Every saved memory is also written as a complete Markdown
document with frontmatter to `.paralith/memory/<slug>.md` inside the Project, through
`ProjectPathGuard`. This is not an export stub: it carries the title, type, quality, tags, and
properties, so the knowledge is git-diffable, reviewable in a pull request, and recoverable
without Paralith.

The mirror is one-directional today. Editing those files outside Paralith does not flow back. That
is a deliberate staging decision, not an oversight: making files canonical would mean rebuilding
the immutability guarantee on top of a directory anyone can edit, plus a two-way reconciliation
engine, before the first memory could be saved. The upgrade path is an import pass that reads the
directory and replays changed files through `save_memory` — the file already carries every field
that would need.

**3. Derived indexes (always rebuildable).** `memory_chunks` and `memory_chunks_fts` are rebuilt
from the current revision on every write. Later: embeddings, graph caches, code indexes. Nothing
canonical is ever stored in a derived index, so any of them can be dropped and regenerated.

**4. Ephemeral (not persisted).** Terminal transcripts, assistant responses, reasoning, transient
retrieval results. Durable knowledge is *extracted* from these; the raw stream is not memory.

### The rule that governs all four

```
Agent transcript  →  durable findings extracted  →  structured memory
```

never

```
Agent transcript  =  memory
```

---

## Data model

### Memory

A memory is a typed entity, not a blob. Beyond the v8 core (`memory_items`, `memory_revisions`,
`memory_sources`, `memory_chunks`) it carries:

- **quality** — the promotion ladder: `working → observed → supported → verified → canonical`,
  with `deprecated` and `superseded` as retirement states. Quality rises as evidence accumulates.
  A memory is never silently deleted; archiving drops it from the search index and keeps every
  canonical row.
- **importance**, **verified_at**, **stale_reason** — knowledge health, distinct from existence.
- **tags** and **properties** — frontmatter as queryable rows, so a Base view can filter on them
  rather than parsing a blob.

### Claim

A memory decomposes into individually verifiable statements. Each claim has its own status,
confidence, temporal validity (`valid_from` / `valid_until`), supersession pointer, and evidence.

This is what lets one fact go stale or be contradicted without invalidating the document that
contains it — the single most important structural decision in the model.

Attaching evidence moves an `open` claim to `supported`. It does **not** move it to `verified`.
Verification is a deliberate act, not a side effect of citing a file.

### Link vs Relation

Two different things that are easy to conflate:

- A **link** (`memory_links`) is a `[[wikilink]]` an author typed. It may point at nothing.
- A **relation** (`memory_relations`) is a typed assertion the system holds — `supersedes`,
  `contradicts`, `implements`, `depends_on` — carrying its own confidence and provenance.

Links store the *slug they point at*, never a resolved item id. Backlinks are a join against
`memory_items.dedup_key` at query time. This removes every re-resolution path: creating, renaming,
or deleting a target cannot leave a stale edge, and a link to a memory that does not exist yet is
an ordinary unresolved row rather than a broken foreign key.

### Provenance

`memory_sources` is the single evidence table, shared by memories and claims. A `file` source is
validated through `ProjectPathGuard` before any row is written, so a stored file reference can
only ever name something inside the Project. `uri` is the dedup identity: attaching the same range
twice reuses the row instead of accumulating duplicate evidence.

---

## Graph domains

Not one undifferentiated graph. Logical domains linked by typed edges and provenance:

```
Knowledge Graph   memories, claims, relations        (implemented, with UI)
Evidence Graph    sources, files, commits             (implemented as a graph overlay)
Code Graph        files, symbols, references          (not started; only file-level evidence today)
Task Graph        missions, tasks, dependencies       (exists: Mission Control; not yet linked)
Agent/Run Graph   agent runs, handoffs                (exists: Swarm; not yet linked)
Database Graph    schema objects, relations           (exists: Database Studio; not yet linked)
Git DAG                                               (exists: Repository)
```

The Knowledge and Evidence graphs are **projections, not stored graphs**. `knowledge_graph()`
derives nodes and edges on read from `memory_items`, `memory_relations`, `memory_links`,
`memory_sources`, and `memory_tags`. There is no graph table, so there is nothing to rebuild after
a restore and no way for the picture to disagree with the Memory surface it is drawn from.

Edge families stay distinct because they mean different things:

| Edge | Means | Source |
| --- | --- | --- |
| `relation` | a typed assertion the system holds | `memory_relations` |
| `link` | a `[[wikilink]]` an author typed that currently resolves | `memory_links` |
| `evidence` | a memory rests on a file or commit | `memory_sources` |
| `tag` | shared vocabulary — the weakest signal, off by default | `memory_tags` |

An **unresolved** wikilink is not an edge: it has no second endpoint. It stays visible in the
inspector and is counted by `brokenLinks` in knowledge health, rather than being drawn as a
phantom node.

### Impact analysis

`memory_impact(projectId, filePath)` answers "what does changing this put in question". Direct
hits are memories whose provenance cites the path (exact or directory prefix); indirect hits are
their neighbours across *typed relations only* — a passing wikilink is not evidence that a change
affects the linking document. The report flags which hits are `verified`/`canonical`, because
those are the ones most costly to leave silently wrong.

Impact **reports**; it never marks anything stale by itself. `memory_mark_stale` is the separate,
explicit write, so a read can never mutate knowledge.

**The Git DAG is not the knowledge graph.** Git answers what code history exists. The knowledge
graph answers what the system believes, why, and how work relates. They are linked through
provenance (`AgentRun → Artifact → File → Commit`), never merged.

---

## Retrieval and the Context Compiler

Retrieval is a pipeline, not a vector search. What `ContextCompiler::compile` runs today:

```
seeds  explicit ids | file provenance | lexical (FTS5) | standing rules
   → graph expansion (one typed hop, weighted by relation confidence)
   → dedupe (reasons accumulate on one candidate)
   → supersession filter
   → score
   → section assignment
   → token packing, constraints first
   → ContextPack + rejections + conflicts
```

**The compiler makes no model call.** Choosing what an agent is allowed to see must be
reproducible, auditable, and free; a model in this loop would make the same request return
different context on different days. Semantic retrieval belongs upstream as an additional
*candidate source*, scored alongside the rest — the reason-and-weight structure already
accommodates it without a contract change.

### Ranking

Score is `sum(reason weights) × quality × importance × freshness`. Reason weights are a single
table in `context_compiler.rs`, which is what makes an entry's position explainable rather than
emergent:

```
explicit  1.00   the caller named this memory
file      0.90   its provenance cites a file being worked in
lexical   0.70   best FTS match, decaying by rank to a 0.15 floor
standing  0.50   pinned, or a canonical/verified constraint
graph     0.40   one typed relation from a seed, × the relation's confidence
```

Quality multiplies (`canonical` 1.3 → `superseded` 0.2) and staleness discounts to 0.6.
**Stale knowledge is carried and flagged, not hidden** — a decision a commit put in question is
still the best answer available until someone replaces it, and hiding it leaves the agent with
nothing instead of with a caveat.

### Packing

Sections are filled in a fixed priority order — Constraints, Architecture, Code, Prior Failures,
Tests, Related — so a tight budget loses background before it loses rules. A canonical constraint
reaches the agent even when the task text shares no words with it, because a rule an agent must
not break is not something the agent will think to search for.

Budgets: `minimal` 3k, `balanced` 6k (default), `deep` 12k, `exhaustive` 24k, or an explicit
number clamped to 500…60,000. Token cost is estimated as bytes/4 behind a single
`estimate_tokens` seam; it is reported as the estimate it is.

### Observability

Every pack carries what a debugger needs: per-entry reasons and weights, token cost, the score,
`candidatesConsidered`, `elapsedMs`, and a `rejected` list distinguishing a candidate cut *for
budget* from one cut *by policy*. "It was never retrieved" and "it was retrieved and cut" are
different problems with different fixes, so the pack never conflates them.

Contradictions among selected entries are **surfaced, not resolved**. Both sides stay in the pack
and the conflict is named; picking a winner is a knowledge decision, not a retrieval one.

Packs are compiled on demand and not cached. Caching needs an invalidation key spanning knowledge
revision, code revision, and branch; shipping the cache before that key can be tested would risk
serving an agent stale context, which is worse than recompiling.

---

## Knowledge health

`memory_health` returns counts, not a score. Every number corresponds to a query that lists the
offending rows, so nothing on the Overview is a figure without a click-through:

```
total, byQuality, byType     what exists
stale                        carries a stale_reason
staleCanonical               verified/canonical AND stale — the highest-risk bucket
orphans                      no inbound link, no outbound link, no relation
missingEvidence              no memory_sources row on the current revision
brokenLinks                  a [[wikilink]] whose slug matches no memory
contradictedClaims           claims whose status is `contradicted`
```

---

## Security

Every rule here is enforced in Rust, at the boundary, not in the renderer.

- **Project scope.** Every command re-derives scope from the *window*: the main window may reach
  any open Project; a detached Workspace window may reach only its own Project's, and only while
  it holds that Workspace's interactive lease. `projectId` from the renderer is a request, not an
  authorization.
- **Path containment.** Memory never touches the filesystem except through `ProjectPathGuard`,
  and subsystems that only *name* a file — impact analysis, Context Compiler focus paths — go
  through the same guard via `normalize_project_relative`. A subsystem that queries by path must
  inherit the same rejection as one that opens by path, or the guard is only as strong as its
  least careful caller.

  Precisely: traversal (`..`), NUL bytes, and drive- or scheme-qualified components are
  **rejected**. A leading separator is **neutralized** — `/etc/passwd` normalizes to `etc/passwd`
  and then resolves under the Project root like any other relative path. Symlink escape is caught
  by the canonicalized containment check on resolve.
- **Secrets are blocked, not redacted.** A body that carries recognizable credential material is
  refused, because a silently altered document would misrepresent what the user wrote and the FTS
  index would still have seen the original. The error names the offending *key* and never the
  value. Detection reuses the orchestration redactor rather than growing a second detector, with
  a token-level pass added because a memory writes secrets mid-prose and inside backticks, where a
  line-oriented log redactor does not look.
- **The automation inherits every boundary.** A lifecycle job names a path the watcher supplied,
  so it resolves through `ProjectPathGuard` inside `MemoryService::impact` like any other caller —
  a path that escapes the Project is skipped, and skipping one path does not abandon the rest of
  the batch. Job rows are Project-scoped in SQL, and the `memory_jobs`/`memory_job_cancel` commands
  re-derive scope from the window like every other Memory command. A failed job persists
  `AppError.message` only: `detail` may name a path or a driver string and never reaches a row the
  renderer reads.
- **No destructive command.** The Memory boundary exposes archive, not delete.
- **Closed vocabularies.** Relation and evidence types are a fixed set validated in Rust, so the
  graph stays typed rather than becoming a bag of strings.

---

## Boundaries

**Frontend** renders, interacts, and holds view-local state. It does not derive knowledge: slugs,
links, backlinks, unlinked mentions, quality, and ranking all arrive already computed, so an agent
reading through the command boundary and a human reading the UI see the same answers.

**Backend** owns validation, persistence, path security, parsing, and indexing. Reads and writes
run on the blocking pool; nothing here may stall the UI thread.

**Markdown analysis is pure.** `memory_markdown.rs` has no database, no filesystem, no model. That
is what makes the link graph reproducible and lets an index rebuild produce exactly the original
answer.

---

## Extension contracts

These are the seams later phases attach to without a schema or API rewrite.

| Phase | Attaches to | Why it does not require a rewrite |
| --- | --- | --- |
| Graph UI | `memory_relations`, `memory_links` | Nodes and typed edges already exist with confidence and provenance |
| Bases / saved views | `memory_tags`, `memory_properties` | Frontmatter is already indexed rows, not a blob |
| Context Compiler | `MemorySearchHit.score` / `.matchReason` | Retrieval attribution and a rank slot already exist |
| Embeddings | `memory_chunks` | Chunks are already section-granular and rebuildable |
| Temporal queries | `valid_from` / `valid_until` / `superseded_at` | Columns exist on revisions and claims |
| Contradiction engine | `ClaimStatus::Contradicted`, `supersedes` | Status and edge vocabulary already defined |
| More lifecycle jobs | `memory_jobs` + `KnowledgeJobKind` | The queue, retry, coalescing, and audit trail are kind-agnostic; a new kind is an enum arm and a handler |
| Freshness | `stale_reason`, `verified_at`, file sources | Watched sources are already recorded per claim |
| Branch overlays | `branch_name`, `workspace_id` | Scope columns exist on items and sources |
| MCP `memory.*` / `context.*` | `MemoryService` | Commands are a thin shell over the service; MCP binds to the same methods |
| Skills | — | Separate subsystem; consumes Context, does not extend Memory |
| Import (Obsidian) | `save_memory` + the Markdown mirror | The mirror format is already the import format |

---

## Implementation phases

| Phase | Status |
| --- | --- |
| 0 — Architecture, schema, migration | **done** |
| 1 — Markdown memory: properties, wikilinks, backlinks, mentions, search, history | **done** |
| 2 — Typed graph: claims, relations, provenance | **done**, including the Graph surface, evidence/tag overlays, and impact analysis |
| 3 — Bases + Canvas | not started |
| 4 — Context Compiler: retrieval, packs, budgets, observability | **done** for deterministic retrieval (lexical + provenance + graph + standing rules), packing, and the debugger. No semantic retrieval, no pack cache |
| 5 — Skills engine | not started |
| 6 — MCP capability fabric | not started |
| 7 — Automated knowledge lifecycle: capture, dedup, contradiction, freshness | partial: **automatic staleness is done** — a durable job queue turns repository changes into impact analysis and freshness writes, with an Activity surface over the real rows. Contradictions are still only *detected and surfaced* in packs. No capture pipeline, no dedup |
| 8 — Engineering intelligence: code graph, temporal queries, impact analysis | partial: file-level impact analysis is done. No symbol index, no temporal queries |
| 9 — Collaboration / organization scope | not started |

Dependency order that matters: **4 depends on 2** (reranking needs typed edges), **7 depends on 4**
(contradiction detection needs retrieval), **6 depends on 4** (the `context.*` domain is the point
of the MCP surface), and **8 depends on 7** (automatic freshness needs a capture pipeline).

### The automation loop

Impact analysis and `memory_mark_stale` used to exist at both ends with nothing between them, so
knowledge only went stale when a human said so — which means it usually did not. That connection
is now built:

```
file change  →  watcher debounce (150ms, coalesced)
             →  relevance filter (drops .paralith/, .git, build output, deps, lockfiles)
             →  memory_jobs row (one pending job per Project, paths unioned)
             →  worker thread claims it
             →  ImpactReport per path
             →  staleness policy
             →  memory_mark_stale
             →  memory-knowledge-updated  →  Activity surface, Context Compiler sees stale
```

Four properties make it safe to run without being asked:

**It is durable.** The queue is a table (`memory_jobs`), not a channel. A change that arrives while
PARALITH is closing is analyzed on the next launch, and a job left `running` by a crash is returned
to the queue with its attempt already counted.

**It costs the watcher one insert.** Analysis runs on a single dedicated worker thread. A branch
switch touching two thousand files does not block the watcher, and never touches the UI thread.

**It coalesces.** While a Project's impact job is still claimable, a new burst unions its paths
into that row rather than queueing another job — so a save-per-keystroke session produces one
analysis per quiet period, not hundreds. A job that has already *started* is left alone: a change
arriving mid-analysis queues its own job rather than mutating work in flight.

**The policy is pure, conservative, and auditable.** `staleness_decision` is a function with no
database, no clock, and no model. It flags only **direct** hits — a memory whose provenance cites
the changed path — and only at `supported` quality or above, and only when the memory is not
already stale (so the *first* change that put it in question stays readable). Everything it saw
and declined to flag is recorded on the job with the reason, because an automatic system that
reports only its writes cannot be audited for what it wrongly ignored.

The job row stores the trigger, the paths, what was marked, and what was skipped, and the Activity
surface renders those rows directly. "Why is this memory stale?" has an answer that is not "the
system decided".

Still unbuilt in phase 7: the capture pipeline (extracting durable findings from agent runs) and
deduplication. Contradiction *records* and a review workflow remain phase-7 work too — today
contradictions are surfaced in a pack rather than resolved.

---

## Performance budgets

Targets, **not measurements**. Nothing below has been benchmarked on a real project; they are the
numbers to hold the system to, and the section will say so until a benchmark exists.

```
Memory list (cached)          < 150ms
FTS query                     <  50ms
Backlinks (indexed)           <  20ms
Local graph                   < 100ms
Context candidate retrieval   < 250ms
Context compilation (local)   < 700ms
```

Bounds enforced today: 200 results per list or search, 25 unlinked-mention suggestions, 64 FTS
chunks per revision, 500 links per memory, 512 KB per body.

The unlinked-mention scan is the one read that touches bodies rather than an index; it is bounded
for that reason and is the first thing to revisit if a Project's memory count grows large.

Graph and Context bounds: 600 nodes per graph call (beyond which the response is marked
`truncated` rather than silently trimmed), 5,000 memory rows loaded for adjacency, 100 impact
hits, 120 context candidates ranked, 40 lexical candidates, 25 standing rules.

Graph adjacency is loaded once per call and traversed in memory, so a three-hop expansion is two
queries rather than one per hop. Context bodies are read once, after ranking has narrowed the
funnel — the compiler never reads a body it is not going to consider spending tokens on.
