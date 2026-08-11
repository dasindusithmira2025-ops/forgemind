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

use super::model::{CapabilityDomain, CapabilityEffectClass, Reversibility, RiskLevel};
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
    /// Typed effect boundary enforced by policy for Database Studio execution envelopes.
    pub effect_class: CapabilityEffectClass,
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
    let mut descriptors = vec![
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
            effect_class: CapabilityEffectClass::Read,
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
            effect_class: CapabilityEffectClass::Read,
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
            effect_class: CapabilityEffectClass::Read,
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
            effect_class: CapabilityEffectClass::Read,
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
            effect_class: CapabilityEffectClass::Read,
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
            effect_class: CapabilityEffectClass::RepositoryMutation,
            timeout_ms: 10_000,
            audited: true,
            available: true,
            unavailable_reason: None,
        },
    ];

    descriptors.extend(database_descriptors());
    descriptors
}

fn database_descriptor(
    id: &'static str,
    display_name: &'static str,
    arg_schema: Value,
    risk: RiskLevel,
    reversibility: Reversibility,
    effect_class: CapabilityEffectClass,
) -> CapabilityDescriptor {
    CapabilityDescriptor {
        id,
        display_name,
        domain: CapabilityDomain::Database,
        description:
            "Execute a typed Database Studio operation through the project-scoped backend.",
        arg_schema,
        requires_project_scope: true,
        risk,
        reversibility,
        mutates: effect_class != CapabilityEffectClass::Read,
        effect_class,
        timeout_ms: 30_000,
        audited: true,
        available: true,
        unavailable_reason: None,
    }
}

fn database_descriptors() -> Vec<CapabilityDescriptor> {
    let read = |id, name, schema| {
        database_descriptor(
            id,
            name,
            schema,
            RiskLevel::Low,
            Reversibility::NotApplicable,
            CapabilityEffectClass::Read,
        )
    };
    let design = |id, name, schema, risk, reversibility| {
        database_descriptor(
            id,
            name,
            schema,
            risk,
            reversibility,
            CapabilityEffectClass::DesignMutation,
        )
    };

    vec![
        read(
            "database.list_sources",
            "List database sources",
            json!({"type":"object","properties":{}}),
        ),
        read(
            "database.get_schema",
            "Get database schema",
            json!({"type":"object","required":["sourceId","layer","lod"],"properties":{"sourceId":{"type":"string"},"layer":{"type":"string"},"snapshotId":{"type":"string"},"designRevisionId":{"type":"string"},"lod":{"type":"string"}}}),
        ),
        read(
            "database.get_object",
            "Get database object",
            json!({"type":"object","required":["sourceId","objectId"],"properties":{"sourceId":{"type":"string"},"objectId":{"type":"string"},"snapshotId":{"type":"string"},"designRevisionId":{"type":"string"}}}),
        ),
        read(
            "database.compare",
            "Compare database schemas",
            json!({"type":"object","required":["mode"],"properties":{"mode":{"type":"object"}}}),
        ),
        read(
            "database.get_issues",
            "Get database issues",
            json!({"type":"object","required":["sourceId"],"properties":{"sourceId":{"type":"string"},"status":{"type":"string"},"severity":{"type":"string"}}}),
        ),
        read(
            "database.get_usage",
            "Get database usage",
            json!({"type":"object","required":["sourceId","objectId"],"properties":{"sourceId":{"type":"string"},"objectId":{"type":"string"},"limit":{"type":"integer"},"continuation":{"type":"string"}}}),
        ),
        read(
            "database.get_context_pack",
            "Build database context pack",
            json!({"type":"object","required":["sourceId","focus","budget"],"properties":{"sourceId":{"type":"string"},"focus":{"type":"object"},"budget":{"type":"object"}}}),
        ),
        read(
            "database.get_canvas_state",
            "Get database canvas state",
            json!({"type":"object","properties":{}}),
        ),
        read(
            "database.get_selection",
            "Get database selection",
            json!({"type":"object","properties":{}}),
        ),
        design(
            "database.create_draft",
            "Create database draft",
            json!({"type":"object","required":["sourceId","base","name"],"properties":{"sourceId":{"type":"string"},"base":{"type":"object"},"name":{"type":"string"}}}),
            RiskLevel::Medium,
            Reversibility::Paired,
        ),
        design(
            "database.add_table",
            "Add database table",
            operation_schema("table"),
            RiskLevel::Medium,
            Reversibility::Paired,
        ),
        design(
            "database.rename_table",
            "Rename database table",
            operation_schema("tableId"),
            RiskLevel::Medium,
            Reversibility::Paired,
        ),
        design(
            "database.drop_table",
            "Drop database table",
            operation_schema("tableId"),
            RiskLevel::High,
            Reversibility::Paired,
        ),
        design(
            "database.add_column",
            "Add database column",
            operation_schema("column"),
            RiskLevel::Medium,
            Reversibility::Paired,
        ),
        design(
            "database.alter_column",
            "Alter database column",
            operation_schema("patch"),
            RiskLevel::High,
            Reversibility::Paired,
        ),
        design(
            "database.drop_column",
            "Drop database column",
            operation_schema("columnId"),
            RiskLevel::High,
            Reversibility::Paired,
        ),
        design(
            "database.add_relationship",
            "Add database relationship",
            operation_schema("relationship"),
            RiskLevel::Medium,
            Reversibility::Paired,
        ),
        design(
            "database.add_index",
            "Add database index",
            operation_schema("index"),
            RiskLevel::Medium,
            Reversibility::Paired,
        ),
        design(
            "database.approve_design",
            "Approve database design",
            decision_schema(true),
            RiskLevel::High,
            Reversibility::None,
        ),
        design(
            "database.reject_design",
            "Reject database design",
            decision_schema(true),
            RiskLevel::Medium,
            Reversibility::None,
        ),
        design(
            "database.archive_design",
            "Archive database design",
            decision_schema(false),
            RiskLevel::Medium,
            Reversibility::Paired,
        ),
        database_descriptor(
            "database.implement_design",
            "Implement database design",
            json!({"type":"object","required":["designId","approvedRevisionId"],"properties":{"designId":{"type":"string"},"approvedRevisionId":{"type":"string"}}}),
            RiskLevel::High,
            Reversibility::ViaGit,
            CapabilityEffectClass::RepositoryMutation,
        ),
        database_descriptor(
            "database.introspect_sqlite_file",
            "Introspect SQLite file",
            json!({"type":"object","required":["sourceId","projectRelativePath","explicitUserConsent"],"properties":{"sourceId":{"type":"string"},"projectRelativePath":{"type":"string"},"explicitUserConsent":{"type":"boolean","const":true}}}),
            RiskLevel::Medium,
            Reversibility::NotApplicable,
            CapabilityEffectClass::DatabaseMutation,
        ),
    ]
}

fn operation_schema(required_payload: &'static str) -> Value {
    json!({"type":"object","required":["designId","concurrency",required_payload],"properties":{"designId":{"type":"string"},"concurrency":{"type":"object"}}})
}

fn decision_schema(with_reason: bool) -> Value {
    let mut required = vec!["designId", "concurrency"];
    if with_reason {
        required.push("reason");
    }
    json!({"type":"object","required":required,"properties":{"designId":{"type":"string"},"concurrency":{"type":"object"},"reason":{"type":"string"}}})
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
