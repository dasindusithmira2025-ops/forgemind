---
id: module.0fdbcd79b02728ab
type: module
name: rust / services / agent_handoff
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/agent_handoff.rs
related:
  - module.75f2ae6ea8dbdb02
  - module.dd8b4f912a83dad0
  - module.e846b64e5a6c83c8
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / agent_handoff

Rust module `Paralith-tauri/src-tauri/src/services/agent_handoff.rs`

## Relationships

Outgoing:
- uses -> `module.75f2ae6ea8dbdb02` (inferred, 0.7)
- uses -> `module.dd8b4f912a83dad0` (inferred, 0.7)
- uses -> `module.e846b64e5a6c83c8` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/agent_handoff.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/agent_handoff.rs",
  "structs": [],
  "enums": [],
  "functions": [
    "a_completed_run_becomes_a_handoff_with_its_real_artifacts",
    "a_credential_in_an_agents_own_output_never_reaches_the_handoff",
    "a_failed_run_carries_its_real_failure_reason",
    "a_run_with_no_structured_result_reports_empty_sections_not_invented_ones",
    "a_string_blob_of_findings_is_read_as_a_list",
    "an_enormous_change_set_is_bounded_and_says_so",
    "candidates_from_handoff",
    "clip",
    "findings_become_candidates_and_work_logs_do_not",
    "from_agent_run",
    "redact_tokens",
    "render_markdown",
    "run",
    "string_list"
  ]
}
```

<!-- PARALITH:AUTO:END -->
