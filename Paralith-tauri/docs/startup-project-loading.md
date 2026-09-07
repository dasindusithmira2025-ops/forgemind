# Startup project loading

Startup health validation retains the full SQLite integrity and foreign-key checks. For a file-backed database it runs on a separate read-only transaction, so the shared application connection remains available to load projects and persist terminal state. The report describes a consistent committed snapshot; it does not mutate the database. In-memory tests use their existing connection.

Automatic update polling reads `PRAGMA user_version` directly. Installation and startup health validation still perform their existing full checks.

Main and detached windows receive an opaque native background at construction. The entry HTML paints a theme-aware background and a startup status before the application module graph loads; React replaces the status when it mounts.

Diagnostic evidence: a read-only probe of the affected approximately 904 MB database took 41,597 ms for `PRAGMA integrity_check`, 15 ms for `PRAGMA user_version`, and 1 ms to count 28 recent projects. These are individual query timings, not an end-to-end launch benchmark.
