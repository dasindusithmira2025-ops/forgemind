# Test naming contract (binding)

The scoreboard (`node .jcode/dbstudio/scoreboard.mjs`) resolves checks B7-B13 by running real test
filters and grepping the output. Tests must therefore be named to match, or a correct implementation
will still score as failing. This file is binding on Backend, UI, and Builder.

## Rust (Paralith-tauri/src-tauri)

All Database Studio tests live under a module path beginning `database_studio::`. Practically, that
means the modules are reachable as `crate::services::database_studio::...` etc., and the filter
string `database_studio::<area>` must select them.

| Check | Filter run | Required test-name substrings in output |
| --- | --- | --- |
| B7 | `cargo test database_studio::discovery` | `prisma`, `drizzle`, `raw_sql`, `sqlite`, `monorepo_shared_db`, `multi_logical_db`, `duplicate_table_names` |
| B8 | `cargo test database_studio::design` | `revision`, `draft`, `stale` |
| B9 | `cargo test database_studio::diff` | (green run is sufficient; include a formatting-only-yields-empty-diff test) |
| B10 | `cargo test database_studio::agent` | `design_only`, `implement_design`, `selection` |
| B11 | `cargo test database_studio::pipeline` | (green run is sufficient; must include target-vs-result comparison) |
| B12 | `cargo test database_studio::security` | (green run is sufficient; must include a no-credential-persisted and a no-auto-connect test) |

Example acceptable names:
- `discovery::monorepo_shared_db_resolves_one_primary_source_with_owner_and_consumers`
- `design::stale_revision_write_is_rejected`
- `agent::design_only_mode_cannot_mutate_repository_or_database`

Owner mapping: B7/B9/B12 Backend, B8 Backend+Builder, B10/B11 Builder.

## Frontend (Paralith-tauri)

| Check | Command | Requirement |
| --- | --- | --- |
| B13 | `npm run test -- largeSchema` | A test file whose name contains `largeSchema` (e.g. `src/features/database/canvas/largeSchema.bench.test.ts`) that generates ~400 tables, asserts rendered node count stays bounded by the LOD/viewport rule, and asserts layout work happens off the render path within an explicit ms budget. |

`npm run test` (B6) and `npm run typecheck`/`npm run lint` (B4/B5) must stay green including all
pre-existing suites.

## B3 (migration)

`CURRENT_SCHEMA_VERSION` must become `28`, `cargo test database::migrations` must be green, and a
test proving an installed older database upgrades without losing rows must exist (follow the shipped
`upgrades_installed_schema_10_to_current_preserving_data` pattern).

## B14 (anti-cheat)

The mission diff must contain zero newly added `#[ignore]`, `it.skip`, `test.skip`, `xit(`,
`xdescribe(`, or `--no-verify`. Making a check pass by weakening a test is a rejected outcome.
