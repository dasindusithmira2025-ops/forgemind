# Database Studio Backend Audit

Scope: WP2 Phase B only. This is the extraction plan before approved contracts exist. No domain, persistence, migration, or command implementation starts until `CONTRACTS.md` is approved.

## Static-only extraction rule

Database discovery must not execute repository code, run package scripts, load user modules, instantiate ORM clients, open `.sqlite`/`.db` files, or connect to any database URL. All findings come from repository files, with provenance pointing to file path and text span/line where practical. Connection strings are evidence of existence and logical grouping only; credentials must be redacted or represented as env-var references.

## Prisma extraction

Parse `schema.prisma` files directly:

- `datasource` blocks: provider, datasource name, env var name from `url = env("...")`, optional direct URL scheme if present after redaction.
- `generator` blocks only as weak evidence of Prisma usage, not database identity.
- `model` blocks: model/table name, `@@map`, field names, scalar/enum/model types, optional/list markers, `@id`, `@@id`, `@unique`, `@@unique`, `@default`, `@relation(fields: ..., references: ...)`, `@@index`, `@map`.
- `enum` blocks: enum name and values.
- `prisma/migrations/**/migration.sql`: migration names/order and supplemental DDL evidence.

Parsing strategy: implement a small Prisma schema tokenizer/block parser, not regex-only. Regex is acceptable for initial file candidate discovery and env-var extraction, but block contents need balanced braces and attribute argument parsing to handle multiline models and composite constraints. This still will not be a full Prisma compiler.

Limits:

- Will not evaluate unsupported Prisma preview features, generator plugins, or schema composed through external pre-processing.
- Will not infer database objects hidden behind raw SQL in application code.
- Complex native type metadata can be preserved as raw annotations before semantic normalization is finalized.

## Drizzle extraction

Parse TypeScript schema files without executing them:

- Candidate files from `drizzle.config.ts`, imports from `drizzle-orm/*-core`, and `pgTable`/`mysqlTable`/`sqliteTable` usage.
- Table calls: exported symbol, physical table name string, column object keys, column builder names/types, `.primaryKey()`, `.notNull()`, `.unique()`, `.default*()`, `.references(() => other.col)`.
- Index/unique index callbacks: `index(...)`, `uniqueIndex(...)`, `.on(...)` references.
- `pgEnum` and equivalent enum declarations.
- `relations(...)` blocks as supplemental relationship/usage evidence when direct column `.references` is absent.
- Drizzle migrations and `drizzle/meta/_journal.json` for migration order and dialect evidence.

Parsing strategy: use a conservative TypeScript lexical scanner plus targeted call-expression extraction for known Drizzle factories. Do not use regex alone for nested callbacks because table definitions contain nested object literals, arrow functions, and chained calls. A full TypeScript compiler dependency is not justified until contracts approve dependencies; if no parser crate/dependency is approved, implement balanced-token extraction with explicit unsupported-shape diagnostics.

Limits:

- Will not execute computed table names, spread column objects, imported helper factories, or conditional schema definitions.
- Aliased imports are supported only if statically resolvable from import declarations.
- Deep expression evaluation is out of scope; unresolved computed values become issues with provenance, not invented schema.

## Raw SQL DDL extraction

Parse `.sql` schema and migration files as DDL text:

- `CREATE SCHEMA`, `CREATE TYPE ... AS ENUM`, `CREATE TABLE`, inline/table-level primary keys, foreign keys, unique constraints, checks, `CREATE INDEX`/`CREATE UNIQUE INDEX`, simple `ALTER TABLE ... ADD COLUMN`, simple `ALTER TABLE ... ADD CONSTRAINT`.
- Dialect hints from file path, URL schemes/env names, Docker service images, and syntax (`AUTOINCREMENT`, `AUTO_INCREMENT`, `jsonb`, `timestamptz`).
- Namespace-qualified identity must preserve schema/catalog, e.g. `public.events` and `audit.events` are distinct.

Parsing strategy: start with a deterministic DDL statement splitter that respects quoted strings, quoted identifiers, dollar-quoted PostgreSQL blocks where possible, comments, and parentheses. Then parse the supported statement heads with dialect-aware token handling. Avoid broad regex that crosses statement boundaries.

Limits:

- No stored procedure parsing, dynamic SQL, PL/pgSQL body interpretation, trigger body semantic extraction, or vendor-specific DDL beyond explicit supported forms.
- Destructive migration ordering semantics are recorded but not replayed as a full database engine.
- Formatting-only changes must normalize away whitespace/comments/identifier quoting where semantically safe, but not change case-sensitive quoted identifiers.

## Monorepo ownership and use evidence

Discovery should combine schema ownership evidence with repository-intelligence-style project evidence:

- Workspace roots from `package.json` workspaces and `pnpm-workspace.yaml`.
- Ownership from schema/migration file location and package boundaries.
- Consumer edges from package dependencies (`@repo/db`), static imports, env examples, and docker-compose service names.
- Deduplicate logical DBs by owner/schema/env/service evidence, not by every app that imports a DB package.

## Existing Paralith modules to reuse

- `src-tauri/src/database/mod.rs` `DatabaseService`: persistence access pattern and transaction ownership.
- `src-tauri/src/database/migrations.rs`: numbered migration chain and upgrade-preserves-data test style. Later implementation should append only `migrate_v28` and leave `migrate_v1..v27` untouched.
- `src-tauri/src/services/repository_intelligence.rs`: `GraphBuilder` plus `Origin` provenance pattern for evidence-backed nodes/edges.
- `src-tauri/src/services/file_watch_service.rs`: existing file event source for later incremental refresh.
- Existing orchestration redaction/policy modules should be consumed later for agent tools and credential boundaries, but those are outside Phase B implementation.

## Security posture

- Never persist raw credentials from `.env`, docker-compose, Prisma datasource URLs, or Drizzle configs.
- Never auto-connect during discovery. Live introspection must be an explicit later action with approved contracts and credential handling.
- Treat repository files as untrusted input: bounded reads, no shell expansion, no dependency install, no module loading.
