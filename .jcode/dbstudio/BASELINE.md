# Paralith Database Studio — Pre-Mission Baseline

Owner: Reviewer (Opus 5). This file is the attribution boundary for the mission. Any failure that
appears in a later run and is **not** listed here is a regression introduced by mission work, and
the owning specialist must fix it. Any failure listed here is pre-existing and nobody on this
mission is blamed for it, but it also cannot be used to hide a new failure behind it.

## Baseline identity

| Field | Value |
| --- | --- |
| Branch | `feat/database-studio` |
| Baseline commit measured | `569cb5a82e73f0c4f101c9b8cf68acfb7b1ca8a8` (`docs(dbstudio):define-architecture-contracts`) |
| Merge-base with `origin/main` | `514f12eab56816bce047ecb291e4be736c879b83` |
| Code drift vs merge-base at measurement time | **zero** — `git diff --name-only 514f12e..HEAD -- "*.rs" "*.ts" "*.tsx" "*.json"` returned nothing. All mission commits so far are `.jcode/dbstudio/*.md` docs plus `src-tauri/tests/fixtures/database_studio/**` static fixture files. So these numbers are a true pre-implementation baseline. |
| Measured (UTC) | 2026-08-10T19:05–19:12 |
| Host | Windows x86_64 |
| Toolchain | rustc 1.96.0 (ac68faa20 2026-05-25), cargo 1.96.0 (30a34c682 2026-05-25), node v24.12.0, npm 11.6.2 |
| App version | paralith 0.4.8 / crate `forgemind` 0.4.8 |

Working tree at measurement contained only untracked, unrelated marketing assets
(`Marketing_videos/`, `corelith-web/public/media/paralith-showcase.*`). These are not mission files
and were not modified.

## Results — everything is GREEN at baseline

| # | Command | Cwd | Exit | Result |
| --- | --- | --- | --- | --- |
| 1 | `cargo check --all-targets` | `Paralith-tauri/src-tauri` | 0 | Compiled `forgemind v0.4.8` in 31.98s. **Zero warnings, zero errors.** |
| 2 | `cargo test` | `Paralith-tauri/src-tauri` | 0 | **269 passed / 0 failed / 0 ignored** across 4 test binaries (lib: 267, +2 in a second binary, 2 empty binaries). Wall 46s. |
| 3 | `cargo fmt --check` | `Paralith-tauri/src-tauri` | 0 | Clean, no output. |
| 4 | `cargo clippy --all-targets` | `Paralith-tauri/src-tauri` | 0 | **Zero warnings.** |
| 5 | `npm run typecheck` (`tsc -b --pretty false`) | `Paralith-tauri` | 0 | Clean, no diagnostics. |
| 6 | `npm run lint` (`oxlint src --deny-warnings`) | `Paralith-tauri` | 0 | **0 warnings, 0 errors**, 201 files, 103 rules. |
| 7 | `npm run test` (`vitest run`) | `Paralith-tauri` | 0 | **57 test files passed, 544 tests passed, 0 failed, 0 skipped.** Wall 26.9s. |
| 8 | `npm run build` (`tsc -b && vite build`) | `Paralith-tauri` | 0 | Built in 5.30s, 3150 modules. |

### Pre-existing failures

**None.** Backend, frontend, lint, format, clippy, tests, and production build are all clean at
`569cb5a`. There is no pre-existing breakage to hide behind.

Consequence for the mission: the bar is exact. After mission work,
`cargo check --all-targets`, `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets`,
`npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` must **all** still exit 0.
`cargo test` must report **at least 269 passed with 0 failed and 0 ignored**; vitest must report
**at least 544 passed with 0 failed and 0 skipped**. A drop in either count without a stated,
reviewed reason is treated as a deleted or disabled test (a blocker under mission "Do not disable
tests to get green results").

### Non-blocking observations recorded for honesty (pre-existing, not mission-caused)

1. `npm run build` emits Vite chunk-size warnings: `editor.api` 2.54 MB, `MonacoEditorPane`
   1.11 MB, `workspaceLayoutCommands` 427 kB, plus a `ts.worker` asset at 5.94 MB. These exist at
   baseline and are **not** a Database Studio defect. However, Database Studio must not make this
   materially worse: if the mission adds a heavyweight graph/layout library, it must be
   route-split so it does not land in the shared `index` chunk. This will be checked at GATE 8.
2. `oxlint` is scoped to `src` only (`oxlint src --deny-warnings`). Frontend code placed outside
   `Paralith-tauri/src/` would silently escape lint. Database Studio UI must live under
   `src/features/database/**` as the plan requires, which keeps it linted.
3. `vitest` currently reports `environment 409.47s` for a 26.9s wall run, i.e. jsdom setup already
   dominates the suite. New UI tests should prefer pure store/selector tests over full-render tests
   where the contract allows, or the suite time will degrade quickly.

## Scoreboard baseline

`node .jcode/dbstudio/scoreboard.mjs --fast` at `569cb5a` → `SCORE gates=0/10 checks=0/14`
(13 slow checks skipped in `--fast`; B14 ran and **FAILED**).

### B14 is broken at baseline — harness defect, must be fixed by the coordinator

`B14 ("no tests disabled / no assertions deleted in mission diff")` fails at baseline with **zero
implementation code written**. Verified cause: the check scans added lines in the mission diff for
its own forbidden pattern, and the mission diff now contains the pattern *as documentation and as
the checker's own source*. Exact offending added lines (from
`git diff 514f12e..HEAD` filtered by the B14 regex):

```
+The mission diff must contain zero newly added `#[ignore]`, `it.skip`, `test.skip`, `xit(`,
+`xdescribe(`, or `--no-verify`. Making a check pass by weakening a test is a rejected outcome.
+    /#\[ignore\]|\b(it|test|describe)\.skip\b|\bxit\(|\bxdescribe\(|--no-verify/.test(l),
```

Sources: `.jcode/dbstudio/TEST-NAMING.md` (2 lines of prose) and `.jcode/dbstudio/scoreboard.mjs:104`
(the regex literal itself).

This is a **false positive in the harness, not a real violation**. It matters because a check that
is red for a bogus reason trains the swarm to ignore it, which is exactly how a genuinely disabled
test would later slip through.

Required fix (owner: coordinator, who owns `scoreboard.mjs`): restrict B14's scan to files that can
actually contain tests and exclude the harness/docs from self-matching. Minimum acceptable fix is to
parse the diff per-file and skip `.jcode/**` (and any `*.md`), rather than scanning the flat diff
text. Do **not** fix it by weakening the pattern. Until it is fixed, B14's failure is recorded here
as pre-existing and non-attributable; after it is fixed, B14 must be green and any later failure is
a real violation.

## Reproduction

```bat
cd Paralith-tauri\src-tauri
cargo check --all-targets
cargo test
cargo fmt --check
cargo clippy --all-targets
cd ..
npm run typecheck
npm run lint
npm run test
npm run build
```

## Existing systems that must stay green (regression watch list)

From the baseline `cargo test` (267 lib tests) and vitest (544 tests), the mission must not regress:

- persistence + migration chain `database::migrations` (`CURRENT_SCHEMA_VERSION = 27`, with
  `upgrades_installed_schema_10_to_current_preserving_data` and per-version upgrade tests). Mission
  work appends `migrate_v28`; `v1..v27` are frozen.
- `orchestration::registry` invariants, notably `ids_are_unique_and_dotted` and
  `read_capabilities_are_not_mutating_and_writes_are` — new `database.*` capabilities must satisfy
  both or these existing tests will fail.
- repository/Git intelligence, swarm, terminal/workspace, placement, usage, update, and frontend
  sidebar/workspace/repository suites.
