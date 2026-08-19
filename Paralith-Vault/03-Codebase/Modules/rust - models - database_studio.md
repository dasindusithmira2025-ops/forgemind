---
id: module.811c07bf83578338
type: module
name: rust / models / database_studio
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/database_studio.rs
related:
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / database_studio

Rust module `Paralith-tauri/src-tauri/src/models/database_studio.rs` Defines: CheckConstraint, DatabaseAdapterCapabilities, DatabaseChange, DatabaseColumn, DatabaseColumnPatch, DatabaseDataType, DatabaseDesign, DatabaseDesignOperation, DatabaseDesignRevision, DatabaseDiff, ... 30 more.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/database_studio.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/database_studio.rs",
  "structs": [
    "CheckConstraint",
    "DatabaseAdapterCapabilities",
    "DatabaseChange",
    "DatabaseColumn",
    "DatabaseColumnPatch",
    "DatabaseDataType",
    "DatabaseDesign",
    "DatabaseDesignOperation",
    "DatabaseDesignRevision",
    "DatabaseDiff",
    "DatabaseEdge",
    "DatabaseEnumValue",
    "DatabaseEnvironment",
    "DatabaseExpression",
    "DatabaseIssue",
    "DatabaseLayout",
    "DatabaseLayoutPosition",
    "DatabaseMigration",
    "DatabaseNamespace",
    "DatabaseObjectMeta",
    "DatabaseObjectProvenance",
    "DatabaseSnapshot",
    "DatabaseSource",
    "DatabaseSourceEvidence",
    "DatabaseTable",
    "DatabaseUsageReference",
    "DatabaseViewport",
    "Enum",
    "ExtractedDatabaseGraph",
    "ForeignKey",
    "Index",
    "IndexKey",
    "OrmFieldMapping",
    "OrmModel",
    "PrimaryKey",
    "RepositoryProject",
    "SemanticIdentity",
    "SourceSpan",
    "UniqueConstraint",
    "View"
  ],
  "enums": [
    "DatabaseActor",
    "DatabaseAdapterId",
    "DatabaseComparisonMode",
    "DatabaseDesignOperationKind",
    "DatabaseEdgeType",
    "DatabaseEngine",
    "DatabaseEvidenceKind",
    "DatabaseLayer",
    "DatabaseObject",
    "DatabaseSourceRelevance",
    "EvidenceCertainty"
  ],
  "functions": [
    "as_str",
    "from_str_or_application",
    "is_primary",
    "kind_name",
    "meta"
  ]
}
```

<!-- PARALITH:AUTO:END -->
