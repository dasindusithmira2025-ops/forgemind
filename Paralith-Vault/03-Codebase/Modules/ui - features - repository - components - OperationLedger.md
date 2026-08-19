---
id: module.4fda81ce7627326a
type: module
name: ui / features / repository / components / OperationLedger
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/repository/components/OperationLedger.tsx
related:
  - component.LedgerRow
  - component.OperationLedger
  - feature.repository
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# ui / features / repository / components / OperationLedger

TypeScript module `Paralith-tauri/src/features/repository/components/OperationLedger.tsx` defines UI component(s): LedgerRow, OperationLedger.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[LedgerRow]] -> implemented_by (verified, 1)
- [[OperationLedger]] -> implemented_by (verified, 1)
- [[Repository]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/repository/components/OperationLedger.tsx`

## Metadata

```json
{
  "path": "Paralith-tauri/src/features/repository/components/OperationLedger.tsx",
  "imports": [
    "../../../components/ui/Button",
    "../../../native/types",
    "../repositorySelectors",
    "../repositoryStore",
    "./StatusBadge",
    "lucide-react",
    "react"
  ],
  "components": [
    "LedgerRow",
    "OperationLedger"
  ],
  "invokes": []
}
```

<!-- PARALITH:AUTO:END -->
