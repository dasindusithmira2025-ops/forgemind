//! Mission Preflight and planning (master spec §22).
//!
//! Planning is a separate concern from execution, and Preflight is a separate concern from
//! planning. The order matters: Paralith answers *what does it already know about this Project*
//! before it decides *what work to do*, so a plan is grounded in the code graph, Memory and real
//! repository state rather than in the objective sentence alone.
//!
//! This module retrieves nothing itself. Every finding comes from a subsystem that already owns
//! that knowledge — Project Graph, Impact Intelligence, Memory, the Repository control plane and
//! the Context Fabric — and each group of findings carries the source that produced it. A
//! subsystem with nothing to say produces an *available: false* provenance entry rather than an
//! empty list, so "asked and found nothing" is distinguishable from "never asked".

use crate::errors::{AppError, AppResult};
use crate::models::context::ContextRequest;
use crate::models::memory::SearchMemoryRequest;
use crate::models::mission::*;
use crate::models::vnext::CompiledContextPack;
use crate::services::{CodeIntelligence, ContextCompiler, MemoryService, RepositoryService};
use std::collections::BTreeSet;
use std::sync::Arc;
use uuid::Uuid;

/// Ceilings on how much Preflight retains. Preflight is a briefing, not an index dump: past this
/// it stops helping a planner and starts costing tokens.
const MAX_LIKELY_FILES: usize = 24;
const MAX_COMPONENTS: usize = 12;
const MAX_MEMORIES: usize = 10;
const MAX_TEST_AREAS: usize = 12;
const MAX_CHANGED_FILES: usize = 20;

/// Words that carry no retrieval signal. Kept small and deliberately English-agnostic about
/// domain vocabulary: over-filtering a query is worse than under-filtering it.
const STOP_WORDS: &[&str] = &[
    "the", "and", "for", "with", "without", "that", "this", "from", "into", "over", "under",
    "should", "must", "will", "when", "while", "then", "than", "have", "has", "does", "not", "but",
    "add", "adds", "added", "make", "makes", "use", "using", "used", "also", "our", "their", "its",
    "can", "could", "would", "please", "need", "needs", "want", "wants", "existing", "current",
    "new", "all", "any", "each", "every", "only", "just", "still", "keep", "keeps", "break",
    "breaking", "work", "works", "working",
];

pub struct MissionPlanner {
    code: CodeIntelligence,
    memory: MemoryService,
    repository: Arc<RepositoryService>,
    context: ContextCompiler,
}

impl MissionPlanner {
    pub fn new(
        code: CodeIntelligence,
        memory: MemoryService,
        repository: Arc<RepositoryService>,
        context: ContextCompiler,
    ) -> Self {
        Self {
            code,
            memory,
            repository,
            context,
        }
    }

    /// Gather everything Paralith should know before planning this Mission.
    ///
    /// Every source is optional in the sense that a Project may not have it — an unindexed
    /// repository, an empty Memory, a non-Git folder. None of those is an error: Preflight
    /// records that the source was unavailable and carries on, because refusing to plan a
    /// Mission because the code index is cold would be a worse product than planning with less.
    pub fn preflight(&self, mission: &Mission) -> AppResult<MissionPreflight> {
        let terms = search_terms(&mission.objective, &mission.title);
        let mut provenance: Vec<MissionPreflightProvenance> = Vec::new();

        // --- Project Graph -------------------------------------------------------------------
        let mut likely_files: BTreeSet<String> = BTreeSet::new();
        let mut components: BTreeSet<String> = BTreeSet::new();
        let mut graph_hits = 0usize;
        let graph_available = self
            .code
            .state(&mission.project_id)
            .map(|state| state.files_indexed > 0)
            .unwrap_or(false);
        if graph_available {
            for term in &terms {
                let Ok(symbols) = self
                    .code
                    .search_symbols(&mission.project_id, term, None, 24)
                else {
                    continue;
                };
                graph_hits += symbols.len();
                for symbol in symbols {
                    likely_files.insert(symbol.path.clone());
                    if let Some(component) = component_of(&symbol.path) {
                        components.insert(component);
                    }
                }
            }
        }
        provenance.push(MissionPreflightProvenance {
            source: "project_graph".into(),
            detail: if graph_available {
                format!(
                    "{graph_hits} symbol match(es) across {} file(s)",
                    likely_files.len()
                )
            } else {
                "The code graph has not indexed this Project yet.".into()
            },
            available: graph_available,
        });

        // --- Impact Intelligence -------------------------------------------------------------
        // Dependents of the files the graph pointed at. This is the difference between "the
        // Mission touches auth.rs" and "the Mission touches auth.rs and the eleven modules that
        // import it".
        let seeds: Vec<String> = likely_files.iter().take(6).cloned().collect();
        let mut dependents = 0usize;
        let mut risk_findings: Vec<String> = Vec::new();
        for seed in &seeds {
            let Ok(impact) = self.code.impact(&mission.project_id, seed, 2) else {
                continue;
            };
            dependents += impact.direct_dependents.len() + impact.transitive_dependents.len();
            for path in impact
                .direct_dependents
                .iter()
                .chain(impact.transitive_dependents.iter())
                .take(MAX_LIKELY_FILES)
            {
                likely_files.insert(path.clone());
                if let Some(component) = component_of(path) {
                    components.insert(component);
                }
            }
            if impact.truncated {
                risk_findings.push(format!(
                    "{seed} has more dependents than Impact Intelligence returned; the blast radius is larger than this list."
                ));
            }
        }
        provenance.push(MissionPreflightProvenance {
            source: "impact_intelligence".into(),
            detail: if seeds.is_empty() {
                "No seed files to expand from.".into()
            } else {
                format!(
                    "{dependents} dependent reference(s) from {} seed file(s)",
                    seeds.len()
                )
            },
            available: !seeds.is_empty(),
        });

        // --- Tests ---------------------------------------------------------------------------
        let test_areas: Vec<String> = likely_files
            .iter()
            .filter(|path| looks_like_test(path))
            .take(MAX_TEST_AREAS)
            .cloned()
            .collect();

        // --- Memory --------------------------------------------------------------------------
        let mut memories: Vec<MissionPreflightReference> = Vec::new();
        let memory_query = terms.join(" ");
        let memory_available = !memory_query.trim().is_empty();
        if memory_available {
            if let Ok(hits) = self.memory.search(&SearchMemoryRequest {
                project_id: mission.project_id.clone(),
                query: memory_query.clone(),
                limit: Some(MAX_MEMORIES),
            }) {
                memories = hits
                    .into_iter()
                    .map(|hit| MissionPreflightReference {
                        id: hit.summary.id,
                        title: hit.summary.title,
                        kind: hit.summary.memory_type,
                        // A stale memory is still worth surfacing, clearly labelled. Hiding it
                        // would silently drop the very knowledge a planner most needs to question.
                        stale: hit.summary.stale_reason.is_some(),
                    })
                    .collect();
            }
        }
        provenance.push(MissionPreflightProvenance {
            source: "memory".into(),
            detail: format!("{} related memory item(s)", memories.len()),
            available: memory_available,
        });

        // --- Git -----------------------------------------------------------------------------
        let mut environment: Vec<String> = Vec::new();
        let mut related_changes: Vec<String> = Vec::new();
        let git = self
            .repository
            .inspect(&mission.project_id, None, None)
            .ok();
        if let Some(snapshot) = &git {
            environment.push(format!(
                "Branch {}",
                snapshot.branch.clone().unwrap_or_else(|| "detached".into())
            ));
            environment.push(format!("HEAD {}", short_sha(&snapshot.head_sha)));
            if snapshot.files.is_empty() {
                environment.push("Working tree clean".into());
            } else {
                environment.push(format!(
                    "{} uncommitted change(s) in the working tree",
                    snapshot.files.len()
                ));
                // A dirty tree is a real planning risk: isolated worktrees branch from HEAD, so
                // uncommitted work is invisible to every Task this Mission launches.
                risk_findings.push(
                    "The working tree has uncommitted changes. Task worktrees branch from HEAD, so that work will not be visible to any agent."
                        .into(),
                );
            }
            related_changes = snapshot
                .files
                .iter()
                .map(|file| file.path.clone())
                .take(MAX_CHANGED_FILES)
                .collect();
        }
        provenance.push(MissionPreflightProvenance {
            source: "git".into(),
            detail: match &git {
                Some(snapshot) => format!(
                    "{} tracked change(s) on {}",
                    snapshot.files.len(),
                    snapshot.branch.clone().unwrap_or_else(|| "detached".into())
                ),
                None => "This Project is not a Git repository Paralith can inspect.".into(),
            },
            available: git.is_some(),
        });

        // --- Context Fabric ------------------------------------------------------------------
        // One planning pack, compiled by the Fabric. Preflight stores its identity, never its
        // contents: a copy would go stale independently of the knowledge it came from.
        let focus: Vec<String> = likely_files.iter().take(12).cloned().collect();
        let pack = self.context.compile_cached(&ContextRequest {
            project_id: mission.project_id.clone(),
            task: mission.objective.clone(),
            focus_files: focus,
            mission: Some(mission.objective.clone()),
            semantic: Some(true),
            ..ContextRequest::default()
        });
        let planning_context_pack_id = match &pack {
            Ok(pack) => {
                let compiled = CompiledContextPack {
                    id: Uuid::new_v4().to_string(),
                    project_id: mission.project_id.clone(),
                    task_id: mission.id.clone(),
                    agent_run_id: mission.id.clone(),
                    compiler_version: pack.compiler_version.clone(),
                    created_at: pack.compiled_at.clone(),
                    pack: pack.clone(),
                };
                // A pack that reaches outside the Project is a containment failure, not a context
                // quality problem. Refuse it here rather than let it inform a plan.
                compiled.validate_scope().map_err(|message| {
                    AppError::new("context_scope_invalid", message, false).entity(&mission.id)
                })?;
                Some(compiled.id)
            }
            Err(_) => None,
        };
        provenance.push(MissionPreflightProvenance {
            source: "context_fabric".into(),
            detail: match &pack {
                Ok(pack) => format!("{} context section(s) compiled", pack.sections.len()),
                Err(error) => format!("Context could not be compiled: {}", error.code),
            },
            available: pack.is_ok(),
        });

        for constraint in &mission.constraints {
            risk_findings.push(format!("Constraint to preserve: {constraint}"));
        }
        for risk in &mission.risks {
            risk_findings.push(risk.clone());
        }

        let likely_files: Vec<String> = likely_files.into_iter().take(MAX_LIKELY_FILES).collect();
        let components: Vec<String> = components.into_iter().take(MAX_COMPONENTS).collect();
        let estimated_impact = estimate_impact(likely_files.len(), dependents, &risk_findings);
        let summary = format!(
            "{} component(s), {} likely file(s), {} related memory item(s), {} test area(s).",
            components.len(),
            likely_files.len(),
            memories.len(),
            test_areas.len()
        );

        Ok(MissionPreflight {
            mission_id: mission.id.clone(),
            project_id: mission.project_id.clone(),
            status: MissionPreflightStatus::Completed,
            summary,
            relevant_components: components,
            likely_files,
            architecture_memories: memories,
            related_changes,
            test_areas,
            environment,
            risk_findings,
            estimated_impact,
            planning_context_pack_id,
            provenance,
            error_code: None,
            error_message: None,
            created_at: String::new(),
            updated_at: String::new(),
        })
    }

    /// Decompose a Mission locally, from its intent and its Preflight.
    ///
    /// This is deliberately not an LLM. It costs nothing, always succeeds, and produces a plan a
    /// person can read and edit before anything executes — which is exactly what a Mission needs
    /// before the expensive part starts. `MissionPlanningMode::Agent` exists for the cases where
    /// a model genuinely decomposes better, and it runs through the Run Engine like all other
    /// agent work.
    ///
    /// The shape is honest about what it knows: implementation, then coverage, then integration
    /// — and integration only when there is more than one parallel implementation strand to
    /// integrate. It does not invent a five-phase plan for a one-line change.
    pub fn deterministic_plan(mission: &Mission, preflight: &MissionPreflight) -> MissionPlanDraft {
        let mut criteria = vec![MissionPlanCriterion {
            key: "AC-01".into(),
            title: first_sentence(&mission.objective),
            description: mission.objective.clone(),
            kind: AcceptanceCriterionKind::Behavioral,
            required: true,
            verification_hint: mission.verification_plan.clone(),
        }];
        // Every constraint the user stated is an acceptance condition. A constraint that is not
        // checkable is a wish; making it a criterion is what turns "don't break login" into
        // something the Proof Ledger can eventually attach evidence to.
        for (index, constraint) in mission.constraints.iter().enumerate() {
            criteria.push(MissionPlanCriterion {
                key: format!("AC-{:02}", index + 2),
                title: constraint.clone(),
                description: format!("This must remain true after the Mission: {constraint}"),
                kind: AcceptanceCriterionKind::Behavioral,
                required: true,
                verification_hint: None,
            });
        }
        if !preflight.test_areas.is_empty() {
            criteria.push(MissionPlanCriterion {
                key: format!("AC-{:02}", criteria.len() + 1),
                title: "Existing tests still pass".into(),
                description: format!(
                    "The Mission must not regress the existing suites covering {}.",
                    preflight.test_areas.join(", ")
                ),
                kind: AcceptanceCriterionKind::Automated,
                required: true,
                verification_hint: None,
            });
        }
        let criterion_keys: Vec<String> = criteria.iter().map(|item| item.key.clone()).collect();

        // Group the likely files into independent strands, so genuinely separate areas can be
        // worked in parallel isolated worktrees. Files in the same component are one strand:
        // splitting them would create conflicting writes for no benefit.
        let strands = implementation_strands(preflight);
        let mut tasks: Vec<MissionPlanTask> = Vec::new();
        let mut implementation_keys: Vec<String> = Vec::new();

        if strands.is_empty() {
            tasks.push(MissionPlanTask {
                key: "T1".into(),
                title: first_sentence(&mission.objective),
                objective: mission.objective.clone(),
                description: None,
                depends_on: Vec::new(),
                criteria: criterion_keys.clone(),
                focus_files: preflight.likely_files.clone(),
                execution_mode: None,
                provider_id: None,
                model_id: None,
                isolation: None,
                risk_level: Some(preflight.estimated_impact),
            });
            implementation_keys.push("T1".into());
        } else {
            for (index, strand) in strands.iter().enumerate() {
                let key = format!("T{}", index + 1);
                tasks.push(MissionPlanTask {
                    key: key.clone(),
                    title: format!("Implement in {}", strand.name),
                    objective: format!(
                        "{}\n\nWork on the {} area of the Project.",
                        mission.objective, strand.name
                    ),
                    description: None,
                    depends_on: Vec::new(),
                    criteria: criterion_keys.clone(),
                    focus_files: strand.files.clone(),
                    execution_mode: None,
                    provider_id: None,
                    model_id: None,
                    isolation: None,
                    risk_level: Some(preflight.estimated_impact),
                });
                implementation_keys.push(key);
            }
        }

        // Coverage, after implementation. Only when the Project actually has tests: proposing a
        // testing Task for a Project with no suites is a plan step that cannot succeed.
        if !preflight.test_areas.is_empty() {
            let key = format!("T{}", tasks.len() + 1);
            tasks.push(MissionPlanTask {
                key: key.clone(),
                title: "Cover the change with tests".into(),
                objective: format!(
                    "Add or update automated coverage for this Mission and run the affected suites.\n\nMission objective: {}",
                    mission.objective
                ),
                description: None,
                depends_on: implementation_keys.clone(),
                criteria: criterion_keys.clone(),
                focus_files: preflight.test_areas.clone(),
                execution_mode: None,
                provider_id: None,
                model_id: None,
                isolation: None,
                risk_level: Some(preflight.estimated_impact),
            });
            implementation_keys.push(key);
        }

        // Integration only earns a Task when there is more than one strand to integrate.
        if strands.len() > 1 {
            tasks.push(MissionPlanTask {
                key: format!("T{}", tasks.len() + 1),
                title: "Integrate the parallel work".into(),
                objective: format!(
                    "Reconcile the changes produced by the parallel Tasks into one coherent result and verify them together.\n\nMission objective: {}",
                    mission.objective
                ),
                description: None,
                depends_on: implementation_keys.clone(),
                criteria: criterion_keys.clone(),
                focus_files: Vec::new(),
                execution_mode: None,
                provider_id: None,
                model_id: None,
                isolation: None,
                risk_level: Some(preflight.estimated_impact),
            });
        }

        MissionPlanDraft {
            summary: format!(
                "{} implementation strand(s) from {} likely file(s).",
                strands.len().max(1),
                preflight.likely_files.len()
            ),
            criteria,
            tasks,
            risk_level: Some(preflight.estimated_impact),
        }
    }

    /// The instruction for a `MissionPlanningMode::Agent` planning Run.
    ///
    /// The agent is asked to write one file, in a fixed shape, using plan-local keys. It never
    /// names a database identifier, which is what keeps an untrusted planner from reaching
    /// anything it should not.
    pub fn planning_instruction(
        mission: &Mission,
        preflight: &MissionPreflight,
        plan_path: &str,
    ) -> String {
        let mut prompt = String::new();
        prompt.push_str("You are planning a Paralith Mission. Do not implement anything.\n\n");
        prompt.push_str("MISSION OBJECTIVE:\n");
        prompt.push_str(&mission.objective);
        prompt.push_str("\n\n");
        if !mission.constraints.is_empty() {
            prompt.push_str("CONSTRAINTS THAT MUST REMAIN TRUE:\n");
            for constraint in &mission.constraints {
                prompt.push_str("- ");
                prompt.push_str(constraint);
                prompt.push('\n');
            }
            prompt.push('\n');
        }
        if !mission.non_goals.is_empty() {
            prompt.push_str("EXPLICITLY OUT OF SCOPE:\n");
            for goal in &mission.non_goals {
                prompt.push_str("- ");
                prompt.push_str(goal);
                prompt.push('\n');
            }
            prompt.push('\n');
        }
        prompt.push_str("WHAT PARALITH ALREADY FOUND (preflight):\n");
        prompt.push_str(&preflight.summary);
        prompt.push('\n');
        for (label, values) in [
            ("Components", &preflight.relevant_components),
            ("Likely files", &preflight.likely_files),
            ("Test areas", &preflight.test_areas),
            ("Environment", &preflight.environment),
            ("Risks", &preflight.risk_findings),
        ] {
            if values.is_empty() {
                continue;
            }
            prompt.push_str(label);
            prompt.push_str(": ");
            prompt.push_str(&values.join(", "));
            prompt.push('\n');
        }
        prompt.push_str(&format!(
            "\nWrite your plan as JSON to `{plan_path}` and nothing else. Shape:\n\
             {{\"summary\":\"...\",\"riskLevel\":\"low|medium|high\",\
             \"criteria\":[{{\"key\":\"AC-01\",\"title\":\"...\",\"description\":\"...\",\
             \"kind\":\"behavioral|structural|automated|manual\",\"required\":true}}],\
             \"tasks\":[{{\"key\":\"T1\",\"title\":\"...\",\"objective\":\"...\",\
             \"dependsOn\":[\"T2\"],\"criteria\":[\"AC-01\"],\"focusFiles\":[\"src/x.rs\"]}}]}}\n\n\
             Rules: keys must be unique and stable; `dependsOn` and `criteria` may only reference \
             keys defined in this same plan; the dependency graph must be acyclic; every path in \
             `focusFiles` must be Project-relative. Prefer the smallest number of Tasks that can \
             genuinely be worked independently. Do not modify any other file."
        ));
        prompt
    }

    /// Parse an agent-authored plan.
    ///
    /// The output of a model is untrusted input. It is parsed into the same typed draft the
    /// deterministic planner produces and then goes through exactly the same validation, so an
    /// agent cannot persist a graph a person could not.
    pub fn parse_plan(raw: &str) -> AppResult<MissionPlanDraft> {
        let trimmed = extract_json(raw).ok_or_else(|| {
            AppError::new(
                "mission_plan_unparseable",
                "The planning agent did not produce a JSON plan.",
                true,
            )
            .layer("mission_planner")
        })?;
        let plan: MissionPlanDraft = serde_json::from_str(&trimmed).map_err(|error| {
            AppError::new(
                "mission_plan_unparseable",
                "The planning agent's plan could not be read.",
                true,
            )
            .detail(error.to_string())
            .layer("mission_planner")
        })?;
        if plan.tasks.is_empty() {
            return Err(AppError::new(
                "mission_plan_empty",
                "The planning agent produced no Tasks.",
                true,
            )
            .layer("mission_planner"));
        }
        Ok(plan)
    }

    /// Focus files a Task should compile context around, taken from the plan and bounded.
    pub(crate) fn task_focus_files(&self, task: &MissionTask) -> Vec<String> {
        task.focus_files.iter().take(16).cloned().collect()
    }
}

/// One independently workable area of the Project.
struct Strand {
    name: String,
    files: Vec<String>,
}

/// Group Preflight's likely files by top-level component.
///
/// Two strands only exist when the Mission genuinely spans two areas. Parallelism that costs more
/// coordination than it saves is not parallelism, so this caps at three and never splits a single
/// component — files that change together must be written by one agent in one worktree.
fn implementation_strands(preflight: &MissionPreflight) -> Vec<Strand> {
    let mut grouped: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for path in &preflight.likely_files {
        if looks_like_test(path) {
            continue;
        }
        let component = component_of(path).unwrap_or_else(|| "project".into());
        grouped.entry(component).or_default().push(path.clone());
    }
    if grouped.len() <= 1 {
        return Vec::new();
    }
    let mut strands: Vec<Strand> = grouped
        .into_iter()
        .map(|(name, files)| Strand { name, files })
        .collect();
    strands.sort_by_key(|strand| std::cmp::Reverse(strand.files.len()));
    strands.truncate(3);
    strands
}

/// The component a Project-relative path belongs to: its most meaningful directory segment.
fn component_of(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.len() < 2 {
        return None;
    }
    // Skip conventional container directories so `src/auth/session.rs` reports `auth`, not `src`.
    let skip = ["src", "lib", "app", "packages", "crates", "source"];
    let index = segments
        .iter()
        .position(|segment| !skip.contains(segment))
        .unwrap_or(0);
    let candidate = segments.get(index)?;
    if segments.len() - 1 == index {
        // The candidate is the file itself; the Mission touches a top-level file.
        return None;
    }
    Some((*candidate).to_string())
}

fn looks_like_test(path: &str) -> bool {
    let lower = path.to_ascii_lowercase().replace('\\', "/");
    lower.contains("/test")
        || lower.starts_with("test")
        || lower.contains("__tests__")
        || lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.ends_with("_test.rs")
        || lower.contains("/spec/")
}

/// Meaningful search terms from the Mission's own words.
fn search_terms(objective: &str, title: &str) -> Vec<String> {
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut terms: Vec<String> = Vec::new();
    for word in format!("{title} {objective}")
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .filter(|word| word.len() >= 4)
    {
        let lower = word.to_ascii_lowercase();
        if STOP_WORDS.contains(&lower.as_str()) || !seen.insert(lower.clone()) {
            continue;
        }
        terms.push(lower);
        if terms.len() == 8 {
            break;
        }
    }
    terms
}

/// Coarse impact, derived from how much of the Project the Mission reaches.
///
/// Deliberately a small number of observable inputs rather than a score: a risk level a person
/// cannot re-derive from what they are shown is not information, it is decoration.
fn estimate_impact(likely_files: usize, dependents: usize, risks: &[String]) -> MissionRisk {
    if likely_files >= 12 || dependents >= 40 || risks.len() >= 4 {
        MissionRisk::High
    } else if likely_files >= 4 || dependents >= 8 || !risks.is_empty() {
        MissionRisk::Medium
    } else {
        MissionRisk::Low
    }
}

fn first_sentence(text: &str) -> String {
    let candidate = text
        .split(['.', '\n'])
        .find(|part| !part.trim().is_empty())
        .unwrap_or(text)
        .trim();
    let mut title: String = candidate.chars().take(90).collect();
    if candidate.chars().count() > 90 {
        title.push('…');
    }
    if title.is_empty() {
        "Mission work".into()
    } else {
        title
    }
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(8).collect()
}

/// Pull the JSON object out of whatever the agent wrote around it. Providers wrap output in
/// fences and prose more often than not, and failing a plan over a code fence would be a bad
/// trade.
fn extract_json(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(trimmed[start..=end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preflight(files: Vec<&str>, tests: Vec<&str>, risks: Vec<&str>) -> MissionPreflight {
        MissionPreflight {
            mission_id: "mission".into(),
            project_id: "project".into(),
            status: MissionPreflightStatus::Completed,
            summary: String::new(),
            relevant_components: Vec::new(),
            likely_files: files.into_iter().map(str::to_owned).collect(),
            architecture_memories: Vec::new(),
            related_changes: Vec::new(),
            test_areas: tests.into_iter().map(str::to_owned).collect(),
            environment: Vec::new(),
            risk_findings: risks.into_iter().map(str::to_owned).collect(),
            estimated_impact: MissionRisk::Medium,
            planning_context_pack_id: None,
            provenance: Vec::new(),
            error_code: None,
            error_message: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn mission(objective: &str, constraints: Vec<&str>) -> Mission {
        Mission {
            id: "mission".into(),
            project_id: "project".into(),
            workspace_id: None,
            title: "Title".into(),
            objective: objective.into(),
            description: None,
            constraints: constraints.into_iter().map(str::to_owned).collect(),
            non_goals: Vec::new(),
            risks: Vec::new(),
            verification_plan: None,
            status: MissionStatus::Planning,
            status_reason: None,
            risk_level: MissionRisk::Medium,
            origin: MissionOrigin::Manual,
            created_by: "user".into(),
            planning_mode: MissionPlanningMode::Deterministic,
            execution_mode: MissionExecutionMode::AutoReadyTasks,
            default_provider_id: None,
            default_model_id: None,
            default_agent_profile_id: None,
            default_isolation: "isolated_worktree".into(),
            preflight_status: MissionPreflightStatus::Completed,
            plan_revision: 0,
            planning_run_id: None,
            failure_code: None,
            failure_message: None,
            accepted_by: None,
            accepted_at: None,
            created_at: "t".into(),
            updated_at: "t".into(),
            started_at: None,
            completed_at: None,
            cancelled_at: None,
        }
    }

    fn plan(mission: &Mission, preflight: &MissionPreflight) -> MissionPlanDraft {
        MissionPlanner::deterministic_plan(mission, preflight)
    }

    #[test]
    fn a_small_mission_gets_one_task_not_a_ceremony() {
        let draft = plan(
            &mission("Rename the login button label.", Vec::new()),
            &preflight(vec!["src/ui/Login.tsx"], Vec::new(), Vec::new()),
        );
        assert_eq!(draft.tasks.len(), 1);
        assert_eq!(draft.tasks[0].key, "T1");
        assert!(draft.tasks[0].depends_on.is_empty());
    }

    #[test]
    fn every_constraint_becomes_an_acceptance_criterion() {
        let draft = plan(
            &mission(
                "Add OAuth login.",
                vec!["Password login must keep working", "No new dependencies"],
            ),
            &preflight(vec!["src/auth/oauth.rs"], Vec::new(), Vec::new()),
        );
        let titles: Vec<&str> = draft
            .criteria
            .iter()
            .map(|criterion| criterion.title.as_str())
            .collect();
        assert!(titles.contains(&"Password login must keep working"));
        assert!(titles.contains(&"No new dependencies"));
        assert!(draft.criteria.iter().all(|criterion| criterion.required));
        // Keys must be unique: they are the identity a future Proof Ledger attaches evidence to.
        let mut keys: Vec<&str> = draft
            .criteria
            .iter()
            .map(|criterion| criterion.key.as_str())
            .collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), draft.criteria.len());
    }

    #[test]
    fn independent_components_become_parallel_tasks_with_an_integration_step() {
        let draft = plan(
            &mission("Add OAuth login.", Vec::new()),
            &preflight(
                vec![
                    "src/auth/oauth.rs",
                    "src/auth/session.rs",
                    "src/ui/Login.tsx",
                    "src/ui/Account.tsx",
                ],
                Vec::new(),
                Vec::new(),
            ),
        );
        let implementation: Vec<&MissionPlanTask> = draft
            .tasks
            .iter()
            .filter(|task| task.depends_on.is_empty())
            .collect();
        assert_eq!(
            implementation.len(),
            2,
            "two components must be workable in parallel"
        );
        let integration = draft.tasks.last().unwrap();
        assert_eq!(integration.title, "Integrate the parallel work");
        assert_eq!(integration.depends_on.len(), 2);
    }

    #[test]
    fn a_single_component_never_gets_an_integration_task() {
        let draft = plan(
            &mission("Fix session expiry.", Vec::new()),
            &preflight(
                vec!["src/auth/oauth.rs", "src/auth/session.rs"],
                Vec::new(),
                Vec::new(),
            ),
        );
        assert!(!draft
            .tasks
            .iter()
            .any(|task| task.title == "Integrate the parallel work"));
    }

    #[test]
    fn a_test_task_is_planned_only_when_the_project_has_tests() {
        let without = plan(
            &mission("Fix session expiry.", Vec::new()),
            &preflight(vec!["src/auth/session.rs"], Vec::new(), Vec::new()),
        );
        assert!(!without
            .tasks
            .iter()
            .any(|task| task.title == "Cover the change with tests"));

        let with = plan(
            &mission("Fix session expiry.", Vec::new()),
            &preflight(
                vec!["src/auth/session.rs"],
                vec!["tests/auth_test.rs"],
                Vec::new(),
            ),
        );
        let coverage = with
            .tasks
            .iter()
            .find(|task| task.title == "Cover the change with tests")
            .expect("a Project with tests gets a coverage Task");
        assert_eq!(coverage.depends_on, vec!["T1".to_string()]);
    }

    #[test]
    fn the_generated_plan_always_forms_a_valid_dag() {
        let draft = plan(
            &mission("Add OAuth login.", vec!["Password login must keep working"]),
            &preflight(
                vec![
                    "src/auth/oauth.rs",
                    "src/auth/session.rs",
                    "src/ui/Login.tsx",
                    "src/api/routes.rs",
                ],
                vec!["tests/auth_test.rs"],
                Vec::new(),
            ),
        );
        // Rebuild the plan as domain rows and run the real graph validator over it.
        let tasks: Vec<MissionTask> = draft
            .tasks
            .iter()
            .enumerate()
            .map(|(index, task)| MissionTask {
                id: task.key.clone(),
                mission_id: "mission".into(),
                project_id: "project".into(),
                key: task.key.clone(),
                title: task.title.clone(),
                objective: task.objective.clone(),
                description: None,
                focus_files: Vec::new(),
                status: MissionTaskStatus::Planned,
                status_reason: None,
                sequence: index as i64,
                risk_level: MissionRisk::Low,
                execution_mode: MissionTaskExecutionMode::SingleAgent,
                provider_id: None,
                model_id: None,
                agent_profile_id: None,
                isolation: None,
                blocker_kind: None,
                blocker_message: None,
                required_action: None,
                current_run_id: None,
                attempt_count: 0,
                created_at: "t".into(),
                updated_at: "t".into(),
                started_at: None,
                completed_at: None,
            })
            .collect();
        let edges: Vec<MissionTaskDependency> = draft
            .tasks
            .iter()
            .flat_map(|task| {
                task.depends_on
                    .iter()
                    .map(|dependency| MissionTaskDependency {
                        mission_id: "mission".into(),
                        task_id: task.key.clone(),
                        depends_on_task_id: dependency.clone(),
                    })
            })
            .collect();
        validate_dependency_graph("mission", &tasks, &edges)
            .expect("the planner must never emit a graph the scheduler cannot run");
    }

    #[test]
    fn impact_rises_with_reach_rather_than_being_asserted() {
        assert_eq!(estimate_impact(1, 0, &[]), MissionRisk::Low);
        assert_eq!(estimate_impact(5, 0, &[]), MissionRisk::Medium);
        assert_eq!(estimate_impact(20, 0, &[]), MissionRisk::High);
        assert_eq!(estimate_impact(1, 60, &[]), MissionRisk::High);
    }

    #[test]
    fn search_terms_drop_noise_and_keep_domain_words() {
        let terms = search_terms(
            "Add Google and GitHub OAuth without breaking the existing password login",
            "OAuth",
        );
        assert!(terms.contains(&"oauth".to_string()));
        assert!(terms.contains(&"google".to_string()));
        assert!(terms.contains(&"password".to_string()));
        assert!(!terms.contains(&"without".to_string()));
        assert!(!terms.contains(&"existing".to_string()));
        assert!(terms.len() <= 8);
    }

    #[test]
    fn a_component_is_the_meaningful_directory_not_the_container() {
        assert_eq!(component_of("src/auth/session.rs").as_deref(), Some("auth"));
        assert_eq!(
            component_of("packages/web/ui/Button.tsx").as_deref(),
            Some("web")
        );
        assert_eq!(component_of("README.md"), None);
        assert_eq!(component_of("src/main.rs"), None);
    }

    #[test]
    fn an_agent_plan_survives_the_prose_and_fences_providers_wrap_it_in() {
        let raw = "Here is the plan:\n```json\n{\"tasks\":[{\"key\":\"T1\",\"title\":\"Do it\"}]}\n```\nDone.";
        let plan = MissionPlanner::parse_plan(raw).unwrap();
        assert_eq!(plan.tasks.len(), 1);
        assert_eq!(plan.tasks[0].key, "T1");
    }

    #[test]
    fn an_agent_plan_that_is_not_a_plan_is_rejected_rather_than_guessed_at() {
        assert_eq!(
            MissionPlanner::parse_plan("I could not do this.")
                .unwrap_err()
                .code,
            "mission_plan_unparseable"
        );
        assert_eq!(
            MissionPlanner::parse_plan("{\"tasks\":[]}")
                .unwrap_err()
                .code,
            "mission_plan_empty"
        );
    }

    #[test]
    fn the_planning_instruction_names_the_output_file_and_forbids_implementation() {
        let instruction = MissionPlanner::planning_instruction(
            &mission("Add OAuth login.", vec!["Keep password login"]),
            &preflight(vec!["src/auth/oauth.rs"], Vec::new(), Vec::new()),
            ".paralith/mission-plan.json",
        );
        assert!(instruction.contains("Do not implement anything."));
        assert!(instruction.contains(".paralith/mission-plan.json"));
        assert!(instruction.contains("Keep password login"));
        assert!(instruction.contains("acyclic"));
    }
}
