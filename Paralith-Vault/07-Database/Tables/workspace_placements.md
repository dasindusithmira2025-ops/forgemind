---
id: table.workspace_placements
type: table
name: workspace_placements
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/database/migrations.rs
related:
  - database.paralith-sqlite
tags:
  - paralith
  - table
---
<!-- PARALITH:AUTO:START -->

# workspace_placements

SQLite table discovered from migration DDL with 17 column-like entries.

## Relationships

Incoming:
- [[Paralith SQLite]] -> contains_table (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/database/migrations.rs`

## Metadata

```json
{
  "columns": [
    "'background'))",
    "'detached'",
    "CHECK((mode='detached'",
    "fullscreen",
    "height",
    "last_focus_at",
    "maximized",
    "mode",
    "monitor_alias",
    "monitor_id",
    "placement_revision",
    "pos_x",
    "pos_y",
    "preferred_monitor_id",
    "width",
    "window_label",
    "workspace_id"
  ]
}
```

<!-- PARALITH:AUTO:END -->
