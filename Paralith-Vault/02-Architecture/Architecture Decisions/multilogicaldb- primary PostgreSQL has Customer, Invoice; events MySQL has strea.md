---
id: decision.fa76349888c6fcfd
type: decision
name: "multilogicaldb: primary PostgreSQL has Customer, Invoice; events MySQL has strea"
status: active
generated: true
confidence: 0.72
evidence_level: inferred
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - "file:Paralith-tauri/src-tauri/tests/fixtures/database_studio/README.md#L24"
related:
  - project.paralith
tags:
  - paralith
  - decision
---
<!-- PARALITH:AUTO:START -->

# multilogicaldb: primary PostgreSQL has Customer, Invoice; events MySQL has strea

`multi_logical_db`: primary PostgreSQL has `Customer`, `Invoice`; events MySQL has `streams`, `events`; adapter must not merge them by repository root.

## Relationships

Incoming:
- [[Project Overview]] -> has_decision (inferred, 0.72)

## Evidence

- `file:Paralith-tauri/src-tauri/tests/fixtures/database_studio/README.md#L24`

<!-- PARALITH:AUTO:END -->
