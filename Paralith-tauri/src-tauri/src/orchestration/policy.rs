//! The policy engine: given a session's operating mode and a capability's risk, decide whether the
//! gateway may execute now, must stop for approval, or must refuse outright.
//!
//! This is deliberately small and total (a pure function over two enums plus the mutation flag) so
//! it can be exhaustively tested and reasoned about. It is the single chokepoint the gateway calls
//! before every capability execution.

use super::model::{CapabilityEffectClass, DatabaseExecutionEnvelope, OperatingMode, RiskLevel};
use super::registry::CapabilityDescriptor;
use serde_json::Value;

/// The gate's decision for one capability under one operating mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateDecision {
    /// May execute immediately.
    Allow,
    /// May execute only with an explicit approval for this action.
    NeedsApproval,
    /// Not permitted in this mode at all; approval cannot override it.
    Deny { reason: &'static str },
}

/// Evaluate the policy gate. `approved` is whether the user has explicitly approved *this* action.
pub fn evaluate(
    mode: OperatingMode,
    descriptor: &CapabilityDescriptor,
    approved: bool,
    database_execution: Option<&DatabaseExecutionEnvelope>,
    validated_arguments: &Value,
) -> GateDecision {
    if descriptor.domain == super::model::CapabilityDomain::Database {
        match database_execution {
            Some(DatabaseExecutionEnvelope::DesignOnly { design_id, .. }) => {
                if matches!(
                    descriptor.effect_class,
                    CapabilityEffectClass::RepositoryMutation
                        | CapabilityEffectClass::DatabaseMutation
                ) {
                    return GateDecision::Deny {
                        reason: "DESIGN_ONLY cannot mutate repository files or a database.",
                    };
                }
                if descriptor.effect_class == CapabilityEffectClass::DesignMutation
                    && design_id.as_deref().is_some_and(|pinned| {
                        validated_arguments
                            .get("designId")
                            .and_then(Value::as_str)
                            .is_some_and(|target| target != pinned)
                    })
                {
                    return GateDecision::Deny {
                        reason: "The requested design differs from the design pinned in the execution envelope.",
                    };
                }
            }
            Some(DatabaseExecutionEnvelope::ImplementDesign {
                approved_target_revision_id,
                ..
            }) => {
                if descriptor.effect_class == CapabilityEffectClass::RepositoryMutation
                    && validated_arguments
                        .get("approvedRevisionId")
                        .and_then(Value::as_str)
                        != Some(approved_target_revision_id.as_str())
                {
                    return GateDecision::Deny {
                        reason: "The requested target differs from the approved revision pinned in the execution envelope.",
                    };
                }
                if descriptor.effect_class == CapabilityEffectClass::DesignMutation {
                    return GateDecision::Deny {
                        reason: "IMPLEMENT_DESIGN is pinned to implementation and cannot change the approved design.",
                    };
                }
            }
            None if descriptor.effect_class != CapabilityEffectClass::Read => {
                return GateDecision::Deny {
                    reason: "Database mutations require a structured execution envelope.",
                };
            }
            None => {}
        }
    }

    // Observe never mutates, regardless of risk or an approval flag: it is a read-only envelope.
    if matches!(mode, OperatingMode::Observe) && descriptor.mutates {
        return GateDecision::Deny {
            reason: "Observe mode is read-only. Switch to Assist or Execute to make changes.",
        };
    }

    // Critical always requires an explicit, action-specific approval — never auto, in any mode.
    if descriptor.risk == RiskLevel::Critical {
        return if approved {
            GateDecision::Allow
        } else {
            GateDecision::NeedsApproval
        };
    }

    // What each mode may run without asking. A monotonic ladder: Observe/Assist auto-run only
    // low-risk reads, Execute adds medium-risk actions, Autopilot adds high-risk ones. Any mutation
    // in Observe was already refused above.
    let auto_allowed = match mode {
        OperatingMode::Observe | OperatingMode::Assist => {
            descriptor.risk == RiskLevel::Low && !descriptor.mutates
        }
        OperatingMode::Execute => descriptor.risk <= RiskLevel::Medium,
        OperatingMode::Autopilot => descriptor.risk <= RiskLevel::High,
    };

    if auto_allowed || approved {
        GateDecision::Allow
    } else {
        GateDecision::NeedsApproval
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestration::model::{CapabilityDomain, Reversibility};
    use serde_json::json;

    fn descriptor(risk: RiskLevel, mutates: bool) -> CapabilityDescriptor {
        CapabilityDescriptor {
            id: "test.cap",
            display_name: "Test",
            domain: CapabilityDomain::Files,
            description: "",
            arg_schema: json!({}),
            requires_project_scope: false,
            risk,
            reversibility: Reversibility::NotApplicable,
            mutates,
            effect_class: if mutates {
                CapabilityEffectClass::RepositoryMutation
            } else {
                CapabilityEffectClass::Read
            },
            timeout_ms: 1000,
            audited: true,
            available: true,
            unavailable_reason: None,
        }
    }

    fn gate(
        mode: OperatingMode,
        descriptor: &CapabilityDescriptor,
        approved: bool,
    ) -> GateDecision {
        evaluate(mode, descriptor, approved, None, &json!({}))
    }

    #[test]
    fn observe_allows_reads_and_denies_mutations() {
        assert_eq!(
            evaluate(
                OperatingMode::Observe,
                &descriptor(RiskLevel::Low, false),
                false,
                None,
                &json!({})
            ),
            GateDecision::Allow
        );
        assert!(matches!(
            evaluate(
                OperatingMode::Observe,
                &descriptor(RiskLevel::Medium, true),
                true,
                None,
                &json!({})
            ),
            GateDecision::Deny { .. }
        ));
    }

    #[test]
    fn assist_requires_approval_for_any_mutation() {
        assert_eq!(
            gate(
                OperatingMode::Assist,
                &descriptor(RiskLevel::Low, false),
                false
            ),
            GateDecision::Allow
        );
        assert_eq!(
            gate(
                OperatingMode::Assist,
                &descriptor(RiskLevel::Medium, true),
                false
            ),
            GateDecision::NeedsApproval
        );
        assert_eq!(
            gate(
                OperatingMode::Assist,
                &descriptor(RiskLevel::Medium, true),
                true
            ),
            GateDecision::Allow
        );
    }

    #[test]
    fn execute_auto_runs_medium_but_gates_high() {
        assert_eq!(
            gate(
                OperatingMode::Execute,
                &descriptor(RiskLevel::Medium, true),
                false
            ),
            GateDecision::Allow
        );
        assert_eq!(
            gate(
                OperatingMode::Execute,
                &descriptor(RiskLevel::High, true),
                false
            ),
            GateDecision::NeedsApproval
        );
    }

    #[test]
    fn autopilot_auto_runs_high_but_never_critical() {
        assert_eq!(
            gate(
                OperatingMode::Autopilot,
                &descriptor(RiskLevel::High, true),
                false
            ),
            GateDecision::Allow
        );
        assert_eq!(
            gate(
                OperatingMode::Autopilot,
                &descriptor(RiskLevel::Critical, true),
                false
            ),
            GateDecision::NeedsApproval
        );
        assert_eq!(
            gate(
                OperatingMode::Autopilot,
                &descriptor(RiskLevel::Critical, true),
                true
            ),
            GateDecision::Allow
        );
    }
}
