# ForgeMind Memory

Memory is durable, revisioned context owned by exactly one Project. Items, revisions, sources, chunks, and capture events carry a `project_id`; every Rust command requires that Project ID and verifies ownership before returning content.

The first implementation supports explicit notes and Project-file capture. Files must resolve inside the Project root, secret-like material is rejected, and search results are bounded. Rebuilding the index recreates searchable chunks without deleting canonical items, revisions, or sources.

Memory is shared by the single Rust backend, but renderer state is cleared before switching Projects. Detached Workspace windows do not expose the Memory route or filesystem capture controls.
