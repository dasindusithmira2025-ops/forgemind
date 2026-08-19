---
id: decision.b9222b3bf3f27f78
type: decision
name: "The worker starts at boot, not on Project open, so a job left retrying by a cras"
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/docs/application-audit/06-RUNTIME-AND-AUTOMATION.md#L73"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# The worker starts at boot, not on Project open, so a job left retrying by a cras

The worker starts at boot, not on Project open, so a job left `retrying` by a crash is picked up even if that Project is never reopened.

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/docs/application-audit/06-RUNTIME-AND-AUTOMATION.md#L73`

<!-- PARALITH:AUTO:END -->
