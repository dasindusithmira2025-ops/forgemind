use crate::models::swarm::{
    SwarmMemberModelConfig, SwarmModelCapability, SwarmModelValidationStatus,
};

/// Application-managed aliases are the authoritative compatibility boundary between the Swarm
/// UI and provider CLIs. Discovery may refine availability, but it must never invent a model.
#[derive(Debug, Clone)]
pub struct RegisteredModel {
    pub provider_id: &'static str,
    pub provider_name: &'static str,
    pub model_id: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub reasoning: &'static [&'static str],
    pub modes: &'static [&'static str],
    pub recommended_roles: &'static [&'static str],
    pub vision: bool,
}

const MODELS: &[RegisteredModel] = &[
    RegisteredModel { provider_id: "claude", provider_name: "Claude", model_id: "opus", display_name: "Opus", description: "Deep planning and architecture work.", reasoning: &["low", "medium", "high", "max"], modes: &["interactive", "autonomous", "review"], recommended_roles: &["coordinator", "scout"], vision: true },
    RegisteredModel { provider_id: "claude", provider_name: "Claude", model_id: "fable", display_name: "Fable", description: "Broad analysis and exploratory engineering.", reasoning: &["low", "medium", "high"], modes: &["interactive", "autonomous", "review"], recommended_roles: &["scout", "reviewer"], vision: true },
    RegisteredModel { provider_id: "claude", provider_name: "Claude", model_id: "sonnet", display_name: "Sonnet", description: "Balanced coding, review, and implementation.", reasoning: &["low", "medium", "high"], modes: &["interactive", "autonomous", "review"], recommended_roles: &["builder", "reviewer", "debugger"], vision: true },
    RegisteredModel { provider_id: "codex", provider_name: "Codex", model_id: "gpt-5.5", display_name: "GPT-5.5", description: "Strong general coding and repository work.", reasoning: &["low", "medium", "high", "max"], modes: &["interactive", "autonomous", "review"], recommended_roles: &["builder", "integrator"], vision: true },
    RegisteredModel { provider_id: "codex", provider_name: "Codex", model_id: "sol", display_name: "SOL", description: "Deep reasoning and complex implementation.", reasoning: &["medium", "high", "max"], modes: &["interactive", "autonomous", "review"], recommended_roles: &["builder", "debugger", "coordinator"], vision: true },
    RegisteredModel { provider_id: "codex", provider_name: "Codex", model_id: "luna", display_name: "Luna", description: "Fast iteration and lightweight tasks.", reasoning: &["low", "medium"], modes: &["interactive", "autonomous"], recommended_roles: &["builder", "debugger"], vision: false },
    RegisteredModel { provider_id: "codex", provider_name: "Codex", model_id: "terra", display_name: "Terra", description: "Review, validation, and broad codebase analysis.", reasoning: &["medium", "high", "max"], modes: &["interactive", "autonomous", "review"], recommended_roles: &["reviewer", "scout", "debugger"], vision: true },
];

pub fn find(provider_id: &str, model_id: &str) -> Option<&'static RegisteredModel> {
    MODELS.iter().find(|item| item.provider_id == provider_id && item.model_id == model_id)
}

pub fn provider_models(provider_id: &str) -> Vec<&'static RegisteredModel> {
    MODELS.iter().filter(|item| item.provider_id == provider_id).collect()
}

pub fn default_for(provider_id: &str) -> Option<SwarmMemberModelConfig> {
    let model_id = match provider_id { "claude" => "sonnet", "codex" => "gpt-5.5", _ => return None };
    let model = find(provider_id, model_id)?;
    Some(SwarmMemberModelConfig::configured(model.provider_id, model.model_id, model.provider_name, model.display_name))
}

pub fn unvalidated_for(provider_id: &str) -> SwarmMemberModelConfig {
    SwarmMemberModelConfig {
        provider_id: provider_id.into(), provider_display_name: provider_id.into(),
        model_id: "unconfigured".into(), model_display_name: "Model not configured".into(),
        reasoning_effort: "medium".into(), execution_mode: "autonomous".into(),
        context_strategy: "balanced".into(), permission_mode: "ask".into(), fallback: None,
        provider_options: serde_json::Value::Object(Default::default()), config_version: 1,
        last_validation_status: SwarmModelValidationStatus::Unvalidated,
        last_validated_at: None,
    }
}

pub fn capability(model: &RegisteredModel, provider_available: bool, version: Option<String>) -> SwarmModelCapability {
    SwarmModelCapability {
        provider_id: model.provider_id.into(), provider_display_name: model.provider_name.into(),
        model_id: model.model_id.into(), display_name: model.display_name.into(), description: model.description.into(),
        available: provider_available, deprecated: false, replacement_model_id: None,
        coding: true, planning: true, review: true, tool_use: true, vision: model.vision,
        supported_reasoning_efforts: model.reasoning.iter().map(|v| (*v).into()).collect(),
        supported_execution_modes: model.modes.iter().map(|v| (*v).into()).collect(),
        recommended_roles: model.recommended_roles.iter().map(|v| (*v).into()).collect(),
        authenticated: provider_available, runtime_version: version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases_are_provider_scoped_and_independent() {
        let opus = find("claude", "opus").unwrap();
        let sonnet = find("claude", "sonnet").unwrap();
        assert_ne!(opus.model_id, sonnet.model_id);
        assert!(find("codex", "sonnet").is_none());
        assert_eq!(provider_models("codex").len(), 4);
    }

    #[test]
    fn configured_defaults_are_resolvable_registry_entries() {
        for provider in ["claude", "codex"] {
            let config = default_for(provider).unwrap();
            assert!(find(&config.provider_id, &config.model_id).is_some());
        }
    }
}
