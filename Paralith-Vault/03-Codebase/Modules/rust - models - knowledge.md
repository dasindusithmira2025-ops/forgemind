---
id: module.09ecd896b59dfe7f
type: module
name: rust / models / knowledge
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/models/knowledge.rs
related:
  - feature.memory
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / models / knowledge

Rust module `Paralith-tauri/src-tauri/src/models/knowledge.rs` Defines: AnalyzeImpactPayload, AnalyzeProjectOutcome, AnalyzeProjectPayload, CandidateOutcome, ExtractHandoffPayload, ImpactOutcome, KnowledgeJob, KnowledgeUpdatedEvent, SkippedHit.

## Relationships

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/models/knowledge.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/models/knowledge.rs",
  "structs": [
    "AnalyzeImpactPayload",
    "AnalyzeProjectOutcome",
    "AnalyzeProjectPayload",
    "CandidateOutcome",
    "ExtractHandoffPayload",
    "ImpactOutcome",
    "KnowledgeJob",
    "KnowledgeUpdatedEvent",
    "SkippedHit"
  ],
  "enums": [
    "KnowledgeJobKind",
    "KnowledgeJobStatus"
  ],
  "functions": [
    "as_str",
    "parse"
  ]
}
```

<!-- PARALITH:AUTO:END -->
