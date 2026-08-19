---
id: decision.1fb6e8901492a323
type: decision
name: "The tool-panel divider mutates a CSS variable and the store only — the layout tr"
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/docs/application-audit/10-SECURITY-RELIABILITY-PERFORMANCE.md#L256"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# The tool-panel divider mutates a CSS variable and the store only — the layout tr

The tool-panel divider mutates a CSS variable and the store only — the layout tree is never rebuilt, so **terminals never remount on resize** (`WorkspaceScreen.tsx:327`).

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/docs/application-audit/10-SECURITY-RELIABILITY-PERFORMANCE.md#L256`

<!-- PARALITH:AUTO:END -->
