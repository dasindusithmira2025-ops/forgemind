---
id: module.7fc4839014de7563
type: module
name: rust / commands / fabric_ipc
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs
related:
  - command.fabric_code
  - command.fabric_intelligence
  - command.fabric_memory
  - command.fabric_semantic
  - module.06428a45de853457
  - module.224dcb86418c4695
  - module.3ed764bcf4eee1d6
  - module.75f2ae6ea8dbdb02
  - module.b13b30928c81b69f
  - module.b30f0713fb3f8e55
  - module.d8e94d73bbebef19
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / commands / fabric_ipc

Rust module `Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs` exposes Tauri command(s): fabric_memory, fabric_intelligence, fabric_code, fabric_semantic. Defines: ClaimArgs, ImpactArgs, JobArgs, JobsArgs, LanguageArgs, PathArgs, PathDepthArgs, PathLimitArgs, PinArgs, ProjectArgs, ... 11 more.

## Relationships

Outgoing:
- uses -> `module.b13b30928c81b69f` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.06428a45de853457` (inferred, 0.7)
- uses -> `module.d8e94d73bbebef19` (inferred, 0.7)
- uses -> `module.75f2ae6ea8dbdb02` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.224dcb86418c4695` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[fabric_memory]] -> implemented_by (verified, 1)
- [[fabric_intelligence]] -> implemented_by (verified, 1)
- [[fabric_code]] -> implemented_by (verified, 1)
- [[fabric_semantic]] -> implemented_by (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/commands/fabric_ipc.rs",
  "structs": [
    "ClaimArgs",
    "ImpactArgs",
    "JobArgs",
    "JobsArgs",
    "LanguageArgs",
    "PathArgs",
    "PathDepthArgs",
    "PathLimitArgs",
    "PinArgs",
    "ProjectArgs",
    "ProjectItemArgs",
    "ProjectLimitArgs",
    "QueryArgs",
    "RelationArgs",
    "RevisionArgs",
    "SemanticQueryArgs",
    "StaleArgs",
    "StatusArgs",
    "StatusLimitArgs",
    "SymbolArgs",
    "SymbolSearchArgs"
  ],
  "enums": [],
  "functions": [
    "camel_case_transport_payloads_decode_to_typed_arguments",
    "decode",
    "decode_request",
    "encode",
    "fabric_code",
    "fabric_intelligence",
    "fabric_memory",
    "fabric_semantic",
    "invalid_payload",
    "unknown_operations_fail_closed_without_echoing_payloads",
    "unsupported_operation"
  ]
}
```

<!-- PARALITH:AUTO:END -->
