---
id: module.e99a9224de2413e7
type: module
name: ui / features / database / components / sections / HealthSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/database/components/sections/HealthSection.tsx
related:
  - component.HealthSection
  - component.IssueRow
  - feature.database
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / database / components / sections / HealthSection

TypeScript module `Paralith-tauri/src/features/database/components/sections/HealthSection.tsx` defines UI component(s): HealthSection, IssueRow.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[HealthSection]] -> implemented_by (verified, 1)
- [[IssueRow]] -> implemented_by (verified, 1)
- [[Database]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/database/components/sections/HealthSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/database/components/sections/HealthSection.tsx",
  "imports": [
    "../../databaseStore",
    "../../databaseTypes",
    "../SectionError",
    "../StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "HealthSection",
    "IssueRow"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
