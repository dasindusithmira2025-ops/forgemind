---
id: module.9213af9a6aef814d
type: module
name: rust / services / database_studio / contracts
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/database_studio/contracts.rs
related:
  - module.b04ab8816dabdb01
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / database_studio / contracts

Rust module `Paralith-tauri/src-tauri/src/services/database_studio/contracts.rs` Defines: ApplyDatabaseDesignOperationRequest, BuildDatabaseContextPackRequest, CompareDatabaseRequest, CreateDatabaseDraftRequest, DatabaseAdapterSupport, DatabaseContextBudget, DatabaseContextOmissions, DatabaseContextOmissionSummary, DatabaseContextPack, DatabaseDesignBundle, ... 23 more.

## Relationships

Outgoing:
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/database_studio/contracts.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/database_studio/contracts.rs",
  "structs": [
    "ApplyDatabaseDesignOperationRequest",
    "BuildDatabaseContextPackRequest",
    "CompareDatabaseRequest",
    "CreateDatabaseDraftRequest",
    "DatabaseAdapterSupport",
    "DatabaseContextBudget",
    "DatabaseContextOmissions",
    "DatabaseContextOmissionSummary",
    "DatabaseContextPack",
    "DatabaseDesignBundle",
    "DatabaseDesignMutationResult",
    "DatabaseGraphPage",
    "DatabaseGraphReference",
    "DatabaseImplementationRun",
    "DatabaseImplementationStep",
    "DatabaseLayoutInput",
    "DatabaseObjectDetail",
    "DatabaseSourceDetail",
    "DatabaseSourceExcerpt",
    "DatabaseUsagePage",
    "DecideDatabaseDesignRequest",
    "DesignConcurrencyToken",
    "GetDatabaseDesignRequest",
    "GetDatabaseLayoutRequest",
    "GetDatabaseObjectRequest",
    "GetDatabaseSchemaRequest",
    "ImplementDatabaseDesignRequest",
    "IntrospectSqliteFileRequest",
    "ListDatabaseIssuesRequest",
    "ListDatabaseMigrationsRequest",
    "ListDatabaseUsageRequest",
    "SaveDatabaseLayoutRequest",
    "SourceScopedRequest"
  ],
  "enums": [
    "CreateDatabaseDraftBase",
    "DatabaseChangeRisk",
    "DatabaseExecutionMode"
  ],
  "functions": [
    "default"
  ]
}
```

<!-- PARALITH:AUTO:END -->
