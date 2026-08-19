---
id: decision.39e5e3112242f025
type: decision
name: "PushBranch { forcewithlease } — force-push is expressed as --force-with-lease, n"
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/docs/application-audit/08-DEVELOPER-ENVIRONMENT.md#L156"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# PushBranch { forcewithlease } — force-push is expressed as --force-with-lease, n

**`PushBranch { force_with_lease }`** — force-push is expressed as `--force-with-lease`, never bare `--force`.

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/docs/application-audit/08-DEVELOPER-ENVIRONMENT.md#L156`

<!-- PARALITH:AUTO:END -->
