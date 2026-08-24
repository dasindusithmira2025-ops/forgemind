pub mod agent_detector;
pub mod agent_handoff;
pub mod agent_resume;
pub mod browser_service;
pub mod code_intelligence;
pub mod code_parser;
pub mod context_compiler;
pub mod database_studio;
pub mod embeddings;
pub mod file_watch_service;
pub mod filesystem_service;
pub mod knowledge_intelligence;
pub mod knowledge_lifecycle;
pub mod memory_markdown;
pub mod memory_service;
/// Real-provider end-to-end proof for Mission Control. Test-only and `#[ignore]`d, for the same
/// reason the Run Engine's canary is.
#[cfg(test)]
mod mission_canary;
pub mod mission_planner;
pub mod mission_service;
pub mod process_util;
pub mod project_analyzer;
pub mod project_service;
pub mod query_engine;
pub mod repository_intelligence;
pub mod repository_service;
pub mod restoration_scheduler;
/// Real-provider end-to-end proof for the Run Engine. Test-only and `#[ignore]`d: it launches an
/// installed provider CLI, so it must be an explicit act, never part of an ordinary test run.
#[cfg(test)]
mod run_canary;
pub mod run_executor;
pub mod run_service;
pub mod semantic;
pub mod startup_service;
pub mod swarm_service;
pub mod terminal_manager;
pub mod update_service;
pub mod usage_service;
pub mod usage_telemetry_service;
pub mod window_chrome;
pub mod window_registry;

pub use agent_detector::AgentDetector;
pub use agent_resume::AgentResumeService;
pub use browser_service::BrowserService;
pub use code_intelligence::CodeIntelligence;
pub use context_compiler::ContextCompiler;
pub use database_studio::DatabaseStudioRuntime;
#[allow(unused_imports)]
pub use embeddings::EmbeddingProvider;
pub use file_watch_service::FileWatchService;
pub use filesystem_service::{FileSystemService, SelfWriteLedger};
pub use knowledge_intelligence::KnowledgeIntelligence;
pub use knowledge_lifecycle::KnowledgeLifecycle;
pub use memory_service::MemoryService;
pub use mission_service::MissionService;
pub use project_service::ProjectService;
pub use repository_service::RepositoryService;
pub use restoration_scheduler::RestorationScheduler;
pub use run_service::RunService;
pub use semantic::SemanticService;
pub use swarm_service::SwarmService;
pub use terminal_manager::TerminalManager;
pub use update_service::UpdateService;
pub use usage_service::UsageService;
pub use usage_telemetry_service::UsageTelemetryService;
pub use window_registry::{detached_label, WindowRegistry, MAIN_WINDOW_LABEL};
