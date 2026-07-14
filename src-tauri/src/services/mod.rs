pub mod agent_detector;
pub mod mission_control;
pub mod mission_domain;
pub mod project_service;
pub mod restoration_scheduler;
pub mod terminal_manager;
pub mod window_registry;

pub use agent_detector::AgentDetector;
pub use mission_control::MissionControlService;
pub use project_service::ProjectService;
pub use restoration_scheduler::RestorationScheduler;
pub use terminal_manager::TerminalManager;
pub use window_registry::{detached_label, WindowRegistry, MAIN_WINDOW_LABEL};
