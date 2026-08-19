---
id: module.148cea994f2dd8a9
type: module
name: rust / services / agent_resume
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/agent_resume.rs
related:
  - module.0d2322178c1a3f43
  - module.3ed764bcf4eee1d6
  - module.b04ab8816dabdb01
  - module.c1c61288f02a50d9
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / agent_resume

Rust module `Paralith-tauri/src-tauri/src/services/agent_resume.rs` Defines: AgentResumeService.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.3ed764bcf4eee1d6` (inferred, 0.7)
- uses -> `module.b04ab8816dabdb01` (inferred, 0.7)
- uses -> `module.0d2322178c1a3f43` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/agent_resume.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/agent_resume.rs",
  "structs": [
    "AgentResumeService"
  ],
  "enums": [],
  "functions": [
    "canonical_directory",
    "canonical_key",
    "exact_session_matching_does_not_accept_latest",
    "git_probe_reads_repository_metadata_through_background_command",
    "git_value",
    "launch_has_session",
    "missing_paths_return_actionable_recovery_codes",
    "new",
    "path_is_within",
    "path_scope_handles_unicode_and_rejects_siblings",
    "provider_executable_matches",
    "provider_executables_reject_corrupted_cross_provider_metadata",
    "provider_identity_fallback_checks_filenames_without_reading_transcripts",
    "provider_session_exists",
    "provider_session_exists_in_roots",
    "provider_session_roots",
    "reconcile",
    "relocate_worktree",
    "resume",
    "resume_error",
    "validate",
    "worktree_matches_repository"
  ]
}
```

<!-- PARALITH:AUTO:END -->
