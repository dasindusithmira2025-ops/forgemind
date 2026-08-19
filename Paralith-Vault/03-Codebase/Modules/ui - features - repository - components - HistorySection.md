---
id: module.b0b5286a8b1281bb
type: module
name: ui / features / repository / components / HistorySection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/components/HistorySection.tsx
related:
  - component.CommitInspector
  - component.HistorySection
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / components / HistorySection

TypeScript module `Paralith-tauri/src/features/repository/components/HistorySection.tsx` defines UI component(s): CommitInspector, HistorySection.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[CommitInspector]] -> implemented_by (verified, 1)
- [[HistorySection]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/components/HistorySection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/components/HistorySection.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../../../components/ui/ErrorNotice",
    "../../../native/types",
    "../repositorySelectors",
    "../repositoryStore",
    "./StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "CommitInspector",
    "HistorySection"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
