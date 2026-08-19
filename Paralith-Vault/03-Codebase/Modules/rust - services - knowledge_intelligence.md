---
id: module.6e4742006307f5fa
type: module
name: rust / services / knowledge_intelligence
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-19T20:46:38.099Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src-tauri/src/services/knowledge_intelligence.rs
related:
  - feature.memory
  - module.327579f22c257d7d
  - module.432313b9b9997606
  - module.75f2ae6ea8dbdb02
  - module.ad836d2f7c54c6db
  - module.b30f0713fb3f8e55
  - module.c1c61288f02a50d9
  - module.d77bf3a4f12cf627
  - project.paralith
tags:
  - paralith
  - module
---
<!-- PARALITH:AUTO:START -->

# rust / services / knowledge_intelligence

Rust module `Paralith-tauri/src-tauri/src/services/knowledge_intelligence.rs` Defines: Fixture, KnowledgeIntelligence.

## Relationships

Outgoing:
- uses -> `module.c1c61288f02a50d9` (inferred, 0.7)
- uses -> `module.327579f22c257d7d` (inferred, 0.7)
- uses -> `module.75f2ae6ea8dbdb02` (inferred, 0.7)
- uses -> `module.b30f0713fb3f8e55` (inferred, 0.7)
- uses -> `module.432313b9b9997606` (inferred, 0.7)
- uses -> `module.d77bf3a4f12cf627` (inferred, 0.7)
- uses -> `module.ad836d2f7c54c6db` (inferred, 0.7)

Incoming:
- [[Project Overview]] -> contains_module (verified, 1)
- [[Memory]] -> implemented_by (strong, 0.9)

## Evidence

- `file:Paralith-tauri/src-tauri/src/services/knowledge_intelligence.rs`

## Metadata

```json
{
  "path": "Paralith-tauri/src-tauri/src/services/knowledge_intelligence.rs",
  "structs": [
    "Fixture",
    "KnowledgeIntelligence"
  ],
  "enums": [],
  "functions": [
    "a_contradicting_value_opens_a_conflict_and_leaves_both_sides_intact",
    "a_contradiction_is_never_auto_accepted",
    "a_dated_change_between_deterministic_readings_is_temporal",
    "a_deterministic_identity_wins_over_a_name_and_records_the_new_name_as_an_alias",
    "a_different_value_for_the_same_property_goes_to_review",
    "a_duplicate_with_no_memory_behind_it_is_simply_dropped",
    "a_genuinely_different_word_does_not_normalize_together",
    "a_high_risk_candidate_waits_in_review_rather_than_becoming_memory",
    "a_model_disagreeing_with_a_manifest_is_a_source_mismatch",
    "a_model_proposal_is_labelled_and_queued_however_confident",
    "a_nearly_identical_value_is_flagged_rather_than_merged",
    "a_restatement_of_known_knowledge_adds_evidence_instead_of_a_second_memory",
    "a_reviewed_candidate_is_written_at_verified_quality",
    "a_routine_deterministic_candidate_becomes_a_memory_with_its_evidence",
    "a_routine_deterministic_fact_is_accepted_without_a_human",
    "a_statement_is_clamped_on_a_character_boundary",
    "a_very_low_confidence_candidate_is_rejected_with_a_reason",
    "accept",
    "accepting_a_candidate_appears_on_the_knowledge_timeline",
    "an_alias_resolves_to_the_entity_that_owns_it",
    "an_identical_value_is_a_duplicate_not_a_new_fact",
    "an_unsupported_candidate_is_never_written_automatically",
    "attach_evidence",
    "candidate",
    "canonical_knowledge_is_protected_from_automatic_replacement",
    "clamp_statement",
    "classify_conflict",
    "classify_duplicate",
    "contests_canonical",
    "credential_shaped_content_never_becomes_a_candidate",
    "... 35 more"
  ]
}
```

<!-- PARALITH:AUTO:END -->
