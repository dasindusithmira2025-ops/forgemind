---
id: module.82b06a993d421c91
type: module
name: ui / features / sidebar / components / WorkspaceListSection
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/sidebar/components/WorkspaceListSection.tsx
related:
  - component.FlatList
  - component.ProjectGroup
  - component.WorkspaceListSection
  - component.WorkspaceRows
  - component.WorkspaceSkeletons
  - feature.sidebar
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / sidebar / components / WorkspaceListSection

TypeScript module `Paralith-tauri/src/features/sidebar/components/WorkspaceListSection.tsx` defines UI component(s): FlatList, ProjectGroup, WorkspaceListSection, WorkspaceRows, WorkspaceSkeletons.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[FlatList]] -> implemented_by (verified, 1)
- [[ProjectGroup]] -> implemented_by (verified, 1)
- [[WorkspaceListSection]] -> implemented_by (verified, 1)
- [[WorkspaceRows]] -> implemented_by (verified, 1)
- [[WorkspaceSkeletons]] -> implemented_by (verified, 1)
- [[Sidebar]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/sidebar/components/WorkspaceListSection.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/sidebar/components/WorkspaceListSection.tsx",
  "imports": [
    "../sidebarModel",
    "../sidebarStore",
    "../sidebarTypes",
    "./SidebarGroup",
    "./WorkspaceContextMenu",
    "./WorkspaceRow",
    "lucide-react",
    "react"
  ],
  "components": [
    "FlatList",
    "ProjectGroup",
    "WorkspaceListSection",
    "WorkspaceRows",
    "WorkspaceSkeletons"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
