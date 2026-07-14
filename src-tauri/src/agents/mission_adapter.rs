use crate::errors::{AppError, AppResult};
use crate::models::{AgentProfile, Mission, MissionTask, TerminalSession};

#[derive(Debug, Clone)]
pub struct AgentExecutionContext {
    pub mission: Mission,
    pub acceptance_criteria: Vec<String>,
    pub dependency_summaries: Vec<String>,
    pub project_instructions: Vec<String>,
    pub working_directory: String,
}

#[derive(Debug, Clone)]
pub struct AgentLaunchDefinition {
    pub arguments: Vec<String>,
    pub command_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionSignal {
    Running,
    Passed,
    Failed,
    NeedsRecovery,
}

pub trait AgentExecutionAdapter: Send + Sync {
    fn agent_id(&self) -> &str;
    fn build_launch_command(
        &self,
        task: &MissionTask,
        context: &AgentExecutionContext,
    ) -> AppResult<AgentLaunchDefinition>;
    fn detect_completion(&self, session: &TerminalSession) -> CompletionSignal;
}

pub struct CliAgentExecutionAdapter {
    profile: AgentProfile,
}

impl CliAgentExecutionAdapter {
    pub fn new(profile: AgentProfile) -> Self {
        Self { profile }
    }

    fn prompt(&self, task: &MissionTask, context: &AgentExecutionContext) -> String {
        let criteria = context
            .acceptance_criteria
            .iter()
            .map(|value| format!("- {value}"))
            .collect::<Vec<_>>()
            .join("\n");
        let dependencies = if context.dependency_summaries.is_empty() {
            "- None".into()
        } else {
            context
                .dependency_summaries
                .iter()
                .map(|value| format!("- {value}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let instructions = if context.project_instructions.is_empty() {
            "- Follow repository instructions discovered in the project.".into()
        } else {
            context
                .project_instructions
                .iter()
                .map(|value| format!("- {value}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let constraints = if context.mission.constraints.is_empty() {
            "- None".into()
        } else {
            context
                .mission
                .constraints
                .iter()
                .map(|value| format!("- {value}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let references = if context.mission.reference_paths.is_empty() {
            "- None".into()
        } else {
            context
                .mission
                .reference_paths
                .iter()
                .map(|value| format!("- {value}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        format!("ForgeMind mission: {}\n\nMission objective:\n{}\n\nAssigned task: {}\n{}\n\nAcceptance criteria for this task:\n{}\n\nConstraints:\n{}\n\nReference paths:\n{}\n\nDependency results:\n{}\n\nProject instructions:\n{}\n\nWorking directory:\n{}\n\nPermission profile: {}\nRisk level: {}\n\nSafety constraints:\n- Work only inside the assigned worktree.\n- Treat .env files, SSH keys, credential stores, and parent directories as protected.\n- Never expose secret values.\n- Do not merge, publish, deploy, reset databases, or modify the primary checkout.\n- Run the requested verification and report concrete evidence.\n- Finish with a concise summary of files changed and checks run.\n", context.mission.title, context.mission.objective, task.title, task.description, criteria, constraints, references, dependencies, instructions, context.working_directory, context.mission.permission_profile, context.mission.risk_level)
    }
}

impl AgentExecutionAdapter for CliAgentExecutionAdapter {
    fn agent_id(&self) -> &str {
        &self.profile.id
    }

    fn build_launch_command(
        &self,
        task: &MissionTask,
        context: &AgentExecutionContext,
    ) -> AppResult<AgentLaunchDefinition> {
        if !self.profile.available {
            return Err(AppError::new(
                "agent_unavailable",
                "The assigned coding agent is not currently available.",
                true,
            )
            .entity(&self.profile.id)
            .layer("mission-adapter"));
        }
        let prompt = self.prompt(task, context);
        let arguments = match self.profile.provider.as_str() {
            "claude" | "codex" => vec![prompt],
            "opencode" => vec!["run".into(), prompt],
            "custom_shell" => vec![prompt],
            "powershell" | "command_prompt" | "wsl" => Vec::new(),
            _ => {
                return Err(AppError::new(
                    "unsupported_agent_adapter",
                    "This profile cannot execute autonomous Mission Control tasks.",
                    true,
                )
                .entity(&self.profile.id)
                .layer("mission-adapter"))
            }
        };
        Ok(AgentLaunchDefinition {
            arguments,
            command_summary: format!("{} mission task", self.profile.name),
        })
    }

    fn detect_completion(&self, session: &TerminalSession) -> CompletionSignal {
        match (session.status.as_str(), session.exit_code) {
            ("running", _) => CompletionSignal::Running,
            ("exited", Some(0)) => CompletionSignal::Passed,
            ("exited" | "failed" | "terminated", _) => CompletionSignal::Failed,
            _ => CompletionSignal::NeedsRecovery,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AgentProvider;
    use chrono::Utc;

    #[test]
    fn provider_specific_cli_shape_stays_inside_adapter() {
        let now = Utc::now().to_rfc3339();
        let profile = AgentProfile {
            id: "p".into(),
            provider: AgentProvider::Opencode,
            name: "OpenCode".into(),
            executable_path: "opencode".into(),
            version: None,
            available: true,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let adapter = CliAgentExecutionAdapter::new(profile);
        let mission = Mission {
            id: "m".into(),
            project_id: "p".into(),
            origin_workspace_id: None,
            title: "Mission".into(),
            objective: "Objective".into(),
            constraints: vec![],
            reference_paths: vec![],
            preferred_agent_ids: vec![],
            status: "ready".into(),
            execution_mode: "manual-plan".into(),
            risk_level: "low".into(),
            permission_profile: "edit-worktree".into(),
            verification_profile_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let task = MissionTask {
            id: "t".into(),
            mission_id: "m".into(),
            title: "Task".into(),
            description: "Do it".into(),
            agent_id: Some("p".into()),
            role: None,
            status: "ready".into(),
            dependency_ids: vec![],
            acceptance_criterion_ids: vec![],
            working_directory: None,
            worktree_id: None,
            session_id: None,
            verification_profile_id: None,
            priority: 0,
            attempt: 0,
            execution_lock: None,
            started_at: None,
            completed_at: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let launch = adapter
            .build_launch_command(
                &task,
                &AgentExecutionContext {
                    mission,
                    acceptance_criteria: vec!["Pass".into()],
                    dependency_summaries: vec![],
                    project_instructions: vec![],
                    working_directory: "/tmp".into(),
                },
            )
            .unwrap();
        assert_eq!(launch.arguments.first().map(String::as_str), Some("run"));
        assert!(launch.arguments[1].contains("concrete evidence"));
    }
}
