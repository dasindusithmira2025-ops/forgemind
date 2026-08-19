//! Generation 0 VNext compatibility contracts.
//!
//! These types establish stable identity and scope checks without wiring a second runtime into the
//! application. Existing `ContextRequest`, `ContextPack`, `SwarmAgentRun`, `AgentHandoff`,
//! `ProviderRuntimeAdapter`, and Swarm proof records remain the live implementations.

#![allow(dead_code)]

use super::agent::AgentProvider;
use super::context::ContextPack;
use super::swarm::SwarmRole;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Stable control-plane identity for intent that may currently be represented by a Swarm or an
/// orchestration session. The legacy fields are compatibility references, not alternate owners.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissionIdentity {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub legacy_swarm_id: Option<String>,
    #[serde(default)]
    pub legacy_orchestration_session_id: Option<String>,
}

/// Stable executable-task identity. `legacy_swarm_id` lets the future Mission boundary refer to
/// today's `swarm_tasks` without renaming or duplicating the task entity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdentity {
    pub id: String,
    pub mission_id: String,
    pub project_id: String,
    #[serde(default)]
    pub legacy_swarm_id: Option<String>,
}

/// The ContextCompiler result plus the identity that makes the exact delivered context
/// attributable to one executable task and one execution attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompiledContextPack {
    pub id: String,
    pub project_id: String,
    pub task_id: String,
    pub agent_run_id: String,
    pub compiler_version: String,
    pub created_at: String,
    pub pack: ContextPack,
}

impl CompiledContextPack {
    /// Check the association before an execution adapter accepts the pack. No database or runtime
    /// side effect is involved, so this is safe to use as a boundary regression test now.
    pub fn validate_scope(&self) -> Result<(), &'static str> {
        if self.project_id.trim().is_empty()
            || self.task_id.trim().is_empty()
            || self.agent_run_id.trim().is_empty()
        {
            return Err("context identity fields must not be empty");
        }
        if self.pack.project_id != self.project_id {
            return Err("context pack project does not match its execution scope");
        }
        Ok(())
    }
}

/// Additive request boundary for the future runtime gateway. The current Swarm scheduler adapts
/// its `SwarmRuntimeScope`, `SwarmTask`, and `SwarmAgent` into this shape later.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionRequest {
    pub project_id: String,
    pub task_id: TaskIdentity,
    pub agent_run_id: String,
    pub provider: AgentProvider,
    pub model_id: String,
    pub working_directory: String,
    pub context: CompiledContextPack,
    #[serde(default)]
    pub resume_session_id: Option<String>,
}

impl AgentExecutionRequest {
    /// Validate only cross-boundary identity invariants. Provider availability, policy, and
    /// filesystem authorization remain owned by their existing services.
    pub fn validate_scope(&self) -> Result<(), &'static str> {
        if self.project_id != self.task_id.project_id {
            return Err("execution project does not match task project");
        }
        if self.agent_run_id != self.context.agent_run_id {
            return Err("execution run does not match context run");
        }
        if self.task_id.id != self.context.task_id {
            return Err("execution task does not match context task");
        }
        self.context.validate_scope()
    }
}

/// Runtime output before the Proof Engine decides completion. A result is not a success claim;
/// `verification` is intentionally absent from this type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionResult {
    pub agent_run_id: String,
    pub provider_session_id: Option<String>,
    pub status: String,
    pub exit_code: Option<i32>,
    pub summary: String,
    pub changed_files: Vec<String>,
    pub observations: Vec<Value>,
}

/// Proof input shape for the additive evidence boundary. The compatibility `SwarmEvidence` row
/// stores this shape in its bounded `payload_json` column until the proof tables converge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StructuredEvidence {
    #[serde(default = "structured_evidence_version")]
    pub version: u32,
    pub agent_run_id: String,
    pub task_id: String,
    pub criterion: String,
    pub evidence_type: String,
    #[serde(default)]
    pub producer: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub source_uri: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub output_digest: Option<String>,
    #[serde(default)]
    pub changed_paths: Vec<String>,
    #[serde(default)]
    pub test_result: Option<Value>,
    #[serde(default)]
    pub commit_sha: Option<String>,
    #[serde(default)]
    pub verification_state: String,
    pub payload: Value,
    pub captured_at: String,
}

fn structured_evidence_version() -> u32 {
    1
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationRequirementKind {
    TestExecution,
    IndependentReview,
    IntegrationVerification,
    RepositoryStateEvidence,
    CustomAcceptance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationRequirement {
    pub id: String,
    pub criterion: String,
    pub kind: VerificationRequirementKind,
    pub required: bool,
    pub independent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationPolicy {
    pub requirements: Vec<VerificationRequirement>,
    pub decision_rule: String,
}

impl VerificationPolicy {
    pub fn none() -> Self {
        Self {
            requirements: Vec::new(),
            decision_rule: "all_required".into(),
        }
    }

    /// Derive proof requirements from persisted task properties and typed role metadata. Task
    /// titles are deliberately not consulted: wording is presentation, not policy.
    pub fn for_task(role: SwarmRole, verification_required: bool) -> Self {
        if !verification_required {
            return Self::none();
        }
        let mut requirements = Vec::new();
        let mut add =
            |id: &str, criterion: &str, kind: VerificationRequirementKind, independent: bool| {
                requirements.push(VerificationRequirement {
                    id: id.into(),
                    criterion: criterion.into(),
                    kind,
                    required: true,
                    independent,
                });
            };
        match role {
            SwarmRole::Builder | SwarmRole::Debugger => add(
                "test-execution",
                "A passing verification command for the code-changing task",
                VerificationRequirementKind::TestExecution,
                false,
            ),
            SwarmRole::Scout => add(
                "repository-state",
                "Persisted repository-read evidence",
                VerificationRequirementKind::RepositoryStateEvidence,
                false,
            ),
            SwarmRole::Reviewer => {
                add(
                    "reviewer-test-execution",
                    "A passing verification command from the Reviewer",
                    VerificationRequirementKind::TestExecution,
                    true,
                );
                add(
                    "independent-review",
                    "Independent review evidence",
                    VerificationRequirementKind::IndependentReview,
                    true,
                );
                add(
                    "reviewer-repository-state",
                    "Repository-state evidence for the reviewed revision",
                    VerificationRequirementKind::RepositoryStateEvidence,
                    true,
                );
            }
            SwarmRole::Integrator => {
                add(
                    "integration-tests",
                    "Passing integration verification",
                    VerificationRequirementKind::TestExecution,
                    false,
                );
                add(
                    "integration-state",
                    "Integration completed through Repository control",
                    VerificationRequirementKind::IntegrationVerification,
                    false,
                );
            }
            SwarmRole::Coordinator => {}
        }
        Self {
            requirements,
            decision_rule: "all_required".into(),
        }
    }

    pub fn requires(&self, kind: VerificationRequirementKind) -> bool {
        self.requirements
            .iter()
            .any(|requirement| requirement.required && requirement.kind == kind)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub requirement_id: String,
    pub status: String,
    pub evidence_ids: Vec<String>,
    pub exit_code: Option<i32>,
    pub summary: String,
    pub verified_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(project_id: &str) -> ContextPack {
        ContextPack {
            project_id: project_id.into(),
            task: "compile context".into(),
            budget_tokens: 100,
            used_tokens: 0,
            sections: Vec::new(),
            rejected: Vec::new(),
            conflicts: Vec::new(),
            candidates_considered: 0,
            elapsed_ms: 0,
            compiled_at: "2026-08-18T00:00:00Z".into(),
            handoffs: Vec::new(),
            cached: false,
            semantic_used: false,
            compiler_version: "2".into(),
            diagnostics: Default::default(),
        }
    }

    fn request() -> AgentExecutionRequest {
        AgentExecutionRequest {
            project_id: "project-1".into(),
            task_id: TaskIdentity {
                id: "task-1".into(),
                mission_id: "mission-1".into(),
                project_id: "project-1".into(),
                legacy_swarm_id: Some("swarm-1".into()),
            },
            agent_run_id: "run-1".into(),
            provider: AgentProvider::Claude,
            model_id: "model-1".into(),
            working_directory: "C:/project".into(),
            context: CompiledContextPack {
                id: "pack-1".into(),
                project_id: "project-1".into(),
                task_id: "task-1".into(),
                agent_run_id: "run-1".into(),
                compiler_version: "2".into(),
                created_at: "2026-08-18T00:00:00Z".into(),
                pack: context("project-1"),
            },
            resume_session_id: None,
        }
    }

    #[test]
    fn execution_scope_requires_matching_project_task_and_run() {
        assert!(request().validate_scope().is_ok());

        let mut mismatched = request();
        mismatched.context.agent_run_id = "run-2".into();
        assert_eq!(
            mismatched.validate_scope(),
            Err("execution run does not match context run")
        );
    }

    #[test]
    fn context_scope_rejects_a_pack_from_another_project() {
        let mut scoped = request().context;
        scoped.pack.project_id = "project-2".into();
        assert_eq!(
            scoped.validate_scope(),
            Err("context pack project does not match its execution scope")
        );
    }

    #[test]
    fn compatibility_identities_round_trip_with_stable_wire_names() {
        let identity = MissionIdentity {
            id: "mission-1".into(),
            project_id: "project-1".into(),
            legacy_swarm_id: Some("swarm-1".into()),
            legacy_orchestration_session_id: Some("session-1".into()),
        };
        let encoded = serde_json::to_value(&identity).expect("identity serializes");
        assert_eq!(encoded["projectId"], "project-1");
        assert_eq!(encoded["legacySwarmId"], "swarm-1");
        assert_eq!(
            identity,
            serde_json::from_value(encoded).expect("identity deserializes")
        );
    }
}
