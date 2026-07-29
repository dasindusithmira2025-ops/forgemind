//! The Paralith Orchestration Kernel — the privileged supervisory core behind the Paralith
//! Orchestrator feature.
//!
//! Responsibility model (spec): the user talks to the Orchestrator; the Orchestrator resolves
//! intent, assembles context, applies policy, and drives Paralith's real subsystems through typed
//! [`registry`] capabilities executed by the [`kernel`]. Individual capabilities are the only way an
//! application action happens — there is no arbitrary bridge from model/UI input to privileged code.
//!
//! This slice establishes the durable domain model ([`model`]), the lifecycle state machine, the
//! capability registry and risk/approval [`policy`] gate, secret [`redaction`], and the
//! [`OrchestrationKernel`] that ties them to persistence and Paralith's services. Planning, provider
//! adapters, swarm supervision, voice, and recovery build on top of this foundation.

pub mod kernel;
pub mod model;
pub mod policy;
pub mod redaction;
pub mod registry;

pub use kernel::OrchestrationKernel;
