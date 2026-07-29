//! The capability registry: the typed, honest inventory of what the Orchestrator can do to
//! Paralith.
//!
//! Every application-changing (or application-reading) action the kernel performs is described here
//! as a [`CapabilityDescriptor`] and executed through the gateway in [`crate::orchestration::kernel`].
//! The language model — in a later slice — may only *select* a capability id and propose arguments;
//! it never constructs shell commands or calls internal functions directly. This registry is the
//! allow-list that makes that guarantee enforceable.
//!
//! Slice 1 ships the deterministic, read-mostly capabilities that require no provider credentials
//! and no planning model: project/workspace/terminal/settings inspection, guarded project file read,
//! and a guarded project file write that exercises the risk/approval gate end to end. Additional
//! domains (browser, git mutations, agents, swarms, missions) extend this same table.

use super::model::{CapabilityDomain, Reversibility, RiskLevel};
use serde::Serialize;
use serde_json::{json, Value};

/// A typed description of one controllable Paralith action. The metadata here drives the UI, the
/// risk/approval gate, argument validation, and the audit record.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDescriptor {
    /// Stable identifier, `domain.verb`. Never renamed once shipped (it is an IPC contract).
    pub id: &'static str,
    pub display_name: &'static str,
    pub domain: CapabilityDomain,
    pub description: &'static str,
    /// A JSON description of the accepted argument object. Drives UI hints and documents the
    /// contract; the gateway additionally performs typed validation before executing.
    pub arg_schema: Value,
    /// Whether the capability needs a bound Project. File and workspace reads are project-scoped and
    /// go through the same security boundary as the rest of Paralith.
    pub requires_project_scope: bool,
    pub risk: RiskLevel,
    pub reversibility: Reversibility,
    /// True when the capability changes application or filesystem state. Observe mode refuses these.
    pub mutates: bool,
    pub timeout_ms: u64,
    /// Every capability execution is recorded; kept explicit so an audit-exempt capability would be
    /// a deliberate, reviewable choice rather than an omission.
    pub audited: bool,
    /// Whether this capability is usable in the current build/environment. Slice 1 capabilities are
    /// always available because their backing services are always constructed at startup.
    pub available: bool,
    pub unavailable_reason: Option<&'static str>,
}

/// The complete set of capabilities the kernel can execute. Order is stable and UI-friendly
/// (grouped by domain, read before write).
pub fn all_descriptors() -> Vec<CapabilityDescriptor> {
    vec![
        CapabilityDescriptor {
            id: "project.list",
            display_name: "List projects",
            domain: CapabilityDomain::Projects,
            description: "List the recent Paralith projects and their metadata.",
            arg_schema: json!({ "type": "object", "properties": {} }),
            requires_project_scope: false,
            risk: RiskLevel::Low,
            reversibility: Reversibility::NotApplicable,
            mutates: false,
            timeout_ms: 5_000,
            audited: true,
            available: true,
            unavailable_reason: None,
        },
        CapabilityDescriptor {
            id: "workspace.list",
            display_name: "List workspaces",
            domain: CapabilityDomain::Workspaces,
            description: "List the saved workspaces for the session's active project.",
            arg_schema: json!({ "type": "object", "properties": {} }),
            requires_project_scope: true,
            risk: RiskLevel::Low,
            reversibility: Reversibility::NotApplicable,
            mutates: false,
            timeout_ms: 5_000,
            audited: true,
            available: true,
            unavailable_reason: None,
        },
        CapabilityDescriptor {
            id: "terminal.list",
            display_name: "List live terminals",
            domain: CapabilityDomain::Terminals,
            description:
                "List the currently live terminal sessions, optionally scoped to a workspace.",
            arg_schema: json!({
                "type": "object",
                "properties": { "workspaceId": { "type": "string" } }
            }),
            requires_project_scope: false,
            risk: RiskLevel::Low,
            reversibility: Reversibility::NotApplicable,
            mutates: false,
            timeout_ms: 5_000,
            audited: true,
            available: true,
            unavailable_reason: None,
        },
        CapabilityDescriptor {
            id: "setting.read",
            display_name: "Read settings",
            domain: CapabilityDomain::Settings,
            description: "Read the current application settings.",
            arg_schema: json!({ "type": "object", "properties": {} }),
            requires_project_scope: false,
            risk: RiskLevel::Low,
            reversibility: Reversibility::NotApplicable,
            mutates: false,
            timeout_ms: 5_000,
            audited: true,
            available: true,
            unavailable_reason: None,
        },
        CapabilityDescriptor {
            id: "file.read",
            display_name: "Read project file",
            domain: CapabilityDomain::Files,
            description:
                "Read a text file inside the active project through the secure path guard.",
            arg_schema: json!({
                "type": "object",
                "required": ["relativePath"],
                "properties": { "relativePath": { "type": "string" } }
            }),
            requires_project_scope: true,
            risk: RiskLevel::Low,
            reversibility: Reversibility::NotApplicable,
            mutates: false,
            timeout_ms: 10_000,
            audited: true,
            available: true,
            unavailable_reason: None,
        },
        CapabilityDescriptor {
            id: "file.write",
            display_name: "Write project file",
            domain: CapabilityDomain::Files,
            description:
                "Write a text file inside the active project through the secure path guard. \
                          Optimistic-concurrency safe and undoable through Git.",
            arg_schema: json!({
                "type": "object",
                "required": ["relativePath", "content"],
                "properties": {
                    "relativePath": { "type": "string" },
                    "content": { "type": "string" },
                    "expectedSha256": { "type": "string" }
                }
            }),
            requires_project_scope: true,
            risk: RiskLevel::Medium,
            reversibility: Reversibility::ViaGit,
            mutates: true,
            timeout_ms: 10_000,
            audited: true,
            available: true,
            unavailable_reason: None,
        },
    ]
}

/// Look up a capability by id.
pub fn find(id: &str) -> Option<CapabilityDescriptor> {
    all_descriptors().into_iter().find(|d| d.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_dotted() {
        let descriptors = all_descriptors();
        let mut seen = std::collections::HashSet::new();
        for descriptor in &descriptors {
            assert!(
                seen.insert(descriptor.id),
                "duplicate capability id {}",
                descriptor.id
            );
            assert!(
                descriptor.id.contains('.'),
                "capability id {} must be domain.verb",
                descriptor.id
            );
        }
    }

    #[test]
    fn read_capabilities_are_not_mutating_and_writes_are() {
        assert!(!find("file.read").unwrap().mutates);
        assert!(find("file.write").unwrap().mutates);
        assert_eq!(find("file.write").unwrap().risk, RiskLevel::Medium);
        assert_eq!(
            find("file.write").unwrap().reversibility,
            Reversibility::ViaGit
        );
    }

    #[test]
    fn unknown_capability_is_none() {
        assert!(find("does.not_exist").is_none());
    }
}
