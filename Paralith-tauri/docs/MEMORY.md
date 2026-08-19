# PARALITH Memory

Memory is durable, revisioned context owned by exactly one Project. Items, revisions, sources,
chunks, claims, relations, links, tags, and properties all carry a `project_id`; every Rust command
re-derives the Project scope from the calling window before returning content, so a window that
cannot reach a Project cannot reach its knowledge either.

The full subsystem design — storage layers, the claim model, graph domains, retrieval, security,
and the phase roadmap — is in [CONTEXT_FABRIC.md](CONTEXT_FABRIC.md). This file records what the
shipped surface does.

## What a memory is

A Markdown document with optional `---` frontmatter, owned by a Project and identified by a slug
derived from its title. Saving parses it deterministically in Rust: frontmatter becomes queryable
tags and properties, `[[wikilinks]]` become graph edges, and the first paragraph of prose becomes
the summary. Links inside fenced or inline code are not edges.

Editing writes a new immutable revision and re-points the item's head inside one transaction; a
save whose content hash is unchanged is a no-op, so an autosave cannot inflate history. Revision
bodies are protected by a SQLite trigger, not by convention.

## Quality and claims

Each memory carries a quality level — `working`, `observed`, `supported`, `verified`, `canonical`,
`deprecated`, `superseded` — and decomposes into claims: individually verifiable statements with
their own status, confidence, temporal validity, and evidence. A claim can go stale or be
contradicted without invalidating the memory that contains it.

Attaching evidence promotes an `open` claim to `supported`. Verification is a separate, deliberate
act and is what stamps `verified_at`. Promoting a memory to a trusted level with no evidence
attached is surfaced as a warning rather than rendered as a clean badge.

## Links, backlinks, relations

A link stores the slug it points at, never a resolved id, so backlinks are a join at read time and
no rename or deletion can leave a stale edge. A link to a memory that does not exist yet is shown
as unresolved rather than hidden. Backlinks resolve through the target's slug and through any
aliases declared in its frontmatter. Memories that name another in prose without linking to it are
offered as unlinked mentions — suggestions only; nothing becomes a link without an edit.

Typed relations (`supersedes`, `contradicts`, `supports`, `depends_on`, `implements`, `documents`,
`derived_from`, `related_to`) are separate from links: a link is what an author typed, a relation
is what the system asserts. The vocabulary is closed and validated in Rust.

## Portability

Every save also writes `.paralith/memory/<slug>.md` inside the Project through `ProjectPathGuard`
— a complete document with frontmatter, not an export stub, so the knowledge is diffable, reviewable
in a pull request, and readable without Paralith. SQLite remains authoritative; the mirror is
written from it and is currently one-directional. A memory whose mirror could not be written keeps
its edit and reports `filePath` as absent rather than failing the save.

## Security

Filesystem access is only ever through the Project path guard: traversal, absolute paths, drive and
UNC escape, NUL bytes, and symlink escape are refused before any row is written. Content that
carries recognizable credential material is *blocked*, not redacted — a silently altered document
would misrepresent what the user wrote, and the search index would still have seen the original.
The rejection names the offending key and never the value.

There is no destructive Memory command. Archiving drops a memory from search and from the list
while preserving its revisions, claims, and evidence: knowledge that stopped being true is still
evidence about what the project once believed.

## Scope

Memory is shared by the single Rust backend but renderer state is cleared on Project switch, and
an in-flight response for a Project the user has left is discarded rather than applied. Detached
Workspace windows reach only their own Project's memory.
