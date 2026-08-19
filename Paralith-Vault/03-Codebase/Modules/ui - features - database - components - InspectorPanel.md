---
id: module.b3e1a383bda395d5
type: module
name: ui / features / database / components / InspectorPanel
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/database/components/InspectorPanel.tsx
related:
  - component.ColumnsTab
  - component.ConstraintsTab
  - component.DefinitionTab
  - component.HealthTab
  - component.HistoryTab
  - component.IndexesTab
  - component.InspectorPanel
  - component.RelationshipInspector
  - component.RelationsTab
  - component.SourceTab
  - component.TabCount
  - component.UsageTab
  - feature.database
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / database / components / InspectorPanel

TypeScript module `Paralith-tauri/src/features/database/components/InspectorPanel.tsx` defines UI component(s): ColumnsTab, ConstraintsTab, DefinitionTab, HealthTab, HistoryTab, IndexesTab, InspectorPanel, RelationshipInspector, RelationsTab, SourceTab, ... 2 more.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[ColumnsTab]] -> implemented_by (verified, 1)
- [[ConstraintsTab]] -> implemented_by (verified, 1)
- [[DefinitionTab]] -> implemented_by (verified, 1)
- [[HealthTab]] -> implemented_by (verified, 1)
- [[HistoryTab]] -> implemented_by (verified, 1)
- [[IndexesTab]] -> implemented_by (verified, 1)
- [[InspectorPanel]] -> implemented_by (verified, 1)
- [[RelationshipInspector]] -> implemented_by (verified, 1)
- [[RelationsTab]] -> implemented_by (verified, 1)
- [[SourceTab]] -> implemented_by (verified, 1)
- [[TabCount]] -> implemented_by (verified, 1)
- [[UsageTab]] -> implemented_by (verified, 1)
- [[Database]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/database/components/InspectorPanel.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/database/components/InspectorPanel.tsx",
  "imports": [
    "../../../components/ui/ErrorNotice",
    "../databaseStore",
    "../databaseTypes",
    "../relationSemantics",
    "./StatusBadge",
    "@tauri-apps/plugin-opener",
    "lucide-react",
    "react"
  ],
  "components": [
    "ColumnsTab",
    "ConstraintsTab",
    "DefinitionTab",
    "HealthTab",
    "HistoryTab",
    "IndexesTab",
    "InspectorPanel",
    "RelationshipInspector",
    "RelationsTab",
    "SourceTab",
    "TabCount",
    "UsageTab"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
