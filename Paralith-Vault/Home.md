---
id: system.home
type: system
name: home
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:53:17.734Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - repository:.
related:
tags:
  - paralith
  - system
---
<!-- PARALITH:AUTO:START -->

# PARALITH

Automatically generated Project Intelligence Layer. Markdown is a materialized view; source code, migrations, Git, and existing Context Fabric Memory remain authoritative.

## Current State

- 14 feature entities
- 586 module entities
- 213 Tauri/API command entities
- 150 database table entities
- 3753 typed relationships

## Active Features

- [[Agent Resume]] - Feature surface discovered from `Paralith-tauri/src/features/agent-resume`.
- [[Code Surface]] - Feature surface discovered from `Paralith-tauri/src/features/code-surface`.
- [[Database]] - Feature surface discovered from `Paralith-tauri/src/features/database`.
- [[Memory]] - Feature surface discovered from `Paralith-tauri/src/features/memory`.
- [[Orchestrator]] - Feature surface discovered from `Paralith-tauri/src/features/orchestrator`.
- [[Repository]] - Feature surface discovered from `Paralith-tauri/src/features/repository`.
- [[Sidebar]] - Feature surface discovered from `Paralith-tauri/src/features/sidebar`.
- [[Swarms]] - Feature surface discovered from `Paralith-tauri/src/features/swarms`.
- [[Terminals]] - Feature surface discovered from `Paralith-tauri/src/features/terminals`.
- [[Updates]] - Feature surface discovered from `Paralith-tauri/src/features/updates`.
- [[Usage]] - Feature surface discovered from `Paralith-tauri/src/features/usage`.
- [[Workspace Canvas]] - Feature surface discovered from `Paralith-tauri/src/features/workspace-canvas`.
- [[Workspace Setup]] - Feature surface discovered from `Paralith-tauri/src/features/workspace-setup`.
- [[Workspace Windows]] - Feature surface discovered from `Paralith-tauri/src/features/workspace-windows`.

## Recent Changes

- [[ba26c48 feat(usage)- ship analytics workspace surfaces]] - feat(usage): ship analytics workspace surfaces
- [[675b6d5 release- prepare Stable 0.4.12]] - release: prepare Stable 0.4.12
- [[9664276 feat(dbstudio)- source relevance classification, layer-unavailable states, relation cardinality]] - feat(dbstudio): source relevance classification, layer-unavailable states, relation cardinality
- [[a4e43f3 release- note the discovery-collision fix in the 0.4.11 changelog]] - release: note the discovery-collision fix in the 0.4.11 changelog
- [[091df1d fix(dbstudio)- stop duplicate ids from aborting discovery on real repos]] - fix(dbstudio): stop duplicate ids from aborting discovery on real repos
- [[4fef463 feat(design)- design system revamp + release prep for 0.4.11]] - feat(design): design system revamp + release prep for 0.4.11
- [[7107990 release- prepare Stable 0.4.10]] - release: prepare Stable 0.4.10
- [[002e3bd Merge remote-tracking branch 'origin-main' into feat-database-studio]] - Merge remote-tracking branch 'origin/main' into feat/database-studio
- [[f5f0e41 feat(dbstudio)- professional Database Studio UI + verified backend wiring]] - feat(dbstudio): professional Database Studio UI + verified backend wiring
- [[8aa0824 Fix static discovery source naming]] - Fix static discovery source naming
- [[bba3803 fix(dbstudio)- scope canvas state to project windows]] - fix(dbstudio): scope canvas state to project windows
- [[f0344ac feat(dbstudio)- wire runtime commands and orchestration]] - feat(dbstudio): wire runtime commands and orchestration

## Database Changes

- None discovered.

## Recent Decisions

- [[Fragment match cuts preserve screen position and terminology.]] - Fragment match cuts preserve screen position and terminology.
- [[🔴 swarmevidence.payloadjson is never populated]] - 🔴 `swarm_evidence.payload_json` is never populated
- [[The worker starts at boot, not on Project open, so a job left retrying by a cras]] - The worker starts at boot, not on Project open, so a job left `retrying` by a crash is picked up even if that Project is
- [[PushBranch { forcewithlease } — force-push is expressed as --force-with-lease, n]] - **`PushBranch { force_with_lease }`** — force-push is expressed as `--force-with-lease`, never bare `--force`.
- [[Interrupted operations are detected, not resumed. recoveronstartup() logs a warn]] - **Interrupted operations are detected, not resumed.** `recover_on_startup()` logs a warning; `repository_recovery_checkp
- [[repositorygraph tables are written but never displayed.]] - **`repository_graph_*` tables are written but never displayed.**
- [[DESIGNONLY never reaches the write path.]] - **`DESIGN_ONLY` never reaches the write path.**
- [[A destructive change never reaches it either, unless the caller acknowledged tha]] - **A destructive change never reaches it either, unless the caller acknowledged that exact destructive change set.**
- [[The tool-panel divider mutates a CSS variable and the store only — the layout tr]] - The tool-panel divider mutates a CSS variable and the store only — the layout tree is never rebuilt, so **terminals neve
- [[windows.hydratefromdisk() — -a stale placement must never stop the app from open]] - `windows.hydrate_from_disk()` — "a stale placement must never stop the app from opening"
- [[event emission — a failed emit must not fail the operation]] - event emission — a failed emit must not fail the operation
- [[Product invariants encoded as assertions (-never fabricate-, -never invent usage]] - Product invariants encoded as assertions ("never fabricate", "never invent usage")

## Current Risks

- [[Risk signals in design-taste-frontend - SKILL.md]] - 1 risk signal(s) detected in `.agents/skills/design-taste-frontend/SKILL.md`: TODO.
- [[Risk signals in full-output-enforcement - SKILL.md]] - 1 risk signal(s) detected in `.agents/skills/full-output-enforcement/SKILL.md`: TODO.
- [[Risk signals in . - AGENTS.md]] - 1 risk signal(s) detected in `AGENTS.md`: TODO.
- [[Risk signals in application-audit - 00-EXECUTIVE-SUMMARY.md]] - 2 risk signal(s) detected in `Paralith-tauri/docs/application-audit/00-EXECUTIVE-SUMMARY.md`: FIXME, TODO.
- [[Risk signals in application-audit - 09-INFRASTRUCTURE-AND-UPDATES.md]] - 2 risk signal(s) detected in `Paralith-tauri/docs/application-audit/09-INFRASTRUCTURE-AND-UPDATES.md`: FIXME, TODO.
- [[Risk signals in application-audit - 10-SECURITY-RELIABILITY-PERFORMANCE.md]] - 1 risk signal(s) detected in `Paralith-tauri/docs/application-audit/10-SECURITY-RELIABILITY-PERFORMANCE.md`: unwrap(.
- [[Risk signals in application-audit - 12-TECHNICAL-DEBT.md]] - 3 risk signal(s) detected in `Paralith-tauri/docs/application-audit/12-TECHNICAL-DEBT.md`: FIXME, TODO, unwrap(.
- [[Risk signals in application-audit - 15-STRATEGIC-READINESS.md]] - 3 risk signal(s) detected in `Paralith-tauri/docs/application-audit/15-STRATEGIC-READINESS.md`: FIXME, TODO, unwrap(.
- [[Risk signals in application-audit - README.md]] - 3 risk signal(s) detected in `Paralith-tauri/docs/application-audit/README.md`: FIXME, TODO, unwrap(.
- [[Risk signals in release - github-artifacts-publisher.test.mjs]] - 1 risk signal(s) detected in `Paralith-tauri/scripts/release/github-artifacts-publisher.test.mjs`: expect(.
- [[Risk signals in release - mirror-publisher.test.mjs]] - 1 risk signal(s) detected in `Paralith-tauri/scripts/release/mirror-publisher.test.mjs`: expect(.
- [[Risk signals in release - render-tauri-config.test.mjs]] - 1 risk signal(s) detected in `Paralith-tauri/scripts/release/render-tauri-config.test.mjs`: expect(.

## Automation Health

- See [[Automation Health]] and [[Generated Files Registry]].

<!-- PARALITH:AUTO:END -->
