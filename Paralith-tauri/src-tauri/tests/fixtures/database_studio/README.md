# Database Studio discovery fixtures

These fixtures are static repository trees for Database Studio acceptance tests. They must be parsed as files only. Do not install dependencies, run generated code, or connect to any database.

## Expected discovery results

| Fixture | Logical databases | Engine | Owner project | Consumer projects | Adapter | Expected tables | Deliberate trap |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| `prisma` | `default` | PostgreSQL | fixture root | none | Prisma schema + migrations | 5 | Prisma model names are logical table names unless mapped; enum and join model must be preserved. |
| `drizzle` | `default` | PostgreSQL | fixture root | none | Drizzle TypeScript schema + migrations | 3 | Tables are declared through `pgTable` with indexes in callback objects and relations outside the table declarations. |
| `raw_sql` | `default` | PostgreSQL-compatible SQL | fixture root | none | Raw SQL DDL | 4 | The canonical schema is split across migrations and `schema.sql`; ALTER TABLE adds a column after creation. |
| `sqlite` | `dev` | SQLite | fixture root | none | SQLite SQL + `DATABASE_URL=file:./dev.db` evidence | 2 | `dev.db.reference.txt` is only a checked-in database-file reference; tests must not open a database. |
| `monorepo_shared_db` | `primary`, `analytics` | PostgreSQL, PostgreSQL | `packages/db`, `apps/analytics` | `apps/api`, `apps/worker` consume `primary`; none consume `analytics` | Prisma for primary, raw SQL for analytics, workspace/import/env/docker-compose evidence | 3 primary, 2 analytics | North-star case: one primary DB must not be duplicated for api and worker; analytics is separate despite same engine. |
| `multi_logical_db` | `primary`, `events` | PostgreSQL, MySQL | fixture root | none | Prisma for primary, raw MySQL DDL for events | 2 primary, 2 events | Two environment variables and schema artifacts represent distinct logical databases in one repo. |
| `duplicate_table_names` | `default` | PostgreSQL | fixture root | none | Raw SQL DDL | 2 | `public.events` and `audit.events` share the unqualified name `events`; identity must include namespace/schema. |

### Per-fixture notes

- `prisma`: expects models `User`, `Post`, `Tag`, `PostTag`, `Order`; enum `OrderStatus`; relations `Post.authorId -> User.id`, `PostTag.postId -> Post.id`, `PostTag.tagId -> Tag.id`, `Order.userId -> User.id`; unique constraints on `User.email`, `Tag.name`, and composite `Post.authorId+slug`.
- `drizzle`: expects tables `accounts`, `users`, `audit_logs`; enum `account_role`; FKs from `users.account_id` and `audit_logs.account_id` to `accounts.id`, plus nullable `audit_logs.actor_id -> users.id`.
- `raw_sql`: expects `organizations`, `users`, `projects`, `memberships`; composite primary key on `memberships`; indexes from explicit `CREATE INDEX` statements.
- `sqlite`: expects `users`, `notes`; FK `notes.user_id -> users.id`; adapter must record file URL evidence without persisting the credential string as a secret.
- `monorepo_shared_db`: `packages/db/prisma/schema.prisma` owns the primary DB with `User`, `Job`, `ApiToken`; `apps/api` and `apps/worker` are consumers because they import `@repo/db`; `apps/analytics/src/schema.sql` owns analytics with `page_views`, `conversions` and uses a distinct env var and docker-compose service.
- `multi_logical_db`: primary PostgreSQL has `Customer`, `Invoice`; events MySQL has `streams`, `events`; adapter must not merge them by repository root.
- `duplicate_table_names`: expected qualified table IDs are `public.events` and `audit.events`; a UI or graph label may display both as `events` only with namespace disambiguation.
