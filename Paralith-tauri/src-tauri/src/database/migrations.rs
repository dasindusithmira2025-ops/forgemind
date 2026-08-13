use crate::errors::{AppError, AppResult};
use rusqlite::{params, Connection};

pub const CURRENT_SCHEMA_VERSION: i64 = 30;

const MIGRATION_1: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE projects(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
  canonical_root_path TEXT NOT NULL UNIQUE, git_branch TEXT,
  detected_framework TEXT, package_manager TEXT, major_languages_json TEXT NOT NULL DEFAULT '[]',
  is_git_repository INTEGER NOT NULL, has_package_json INTEGER NOT NULL, has_lockfile INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL
);
CREATE TABLE workspaces(
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, layout_json TEXT NOT NULL, active_pane_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT NOT NULL,
  removed_from_recent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE workspace_panes(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL, provider_type TEXT NOT NULL, executable_path TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]', shell_profile_id TEXT, working_directory TEXT NOT NULL,
  position_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE terminal_sessions(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL, provider_type TEXT NOT NULL, title TEXT NOT NULL,
  working_directory TEXT NOT NULL, status TEXT NOT NULL, process_id INTEGER,
  started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, output_tail BLOB, log_path TEXT
);
CREATE TABLE agent_detections(
  provider_type TEXT PRIMARY KEY, executable_path TEXT, version TEXT, available INTEGER NOT NULL,
  error_code TEXT, error_message TEXT, detected_at TEXT NOT NULL
);
CREATE TABLE shell_profiles(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, executable_path TEXT NOT NULL, args_json TEXT NOT NULL,
  available INTEGER NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE workspace_events(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_workspaces_recent ON workspaces(last_opened_at DESC);
CREATE INDEX idx_panes_workspace ON workspace_panes(workspace_id, position_order);
CREATE INDEX idx_sessions_workspace ON terminal_sessions(workspace_id, started_at DESC);
"#;

// Historical builds could start terminal sessions before a workspace row was committed.
// Rebuild the table without that timing-sensitive foreign key (SQLite cannot drop it in
// place); workspace_id remains the durable grouping key for live and recorded sessions.
const MIGRATION_2: &str = r#"
CREATE TABLE terminal_sessions_rebuilt(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, pane_id TEXT NOT NULL,
  provider_type TEXT NOT NULL, title TEXT NOT NULL, working_directory TEXT NOT NULL,
  status TEXT NOT NULL, process_id INTEGER, started_at TEXT NOT NULL, ended_at TEXT,
  exit_code INTEGER, output_tail BLOB, log_path TEXT
);
INSERT INTO terminal_sessions_rebuilt
  SELECT id,workspace_id,pane_id,provider_type,title,working_directory,status,process_id,started_at,ended_at,exit_code,output_tail,log_path
  FROM terminal_sessions;
DROP TABLE terminal_sessions;
ALTER TABLE terminal_sessions_rebuilt RENAME TO terminal_sessions;
CREATE INDEX idx_sessions_workspace ON terminal_sessions(workspace_id, started_at DESC);
"#;

// Domain-model hardening. Adds Project recency, enforces one canonical Project per
// filesystem path, and enforces case-insensitive unique Workspace names within a Project.
// Legacy databases could hold duplicate Projects (an old `\\?\`-prefixed row alongside the
// normalized one) or duplicate Workspace names created by reconfiguration, so this step
// repairs the data before adding the constraints that would otherwise reject it.
const MIGRATION_3_DDL: &str = r#"
ALTER TABLE projects ADD COLUMN is_recent INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_pane ON terminal_sessions(pane_id, started_at DESC);
"#;

const MIGRATION_4: &str = r#"
BEGIN IMMEDIATE;

ALTER TABLE workspaces ADD COLUMN normalized_name TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN restore_behavior TEXT NOT NULL DEFAULT 'inherit';
UPDATE workspaces SET normalized_name=lower(trim(name)) WHERE normalized_name='';

ALTER TABLE workspace_panes ADD COLUMN profile_id TEXT;
ALTER TABLE workspace_panes ADD COLUMN working_directory_mode TEXT NOT NULL DEFAULT 'project_relative';

CREATE TABLE IF NOT EXISTS metadata_quarantine(
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason_code TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  quarantined_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_repair_history(
  id TEXT PRIMARY KEY,
  repair_code TEXT NOT NULL,
  affected_entity_type TEXT NOT NULL,
  affected_entity_id TEXT,
  detail_json TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE(repair_code, affected_entity_type, affected_entity_id)
);

INSERT INTO metadata_quarantine(id,entity_type,entity_id,reason_code,payload_json,quarantined_at)
SELECT lower(hex(randomblob(16))),'terminal_session',s.id,'orphaned_terminal_session',
       '{"workspaceId":"' || replace(s.workspace_id,'"','') || '","paneId":"' || replace(s.pane_id,'"','') || '"}',
       datetime('now')
FROM terminal_sessions s
LEFT JOIN workspaces w ON w.id=s.workspace_id
LEFT JOIN workspace_panes p ON p.id=s.pane_id AND p.workspace_id=s.workspace_id
WHERE w.id IS NULL OR p.id IS NULL;

ALTER TABLE terminal_sessions RENAME TO terminal_sessions_legacy;
CREATE TABLE terminal_sessions(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL REFERENCES workspace_panes(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  executable_path TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  status TEXT NOT NULL,
  process_id INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  output_tail BLOB NOT NULL DEFAULT X'',
  log_path TEXT,
  restoration_state TEXT NOT NULL DEFAULT 'not_requested',
  dropped_output_bytes INTEGER NOT NULL DEFAULT 0
);
INSERT INTO terminal_sessions(
  id,project_id,workspace_id,pane_id,provider_type,executable_path,args_json,title,
  working_directory,status,process_id,started_at,ended_at,exit_code,output_tail,log_path,
  restoration_state,dropped_output_bytes
)
SELECT s.id,w.project_id,s.workspace_id,s.pane_id,s.provider_type,p.executable_path,p.args_json,
       s.title,s.working_directory,
       CASE WHEN s.status IN ('running','terminating') THEN 'disconnected' ELSE s.status END,
       NULL,s.started_at,s.ended_at,s.exit_code,coalesce(s.output_tail,X''),s.log_path,
       CASE WHEN s.status IN ('running','terminating') THEN 'stale' ELSE 'not_requested' END,0
FROM terminal_sessions_legacy s
JOIN workspaces w ON w.id=s.workspace_id
JOIN workspace_panes p ON p.id=s.pane_id AND p.workspace_id=s.workspace_id;
DROP TABLE terminal_sessions_legacy;

CREATE TABLE agent_profiles(
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  name TEXT NOT NULL,
  executable_path TEXT NOT NULL,
  version TEXT,
  available INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_type, executable_path)
);
CREATE TABLE agent_sessions(
  terminal_session_id TEXT PRIMARY KEY REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL REFERENCES workspace_panes(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  provider_type TEXT NOT NULL,
  provider_session_id TEXT,
  transcript_path TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DROP INDEX IF EXISTS idx_workspaces_unique_name;
CREATE UNIQUE INDEX idx_workspaces_unique_normalized_name ON workspaces(project_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_projects_recent ON projects(is_recent,last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id,last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_panes_workspace ON workspace_panes(workspace_id,position_order);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON terminal_sessions(workspace_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_pane ON terminal_sessions(pane_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON terminal_sessions(status,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_provider ON agent_profiles(provider_type,available);

INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,datetime('now'));
PRAGMA user_version=4;
COMMIT;
"#;

// Sidebar reordering. Adds a durable, user-controlled Workspace order within a Project.
// Existing Workspaces are backfilled deterministically (most-recently-opened first, id as a
// stable tiebreak) so the first sidebar render matches the previous recency ordering.
// Idempotent: the column add is guarded and the backfill only touches the default zeros.
const MIGRATION_5: &str = r#"
BEGIN IMMEDIATE;
ALTER TABLE workspaces ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE workspaces SET sort_order = (
  SELECT COUNT(*) FROM workspaces peer
  WHERE peer.project_id = workspaces.project_id
    AND (peer.last_opened_at > workspaces.last_opened_at
         OR (peer.last_opened_at = workspaces.last_opened_at AND peer.id < workspaces.id))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_sort ON workspaces(project_id,sort_order);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,datetime('now'));
PRAGMA user_version=5;
COMMIT;
"#;

// Docking canvas. Adds an additive, nullable `canvas_json` blob that stores the floating pane
// layer + canvas metadata alongside the existing docked `layout_json`, plus a monotonic
// `layout_revision` used for optimistic-concurrency on canvas saves. Purely additive: pre-canvas
// Workspaces get NULL / 0 and continue to render from `layout_json` via a migration on load.
const MIGRATION_6: &str = r#"
BEGIN IMMEDIATE;
ALTER TABLE workspaces ADD COLUMN canvas_json TEXT;
ALTER TABLE workspaces ADD COLUMN layout_revision INTEGER NOT NULL DEFAULT 0;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(6,datetime('now'));
PRAGMA user_version=6;
COMMIT;
"#;

// Mission Control. The migration is additive and preserves every existing Project,
// Workspace, Pane, and Terminal Session row. Mission task workspaces are explicitly marked
// as system-owned so ordinary workspace lists remain unchanged.
const MIGRATION_7: &str = r#"
BEGIN IMMEDIATE;
ALTER TABLE workspaces ADD COLUMN system_kind TEXT NOT NULL DEFAULT 'user';
ALTER TABLE workspaces ADD COLUMN mission_id TEXT;

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  constraints_json TEXT NOT NULL DEFAULT '[]',
  reference_paths_json TEXT NOT NULL DEFAULT '[]',
  preferred_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  permission_profile TEXT NOT NULL,
  verification_profile_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mission_tasks (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  agent_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  role TEXT,
  status TEXT NOT NULL,
  working_directory TEXT,
  worktree_id TEXT,
  session_id TEXT,
  verification_profile_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  execution_lock TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE CASCADE,
  dependency_task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE RESTRICT,
  PRIMARY KEY(task_id,dependency_task_id),
  CHECK(task_id <> dependency_task_id)
);
CREATE TABLE IF NOT EXISTS task_acceptance_criteria (
  task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL REFERENCES acceptance_criteria(id) ON DELETE RESTRICT,
  PRIMARY KEY(task_id,criterion_id)
);
CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE RESTRICT,
  repository_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL UNIQUE,
  branch_name TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_branch TEXT,
  status TEXT NOT NULL,
  owner_marker_path TEXT NOT NULL,
  restore_ref TEXT,
  merge_commit TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mission_sessions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL,
  terminal_session_id TEXT REFERENCES terminal_sessions(id) ON DELETE SET NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  pane_id TEXT REFERENCES workspace_panes(id) ON DELETE SET NULL,
  worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL,
  working_directory TEXT NOT NULL,
  command TEXT NOT NULL,
  process_id INTEGER,
  external_session_id TEXT,
  transcript_path TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT,
  recovery_metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES mission_tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_checks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES verification_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  required INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  working_directory TEXT,
  continue_on_failure INTEGER NOT NULL DEFAULT 0,
  position_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES mission_tasks(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL REFERENCES verification_checks(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  exit_code INTEGER,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  output_excerpt TEXT,
  artifact_ids_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS evidence_records (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES mission_tasks(id) ON DELETE CASCADE,
  acceptance_criterion_id TEXT REFERENCES acceptance_criteria(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  source_path TEXT,
  command TEXT,
  artifact_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES mission_tasks(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_states (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES mission_tasks(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES mission_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  available_actions_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_contexts (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  architecture_summary TEXT,
  technology_stack_json TEXT NOT NULL DEFAULT '[]',
  important_paths_json TEXT NOT NULL DEFAULT '[]',
  conventions_json TEXT NOT NULL DEFAULT '[]',
  build_commands_json TEXT NOT NULL DEFAULT '[]',
  test_commands_json TEXT NOT NULL DEFAULT '[]',
  user_instructions_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_context_suggestions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  source_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_missions_project ON missions(project_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_mission ON mission_tasks(mission_id,priority,created_at);
CREATE INDEX IF NOT EXISTS idx_task_events ON task_events(mission_id,created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence_records(task_id,created_at);
CREATE INDEX IF NOT EXISTS idx_verification_results_task ON verification_results(task_id,started_at);
CREATE INDEX IF NOT EXISTS idx_recovery_mission ON recovery_states(mission_id,status);
CREATE INDEX IF NOT EXISTS idx_worktrees_task_attempt ON worktrees(task_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspaces_kind ON workspaces(project_id,system_kind);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(7,datetime('now'));
PRAGMA user_version=7;
COMMIT;
"#;

// Project-scoped durable Memory. Raw terminal output is deliberately excluded: captures are
// explicit, secret-filtered events and immutable revisions, with FTS over bounded chunks.
const MIGRATION_8: &str = r#"
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS memory_settings(
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_events(
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT,
  branch_name TEXT,
  worktree_id TEXT,
  pane_id TEXT,
  terminal_session_id TEXT,
  agent_session_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'processed',
  schema_version INTEGER NOT NULL DEFAULT 1,
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  correlation_id TEXT,
  causation_id TEXT,
  UNIQUE(project_id, content_hash)
);
CREATE TABLE IF NOT EXISTS memory_items(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  visibility TEXT NOT NULL DEFAULT 'project_shared',
  workspace_id TEXT,
  branch_name TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  current_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, dedup_key)
);
CREATE TABLE IF NOT EXISTS memory_revisions(
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  observed_at TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  superseded_at TEXT,
  content_hash TEXT NOT NULL,
  extraction_method TEXT NOT NULL DEFAULT 'deterministic',
  model_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(item_id, revision_number)
);
CREATE TABLE IF NOT EXISTS memory_sources(
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  branch_name TEXT,
  git_commit TEXT,
  worktree_id TEXT,
  workspace_id TEXT,
  pane_id TEXT,
  terminal_session_id TEXT,
  agent_session_id TEXT,
  event_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  excerpt TEXT,
  mime_type TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  UNIQUE(project_id, content_hash)
);
CREATE TABLE IF NOT EXISTS memory_revision_sources(
  revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,
  PRIMARY KEY(revision_id, source_id)
);
CREATE TABLE IF NOT EXISTS memory_chunks(
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  symbol_name TEXT,
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  language TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(revision_id, ordinal)
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  item_id UNINDEXED,
  project_id UNINDEXED,
  title,
  body,
  symbol_name,
  file_path,
  tokenize = 'unicode61'
);
CREATE INDEX IF NOT EXISTS idx_memory_events_project ON memory_events(project_id, sequence);
CREATE INDEX IF NOT EXISTS idx_memory_items_project ON memory_items(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_revisions_item ON memory_revisions(item_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_memory_sources_project ON memory_sources(project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_item ON memory_chunks(item_id);
CREATE TRIGGER IF NOT EXISTS memory_revisions_immutable
BEFORE UPDATE ON memory_revisions
FOR EACH ROW
WHEN OLD.title <> NEW.title
  OR OLD.body <> NEW.body
  OR OLD.content_hash <> NEW.content_hash
  OR OLD.revision_number <> NEW.revision_number
  OR OLD.item_id <> NEW.item_id
BEGIN
  SELECT RAISE(ABORT, 'memory_revisions are immutable');
END;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(8,datetime('now'));
PRAGMA user_version=8;
COMMIT;
"#;

// Mission ownership remains Project-rooted. The optional Workspace is context only.
const MIGRATION_9: &str = r#"
BEGIN IMMEDIATE;
ALTER TABLE missions ADD COLUMN origin_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(9,datetime('now'));
PRAGMA user_version=9;
COMMIT;
"#;

// Multi-Project session and multi-monitor Workspace placement. This is v10 because the live
// product already shipped Mission Control v7, Memory v8, and Mission origin context v9.
const MIGRATION_10: &str = r#"
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS open_project_sessions(
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 0,
  last_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  last_pane_id TEXT REFERENCES workspace_panes(id) ON DELETE SET NULL,
  expanded INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_placements(
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'attached' CHECK(mode IN ('attached','detached','background')),
  window_label TEXT,
  monitor_id TEXT,
  monitor_alias TEXT,
  pos_x INTEGER,
  pos_y INTEGER,
  width INTEGER,
  height INTEGER,
  maximized INTEGER NOT NULL DEFAULT 0,
  fullscreen INTEGER NOT NULL DEFAULT 0,
  placement_revision INTEGER NOT NULL DEFAULT 0,
  last_focus_at TEXT,
  preferred_monitor_id TEXT,
  CHECK((mode='detached' AND window_label IS NOT NULL) OR mode<>'detached')
);
CREATE TABLE IF NOT EXISTS monitor_aliases(
  monitor_key TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_open_project_sessions_active ON open_project_sessions(is_active);
UPDATE open_project_sessions
SET is_active=0
WHERE is_active=1
  AND project_id<>(SELECT project_id FROM open_project_sessions WHERE is_active=1 ORDER BY updated_at DESC, project_id LIMIT 1);
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_project ON open_project_sessions(is_active) WHERE is_active=1;
CREATE INDEX IF NOT EXISTS idx_workspace_placements_mode ON workspace_placements(mode);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(10,datetime('now'));
PRAGMA user_version=10;
COMMIT;
"#;

// AI Capacity Center. A self-contained, additive local usage model. It never stores prompt
// text, terminal input/output, Memory, Mission content, tokens, cookies, or credentials — only
// numeric usage aggregates and lifecycle metadata attributed to Project/Workspace/Mission/Agent
// Session ids. Every table is CREATE TABLE IF NOT EXISTS so a partial v11 build re-runs safely.
// Project attribution is a nullable id column so cross-Project isolation is a query concern, and
// the caller (usage service) always scopes by it.
const MIGRATION_11: &str = r#"
BEGIN IMMEDIATE;
-- Provider connectivity + last-known machine-readable reading (Verified/Observed source only).
CREATE TABLE IF NOT EXISTS usage_providers(
  provider TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  tracking_enabled INTEGER NOT NULL DEFAULT 1,
  connection_state TEXT NOT NULL DEFAULT 'unknown',
  last_reading_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
-- Subscription profiles / accounts + plans. Manual limits and reset rules live here. No secrets.
CREATE TABLE IF NOT EXISTS usage_profiles(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_label TEXT NOT NULL DEFAULT '',
  plan_label TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'agent_time',
  limit_value REAL,
  reset_rule TEXT NOT NULL DEFAULT 'rolling_5h',
  reset_anchor TEXT,
  is_unlimited INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  warn_threshold REAL NOT NULL DEFAULT 0.8,
  critical_threshold REAL NOT NULL DEFAULT 0.95,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, account_label)
);
-- Current usage windows (rolling 5h, daily, etc.) with the classified reset time.
CREATE TABLE IF NOT EXISTS usage_windows(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  profile_id TEXT REFERENCES usage_profiles(id) ON DELETE CASCADE,
  window_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  reset_at TEXT,
  reset_source TEXT NOT NULL DEFAULT 'estimated',
  confidence REAL NOT NULL DEFAULT 0.5,
  updated_at TEXT NOT NULL
);
-- Bounded historical aggregates. One row per persisted summary sample. NEVER raw content.
CREATE TABLE IF NOT EXISTS usage_snapshots(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  profile_id TEXT,
  project_id TEXT,
  workspace_id TEXT,
  mission_id TEXT,
  unit TEXT NOT NULL,
  used_value REAL,
  remaining_value REAL,
  limit_value REAL,
  window_type TEXT NOT NULL DEFAULT 'rolling_5h',
  reset_at TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  active_sessions INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL
);
-- Discrete observed activity derived from PARALITH Agent Session lifecycle. Metadata only.
CREATE TABLE IF NOT EXISTS usage_events(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  project_id TEXT,
  workspace_id TEXT,
  mission_id TEXT,
  agent_session_id TEXT,
  pane_id TEXT,
  unit TEXT NOT NULL DEFAULT 'agent_time',
  amount REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'observed',
  occurred_at TEXT NOT NULL
);
-- Observed reset boundaries (from provider readings or observed quiet-window inference).
CREATE TABLE IF NOT EXISTS usage_reset_observations(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  profile_id TEXT,
  window_type TEXT NOT NULL,
  observed_reset_at TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  recorded_at TEXT NOT NULL
);
-- Throttling / limit / availability / auth / threshold / manual-change events.
CREATE TABLE IF NOT EXISTS usage_limit_events(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  project_id TEXT,
  workspace_id TEXT,
  event_kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  detail TEXT NOT NULL,
  recommended_action TEXT,
  source TEXT NOT NULL DEFAULT 'observed',
  occurred_at TEXT NOT NULL
);
-- Alert preferences (single JSON row) + a dedup/cooldown ledger for raised alerts.
CREATE TABLE IF NOT EXISTS usage_alert_prefs(
  id INTEGER PRIMARY KEY CHECK(id=1),
  prefs_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_alerts(
  alert_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  recommended_action TEXT,
  first_raised_at TEXT NOT NULL,
  last_raised_at TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_time ON usage_snapshots(provider, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_project ON usage_snapshots(project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_time ON usage_events(provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_project ON usage_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_limit_events_time ON usage_limit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_reset_provider ON usage_reset_observations(provider, recorded_at DESC);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(11,datetime('now'));
PRAGMA user_version=11;
COMMIT;
"#;

pub fn apply(connection: &Connection) -> AppResult<()> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::database)?;
    if current < 1 {
        run_migration(connection, MIGRATION_1, 1)?;
    }
    if current < 2 {
        run_migration(connection, MIGRATION_2, 2)?;
    }
    if current < 3 {
        migrate_v3(connection)?;
    }
    if current < 4 {
        run_migration_batch(connection, MIGRATION_4, 4)?;
    }
    if current < 5 {
        run_migration_batch(connection, MIGRATION_5, 5)?;
    }
    if current < 6 {
        run_migration_batch(connection, MIGRATION_6, 6)?;
    }
    // Schema feature checks are intentional. An unsafe partial build used version 7 for the
    // placement tables; a version-only ladder would therefore skip Mission Control forever.
    if current < 7
        || !table_exists(connection, "missions")?
        || !column_exists(connection, "workspaces", "system_kind")?
    {
        migrate_v7(connection)?;
    }
    if current < 8 || !table_exists(connection, "memory_items")? {
        migrate_v8(connection)?;
    }
    if current < 9 || !column_exists(connection, "missions", "origin_workspace_id")? {
        migrate_v9(connection)?;
    }
    if current < 10
        || !table_exists(connection, "open_project_sessions")?
        || !table_exists(connection, "workspace_placements")?
    {
        migrate_v10(connection)?;
    } else if !column_exists(connection, "workspace_placements", "preferred_monitor_id")? {
        add_column_if_missing(
            connection,
            "workspace_placements",
            "preferred_monitor_id",
            "TEXT",
        )?;
        connection.execute("UPDATE workspace_placements SET preferred_monitor_id=monitor_id WHERE preferred_monitor_id IS NULL", []).map_err(AppError::database)?;
    }
    if current < 11 || !table_exists(connection, "usage_snapshots")? {
        migrate_v11(connection)?;
    }
    if current < 12
        || !column_exists(connection, "agent_sessions", "agent_state")?
        || !table_exists(connection, "pane_worktrees")?
    {
        migrate_v12(connection)?;
    }
    if current < 13 || !table_exists(connection, "repository_operations")? {
        migrate_v13(connection)?;
    }
    if current < 14
        || !column_exists(connection, "repository_sync_cursors", "error_message")?
        || !column_exists(connection, "repository_sync_cursors", "required_permission")?
        || !column_exists(connection, "repository_sync_cursors", "recovery_action")?
    {
        migrate_v14(connection)?;
    }
    if current < 15
        || !table_exists(connection, "swarms")?
        || !column_exists(connection, "swarms", "project_root")?
    {
        migrate_v15(connection)?;
    }
    if current < 16
        || !table_exists(connection, "swarm_role_allocations")?
        || !column_exists(connection, "swarm_agents", "allocation_id")?
    {
        migrate_v16(connection)?;
    }
    if current < 17
        || !table_exists(connection, "swarm_runtime_sessions")?
        || !table_exists(connection, "swarm_canvas_connections")?
        || !column_exists(connection, "swarm_agents", "display_name")?
    {
        migrate_v17(connection)?;
    }
    if current < 18 || !table_exists(connection, "swarm_context_packs")? {
        migrate_v18(connection)?;
    }
    if current < 19 || !column_exists(connection, "swarm_tasks", "repair_for_task_id")? {
        migrate_v19(connection)?;
    }
    if current < 20 || !table_exists(connection, "swarm_runtime_event_receipts")? {
        migrate_v20(connection)?;
    }
    if current < 21
        || !table_exists(connection, "swarm_runs")?
        || !table_exists(connection, "swarm_agent_runs")?
        || !table_exists(connection, "swarm_attention_requests")?
        || !column_exists(connection, "swarms", "revision")?
        || !column_exists(connection, "swarm_events", "sequence")?
    {
        migrate_v21(connection)?;
    }
    if current < 22 || !table_exists(connection, "orchestration_sessions")? {
        migrate_v22(connection)?;
    }
    if current < 23
        || !column_exists(connection, "swarm_role_allocations", "model_config_json")?
        || !column_exists(connection, "swarm_agents", "model_config_json")?
        || !column_exists(
            connection,
            "swarm_agent_runs",
            "execution_config_snapshot_json",
        )?
    {
        migrate_v23(connection)?;
    }
    if current < 24 || !table_exists(connection, "swarm_execution_defaults")? {
        migrate_v24(connection)?;
    }
    if current < 25
        || !table_exists(connection, "ai_usage_snapshots")?
        || !table_exists(connection, "ai_usage_file_checkpoints")?
    {
        migrate_v25(connection)?;
    }
    if current < 26 || !table_exists(connection, "repository_graph_nodes")? {
        migrate_v26(connection)?;
    }
    if current < 27
        || !column_exists(connection, "agent_sessions", "recovery_status")?
        || !column_exists(connection, "agent_sessions", "worktree_path")?
    {
        migrate_v27(connection)?;
    }
    if current < 28 || !table_exists(connection, "database_sources")? {
        migrate_v28(connection)?;
    }
    if current < 29 || !column_exists(connection, "database_sources", "relevance")? {
        migrate_v29(connection)?;
    }
    if current < 30 || !table_exists(connection, "ai_usage_daily")? {
        migrate_v30(connection)?;
    }
    Ok(())
}

pub fn requires_migration(connection: &Connection) -> AppResult<bool> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::database)?;
    Ok(current < CURRENT_SCHEMA_VERSION
        || !table_exists(connection, "missions")?
        || !table_exists(connection, "memory_items")?
        || !table_exists(connection, "open_project_sessions")?
        || !table_exists(connection, "workspace_placements")?
        || !table_exists(connection, "usage_snapshots")?
        || !table_exists(connection, "ai_usage_snapshots")?
        || !table_exists(connection, "ai_usage_file_checkpoints")?
        || !table_exists(connection, "ai_usage_daily")?
        || !column_exists(connection, "workspaces", "system_kind")?
        || !column_exists(connection, "missions", "origin_workspace_id")?
        || !column_exists(connection, "workspace_placements", "preferred_monitor_id")?
        || !column_exists(connection, "agent_sessions", "agent_state")?
        || !table_exists(connection, "pane_worktrees")?
        || !table_exists(connection, "repository_operations")?
        || !column_exists(connection, "repository_sync_cursors", "error_message")?
        || !column_exists(connection, "repository_sync_cursors", "required_permission")?
        || !column_exists(connection, "repository_sync_cursors", "recovery_action")?
        || !table_exists(connection, "swarms")?
        || !column_exists(connection, "swarms", "project_root")?
        || !table_exists(connection, "swarm_role_allocations")?
        || !column_exists(connection, "swarm_agents", "allocation_id")?
        || !table_exists(connection, "swarm_runtime_sessions")?
        || !table_exists(connection, "swarm_canvas_connections")?
        || !column_exists(connection, "swarm_agents", "display_name")?
        || !table_exists(connection, "swarm_context_packs")?
        || !column_exists(connection, "swarm_tasks", "repair_for_task_id")?
        || !table_exists(connection, "swarm_runtime_event_receipts")?
        || !table_exists(connection, "swarm_runs")?
        || !table_exists(connection, "swarm_agent_runs")?
        || !table_exists(connection, "swarm_attention_requests")?
        || !column_exists(connection, "swarms", "revision")?
        || !column_exists(connection, "swarm_events", "sequence")?
        || !table_exists(connection, "orchestration_sessions")?
        || !column_exists(connection, "swarm_role_allocations", "model_config_json")?
        || !column_exists(connection, "swarm_agents", "model_config_json")?
        || !column_exists(
            connection,
            "swarm_agent_runs",
            "execution_config_snapshot_json",
        )?
        || !table_exists(connection, "swarm_execution_defaults")?
        || !table_exists(connection, "repository_graph_nodes")?
        || !table_exists(connection, "database_sources")?
        || !column_exists(connection, "agent_sessions", "recovery_status")?
        || !column_exists(connection, "agent_sessions", "worktree_path")?
        || !column_exists(connection, "database_sources", "relevance")?)
}

fn migrate_v24(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection.execute_batch("CREATE TABLE IF NOT EXISTS swarm_execution_defaults(swarm_id TEXT PRIMARY KEY REFERENCES swarms(id) ON DELETE CASCADE,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);")?;
        record_migration(connection, 24)
    })();
    finish_migration_transaction(connection, result, 24)
}

/// Read-only AI usage cache. Values are sanitized summaries; the collector never stores a
/// provider path, transcript text, request id, account identity, or credential.
fn migrate_v25(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ai_usage_snapshots(
              provider TEXT PRIMARY KEY CHECK(provider IN ('claude','codex')),
              snapshot_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_usage_file_checkpoints(
              provider TEXT NOT NULL CHECK(provider IN ('claude','codex')),
              path_hash TEXT NOT NULL,
              checkpoint_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(provider,path_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_usage_file_checkpoints_updated
              ON ai_usage_file_checkpoints(provider,updated_at);
        "#,
        )?;
        record_migration(connection, 25)
    })();
    finish_migration_transaction(connection, result, 25)
}

fn migrate_v28(connection: &Connection) -> AppResult<()> {
    if table_exists(connection, "database_sources")? {
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(28,datetime('now'))",
                [],
            )
            .map_err(AppError::database)?;
        connection
            .pragma_update(None, "user_version", 28)
            .map_err(AppError::database)?;
        return Ok(());
    }
    connection
        .execute_batch(
            r#"
BEGIN IMMEDIATE;

CREATE TABLE database_sources (
  id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, logical_key TEXT NOT NULL,
  display_name TEXT NOT NULL, engine TEXT NOT NULL, owner_project_id TEXT,
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  discovered_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(repository_id, logical_key)
);
CREATE INDEX idx_database_sources_repository ON database_sources(repository_id, updated_at DESC);

CREATE TABLE database_source_evidence (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL, project_id TEXT, adapter_id TEXT NOT NULL,
  evidence_kind TEXT NOT NULL, relative_path TEXT NOT NULL, symbol_or_key TEXT,
  safe_value_fingerprint TEXT, source_hint TEXT, owner_signal REAL NOT NULL,
  consumer_signal REAL NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
  content_sha256 TEXT NOT NULL, extractor_version TEXT NOT NULL, discovered_at TEXT NOT NULL
);
CREATE INDEX idx_database_evidence_source ON database_source_evidence(source_id, relative_path);

CREATE TABLE database_snapshots (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('declared','observed','proposed')),
  adapter_id TEXT NOT NULL, git_revision TEXT, parent_snapshot_id TEXT REFERENCES database_snapshots(id),
  fingerprint TEXT NOT NULL, object_count INTEGER NOT NULL, edge_count INTEGER NOT NULL,
  extractor_version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX idx_database_snapshots_source_layer ON database_snapshots(source_id, layer, created_at DESC);

CREATE TABLE database_objects (
  id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  layer TEXT NOT NULL, object_kind TEXT NOT NULL,
  logical_key TEXT NOT NULL, qualified_name TEXT NOT NULL, parent_object_id TEXT,
  namespace_id TEXT, native_type TEXT, ordinal INTEGER, nullable INTEGER,
  payload_version INTEGER NOT NULL, typed_payload_json TEXT NOT NULL, content_fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL, discovered_at TEXT NOT NULL, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
  PRIMARY KEY(id, snapshot_id, design_revision_id),
  UNIQUE(id, snapshot_id, design_revision_id)
);
CREATE INDEX idx_database_objects_snapshot_kind ON database_objects(snapshot_id, object_kind, qualified_name);
CREATE INDEX idx_database_objects_revision_kind ON database_objects(design_revision_id, object_kind, qualified_name);

CREATE TABLE database_edges (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  source_object_id TEXT NOT NULL, target_object_id TEXT NOT NULL,
  edge_type TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
  UNIQUE(snapshot_id, design_revision_id, source_object_id, target_object_id, edge_type)
);
CREATE INDEX idx_database_edges_source_object ON database_edges(snapshot_id, design_revision_id, source_object_id);
CREATE INDEX idx_database_edges_target_object ON database_edges(snapshot_id, design_revision_id, target_object_id);

CREATE TABLE database_object_provenance (
  id TEXT PRIMARY KEY, object_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES database_source_evidence(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
  evidence_ref TEXT, extractor_version TEXT NOT NULL, observed_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> ''))
);
CREATE INDEX idx_database_provenance_object ON database_object_provenance(object_id, snapshot_id, design_revision_id);

CREATE TABLE database_designs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL, status TEXT NOT NULL, base_snapshot_id TEXT REFERENCES database_snapshots(id),
  base_revision_id TEXT, head_revision_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
  created_by_kind TEXT NOT NULL, created_by_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  approved_revision_id TEXT
);
CREATE INDEX idx_database_designs_source ON database_designs(source_id, updated_at DESC);

CREATE TABLE database_design_revisions (
  id TEXT PRIMARY KEY, design_id TEXT NOT NULL REFERENCES database_designs(id) ON DELETE CASCADE,
  parent_revision_id TEXT REFERENCES database_design_revisions(id),
  merge_parent_revision_id TEXT REFERENCES database_design_revisions(id),
  revision_number INTEGER NOT NULL, state TEXT NOT NULL, graph_fingerprint TEXT NOT NULL,
  created_by_kind TEXT NOT NULL, created_by_id TEXT, created_at TEXT NOT NULL,
  decision_by_kind TEXT, decision_by_id TEXT, decision_at TEXT, decision_reason TEXT,
  UNIQUE(design_id, revision_number)
);

CREATE TABLE database_design_operations (
  id TEXT PRIMARY KEY, design_id TEXT NOT NULL REFERENCES database_designs(id) ON DELETE CASCADE,
  base_revision_id TEXT NOT NULL REFERENCES database_design_revisions(id),
  result_revision_id TEXT NOT NULL REFERENCES database_design_revisions(id),
  sequence INTEGER NOT NULL, operation_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
  operation_payload_json TEXT NOT NULL,
  actor_kind TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(design_id, result_revision_id, sequence)
);

CREATE TABLE database_layouts (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  layout_kind TEXT NOT NULL,
  semantic_lod INTEGER NOT NULL, layout_fingerprint TEXT NOT NULL,
  viewport_json TEXT NOT NULL, positions_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
  UNIQUE(source_id, snapshot_id, design_revision_id, layout_kind, semantic_lod)
);

CREATE TABLE database_diffs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  comparison_mode TEXT NOT NULL, left_ref TEXT NOT NULL, right_ref TEXT NOT NULL,
  fingerprint TEXT NOT NULL, changes_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(source_id, comparison_mode, left_ref, right_ref, fingerprint)
);

CREATE TABLE database_issues (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  issue_code TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, explanation TEXT NOT NULL, status TEXT NOT NULL,
  detected_at TEXT NOT NULL, resolved_at TEXT,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> ''))
);
CREATE INDEX idx_database_issues_source_status ON database_issues(source_id, status, severity);

CREATE TABLE database_usage_refs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL, semantic_object_id TEXT, relative_path TEXT NOT NULL, symbol TEXT,
  start_line INTEGER, start_column INTEGER, end_line INTEGER, end_column INTEGER,
  access_kind TEXT NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
  content_sha256 TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE INDEX idx_database_usage_object ON database_usage_refs(source_id, semantic_object_id);
CREATE INDEX idx_database_usage_path ON database_usage_refs(project_id, relative_path);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(28, datetime('now'));
PRAGMA user_version=28;
COMMIT;
"#,
        )
        .map_err(AppError::database)
}

/// Database Studio classifies each discovered datasource by how much it looks like the database the
/// application actually runs on, so a repository's own test fixtures stop being presented as
/// first-class production databases. Existing rows keep the permissive default: a source discovered
/// before this migration was surfaced, and silently hiding it on upgrade would be a regression.
fn migrate_v29(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        add_column_if_missing(
            connection,
            "database_sources",
            "relevance",
            "TEXT NOT NULL DEFAULT 'application'",
        )?;
        record_migration(connection, 29)
    })();
    finish_migration_transaction(connection, result, 29)
}

/// Historical token analytics. `ai_usage_snapshots` only ever held the *current* subscription
/// quota per provider, which cannot answer "what did I consume over the last 30 days" — that
/// history is derived from provider transcripts and now persisted in its own aggregate table.
///
/// Only bucketed counters are stored: no transcript text, session ids, prompts, or file paths.
/// The primary key is the analytics grain itself, so a recomputation of the same day and model
/// can never accumulate a second row.
fn migrate_v30(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch(
            r#"
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS ai_usage_daily(
  provider TEXT NOT NULL,
  bucket_date TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(provider, bucket_date, model)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_date ON ai_usage_daily(bucket_date);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(30, datetime('now'));
PRAGMA user_version=30;
COMMIT;
"#,
        )
        .map_err(AppError::database)
}

fn table_exists(connection: &Connection, table: &str) -> AppResult<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )
        .map_err(AppError::database)
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(AppError::database)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(names.iter().any(|name| name == column))
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> AppResult<()> {
    if column_exists(connection, table, column)? {
        return Ok(());
    }
    connection
        .execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition};"
        ))
        .map_err(AppError::database)
}

/// Apply Mission Control even when a stale partial build already claimed version 7 for
/// unrelated placement tables. The DDL is derived from the canonical migration while the two
/// column additions are performed conditionally.
fn migrate_v7(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        add_column_if_missing(
            connection,
            "workspaces",
            "system_kind",
            "TEXT NOT NULL DEFAULT 'user'",
        )?;
        add_column_if_missing(connection, "workspaces", "mission_id", "TEXT")?;
        let body = MIGRATION_7
            .replace("BEGIN IMMEDIATE;", "")
            .replace(
                "ALTER TABLE workspaces ADD COLUMN system_kind TEXT NOT NULL DEFAULT 'user';",
                "",
            )
            .replace("ALTER TABLE workspaces ADD COLUMN mission_id TEXT;", "")
            .replace(
                "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(7,datetime('now'));",
                "",
            )
            .replace("PRAGMA user_version=7;", "")
            .replace("COMMIT;", "");
        connection
            .execute_batch(&body)
            .map_err(AppError::database)?;
        record_migration(connection, 7)
    })();
    finish_migration_transaction(connection, result, 7)
}

fn migrate_v9(connection: &Connection) -> AppResult<()> {
    debug_assert!(MIGRATION_9.contains("origin_workspace_id"));
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        add_column_if_missing(
            connection,
            "missions",
            "origin_workspace_id",
            "TEXT REFERENCES workspaces(id) ON DELETE SET NULL",
        )?;
        record_migration(connection, 9)
    })();
    finish_migration_transaction(connection, result, 9)
}

fn migrate_v8(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        let body = MIGRATION_8
            .replace("BEGIN IMMEDIATE;", "")
            .replace(
                "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(8,datetime('now'));",
                "",
            )
            .replace("PRAGMA user_version=8;", "")
            .replace("COMMIT;", "");
        connection
            .execute_batch(&body)
            .map_err(AppError::database)?;
        record_migration(connection, 8)
    })();
    finish_migration_transaction(connection, result, 8)
}

fn migrate_v10(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        let body = MIGRATION_10
            .replace("BEGIN IMMEDIATE;", "")
            .replace(
                "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(10,datetime('now'));",
                "",
            )
            .replace("PRAGMA user_version=10;", "")
            .replace("COMMIT;", "");
        connection
            .execute_batch(&body)
            .map_err(AppError::database)?;
        add_column_if_missing(
            connection,
            "workspace_placements",
            "preferred_monitor_id",
            "TEXT",
        )?;
        connection.execute("UPDATE workspace_placements SET preferred_monitor_id=monitor_id WHERE preferred_monitor_id IS NULL", []).map_err(AppError::database)?;
        record_migration(connection, 10)
    })();
    finish_migration_transaction(connection, result, 10)
}

fn migrate_v11(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        let body = MIGRATION_11
            .replace("BEGIN IMMEDIATE;", "")
            .replace(
                "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(11,datetime('now'));",
                "",
            )
            .replace("PRAGMA user_version=11;", "")
            .replace("COMMIT;", "");
        connection
            .execute_batch(&body)
            .map_err(AppError::database)?;
        record_migration(connection, 11)
    })();
    finish_migration_transaction(connection, result, 11)
}

fn migrate_v12(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        add_column_if_missing(
            connection,
            "agent_sessions",
            "agent_state",
            "TEXT NOT NULL DEFAULT 'working'",
        )?;
        add_column_if_missing(
            connection,
            "agent_sessions",
            "agent_state_source",
            "TEXT NOT NULL DEFAULT 'heuristic'",
        )?;
        add_column_if_missing(
            connection,
            "agent_sessions",
            "agent_state_reason",
            "TEXT NOT NULL DEFAULT 'session started'",
        )?;
        add_column_if_missing(
            connection,
            "agent_sessions",
            "agent_attention_since",
            "TEXT",
        )?;
        add_column_if_missing(
            connection,
            "agent_sessions",
            "agent_state_updated_at",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        connection.execute("UPDATE agent_sessions SET agent_state_updated_at=updated_at WHERE agent_state_updated_at=''", []).map_err(AppError::database)?;
        connection.execute("CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(workspace_id,agent_state,agent_state_updated_at DESC)", []).map_err(AppError::database)?;
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS pane_worktrees(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pane_id TEXT NOT NULL REFERENCES workspace_panes(id) ON DELETE CASCADE,
  repository_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL UNIQUE,
  branch_name TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pane_worktrees_pane ON pane_worktrees(workspace_id,pane_id,status);
"#,
            )
            .map_err(AppError::database)?;
        record_migration(connection, 12)
    })();
    finish_migration_transaction(connection, result, 12)
}

/// Repository Command Center projection and recovery state. Git and the remote provider remain
/// authoritative; these rows exist to enforce leases/idempotency, survive process interruption,
/// and retain an attributable operation trail without copying raw repository history.
fn migrate_v13(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS repository_connections(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_path TEXT NOT NULL,
  canonical_repository_path TEXT NOT NULL,
  provider TEXT,
  provider_host TEXT,
  provider_repository_id TEXT,
  provider_account_id TEXT,
  default_branch TEXT,
  last_head_sha TEXT,
  last_branch TEXT,
  last_status_hash TEXT,
  last_inspected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id,canonical_repository_path)
);
CREATE TABLE IF NOT EXISTS repository_provider_accounts(
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  host TEXT NOT NULL,
  login TEXT,
  auth_source TEXT NOT NULL,
  credential_reference TEXT,
  status TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  last_verified_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider,host,id)
);
CREATE TABLE IF NOT EXISTS repository_provider_installations(
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES repository_provider_accounts(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '{}',
  repository_selection TEXT,
  suspended_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id,external_id)
);
CREATE TABLE IF NOT EXISTS repository_policies(
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  profile TEXT NOT NULL DEFAULT 'conservative',
  custom_rules_json TEXT NOT NULL DEFAULT '{}',
  protected_branches_json TEXT NOT NULL DEFAULT '["main","master"]',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_worktree_leases(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  canonical_worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_run_id TEXT,
  file_scope_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  expires_at TEXT,
  cleanup_state TEXT NOT NULL DEFAULT 'preserve',
  recovery_detail TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repository_active_worktree_lease
  ON repository_worktree_leases(canonical_worktree_path) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_repository_active_branch_lease
  ON repository_worktree_leases(project_id,repository_path,branch_name) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_repository_worktree_task
  ON repository_worktree_leases(project_id,task_id,status);
CREATE TABLE IF NOT EXISTS repository_operations(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch_name TEXT,
  kind TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  agent_run_id TEXT,
  task_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL,
  operation_hash TEXT NOT NULL,
  lock_key TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  risk TEXT NOT NULL,
  status TEXT NOT NULL,
  before_state_json TEXT,
  result_json TEXT,
  after_state_json TEXT,
  error_code TEXT,
  error_message TEXT,
  recovery_json TEXT,
  cancellation_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(project_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_repository_operations_recovery
  ON repository_operations(status,created_at);
CREATE INDEX IF NOT EXISTS idx_repository_operations_project
  ON repository_operations(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS repository_approvals(
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES repository_operations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  operation_kind TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  branch_name TEXT,
  commit_sha TEXT NOT NULL,
  risk TEXT NOT NULL,
  reason TEXT NOT NULL,
  expected_effects TEXT NOT NULL,
  recovery_strategy TEXT NOT NULL,
  operation_hash TEXT NOT NULL,
  state_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  consumed_at TEXT,
  final_result_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repository_approvals_pending
  ON repository_approvals(project_id,status,expires_at);
CREATE TABLE IF NOT EXISTS repository_remote_cache(
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  etag TEXT,
  updated_cursor TEXT,
  payload_json TEXT NOT NULL,
  remote_updated_at TEXT,
  fetched_at TEXT NOT NULL,
  stale_at TEXT,
  deleted_at TEXT,
  PRIMARY KEY(project_id,provider,object_kind,external_id)
);
CREATE INDEX IF NOT EXISTS idx_repository_remote_cache_kind
  ON repository_remote_cache(project_id,object_kind,remote_updated_at DESC);
CREATE TABLE IF NOT EXISTS repository_sync_cursors(
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  stream TEXT NOT NULL,
  cursor TEXT,
  status TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  stale_since TEXT,
  error_code TEXT,
  PRIMARY KEY(project_id,provider,stream)
);
CREATE TABLE IF NOT EXISTS repository_webhook_deliveries(
  provider TEXT NOT NULL,
  host TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  signature_verified INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  PRIMARY KEY(provider,host,delivery_id)
);
CREATE TABLE IF NOT EXISTS repository_recovery_checkpoints(
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES repository_operations(id) ON DELETE CASCADE,
  repository_state_json TEXT NOT NULL,
  git_state TEXT NOT NULL,
  recovery_actions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
INSERT OR IGNORE INTO repository_worktree_leases(
  id,project_id,repository_path,worktree_path,canonical_worktree_path,branch_name,base_commit,
  agent_id,task_id,agent_run_id,file_scope_json,status,created_at,last_activity_at,expires_at,
  cleanup_state,recovery_detail
)
SELECT
  id,project_id,repository_path,worktree_path,worktree_path,branch_name,base_ref,
  'pane:' || pane_id,'workspace:' || workspace_id,NULL,'[]','active',created_at,updated_at,NULL,
  'preserve','Imported from the pre-control-plane pane worktree registry.'
FROM pane_worktrees
WHERE status='active';
"#,
            )
            .map_err(AppError::database)?;
        record_migration(connection, 13)
    })();
    finish_migration_transaction(connection, result, 13)
}

/// Persist category-specific provider diagnostics so an offline restart can distinguish an
/// empty collection from a failed synchronization without keeping credentials or responses.
fn migrate_v14(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        add_column_if_missing(
            connection,
            "repository_sync_cursors",
            "error_message",
            "TEXT",
        )?;
        add_column_if_missing(
            connection,
            "repository_sync_cursors",
            "required_permission",
            "TEXT",
        )?;
        add_column_if_missing(
            connection,
            "repository_sync_cursors",
            "recovery_action",
            "TEXT",
        )?;
        record_migration(connection, 14)
    })();
    finish_migration_transaction(connection, result, 14)
}

/// Paralith Swarms. Role-based multi-agent orchestration scoped to a Project. The backend owns
/// every lifecycle transition and task-graph mutation; these tables persist Swarm identity,
/// role assignments, live agent workers, the adaptive task graph with its dependencies, a
/// bounded meaningful-event timeline, user role messages, and reusable team presets. The four
/// built-in presets are seeded idempotently so the creation flow always has them.
fn migrate_v15(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS swarms(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_root TEXT NOT NULL,
  name TEXT NOT NULL,
  mission TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'draft',
  phase TEXT NOT NULL DEFAULT 'understanding',
  team_preset TEXT NOT NULL DEFAULT 'auto',
  max_parallel INTEGER NOT NULL DEFAULT 6,
  instructions TEXT NOT NULL DEFAULT '',
  progress REAL NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  decision_json TEXT,
  summary_json TEXT,
  review_verdict TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS swarm_roles(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  runtime TEXT NOT NULL DEFAULT 'auto',
  desired_count INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(swarm_id, role)
);
CREATE TABLE IF NOT EXISTS swarm_agents(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  runtime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  current_task_id TEXT,
  terminal_session_id TEXT,
  last_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_tasks(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_agent_id TEXT,
  progress REAL NOT NULL DEFAULT 0,
  files_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_task_deps(
  task_id TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY(task_id, depends_on)
);
CREATE TABLE IF NOT EXISTS swarm_events(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  role TEXT,
  agent_id TEXT,
  task_id TEXT,
  summary TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_messages(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_presets(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  max_parallel INTEGER NOT NULL DEFAULT 6,
  instructions TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarms_project ON swarms(project_id, archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_agents_swarm ON swarm_agents(swarm_id, status);
CREATE INDEX IF NOT EXISTS idx_swarm_tasks_swarm ON swarm_tasks(swarm_id, status, position);
CREATE INDEX IF NOT EXISTS idx_swarm_events_swarm ON swarm_events(swarm_id, created_at DESC);
"#,
            )
            .map_err(AppError::database)?;
        // Development builds may already have created the v15 table before project_root became
        // part of the contract. Upgrade that partial schema in place and backfill from Projects;
        // never recreate the database or discard Swarm state.
        if !column_exists(connection, "swarms", "project_root")? {
            connection
                .execute("ALTER TABLE swarms ADD COLUMN project_root TEXT", [])
                .map_err(AppError::database)?;
        }
        connection
            .execute(
                "UPDATE swarms SET project_root=(SELECT canonical_root_path FROM projects WHERE projects.id=swarms.project_id) WHERE project_root IS NULL OR trim(project_root)=''",
                [],
            )
            .map_err(AppError::database)?;
        let unbound: i64 = connection
            .query_row(
                "SELECT count(*) FROM swarms WHERE project_root IS NULL OR trim(project_root)=''",
                [],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if unbound != 0 {
            return Err(AppError::new(
                "swarm_project_backfill_failed",
                "A persisted Swarm no longer has an owning Project root.",
                false,
            ));
        }
        seed_builtin_presets(connection)?;
        record_migration(connection, 15)
    })();
    finish_migration_transaction(connection, result, 15)
}

/// Role allocations (spec: role pools). Migrate the one-agent-per-role model to a role-pool model
/// where each role holds an ordered list of `(runtime, count)` allocations with stable ids. Safe
/// and idempotent: it backfills allocation rows from the legacy `swarm_roles` columns, adds the
/// worker↔allocation link and role ordering, upgrades every stored preset's `config_json` to the
/// allocation shape, and refreshes the built-in presets to their canonical mixed composition.
/// Existing Swarm drafts, presets, and stored configurations are preserved.
fn migrate_v16(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS swarm_role_allocations(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  runtime TEXT NOT NULL DEFAULT 'auto',
  count INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_swarm_role_allocations ON swarm_role_allocations(swarm_id, role, position);
"#,
            )
            .map_err(AppError::database)?;
        // Per-role display/scheduling order on the pool row, and the worker↔allocation link so a
        // recovered worker keeps its allocation (and therefore provider) identity.
        if !column_exists(connection, "swarm_roles", "position")? {
            connection
                .execute(
                    "ALTER TABLE swarm_roles ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(AppError::database)?;
        }
        if !column_exists(connection, "swarm_agents", "allocation_id")? {
            connection
                .execute("ALTER TABLE swarm_agents ADD COLUMN allocation_id TEXT", [])
                .map_err(AppError::database)?;
        }
        // Backfill one allocation per existing role from its legacy runtime + desired_count. Only
        // for roles that do not already have allocations, so re-running is a no-op.
        connection
            .execute(
                "INSERT INTO swarm_role_allocations(id,swarm_id,role,runtime,count,position) \
                 SELECT lower(hex(randomblob(16))), r.swarm_id, r.role, \
                        COALESCE(r.runtime,'auto'), COALESCE(r.desired_count,1), 0 \
                 FROM swarm_roles r \
                 WHERE NOT EXISTS (SELECT 1 FROM swarm_role_allocations a \
                                   WHERE a.swarm_id=r.swarm_id AND a.role=r.role)",
                [],
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "UPDATE swarm_agents AS agent SET allocation_id=COALESCE( \
                   (SELECT allocation.id FROM swarm_role_allocations allocation \
                    WHERE allocation.swarm_id=agent.swarm_id AND allocation.role=agent.role \
                      AND allocation.runtime=agent.runtime ORDER BY allocation.position LIMIT 1), \
                   (SELECT allocation.id FROM swarm_role_allocations allocation \
                    WHERE allocation.swarm_id=agent.swarm_id AND allocation.role=agent.role \
                    ORDER BY allocation.position LIMIT 1) \
                 ) WHERE agent.allocation_id IS NULL OR trim(agent.allocation_id)=''",
                [],
            )
            .map_err(AppError::database)?;
        upgrade_preset_configs(connection)?;
        record_migration(connection, 16)
    })();
    finish_migration_transaction(connection, result, 16)
}

/// Swarm V2 stores the observable engineering run, not merely the top-level task graph. The
/// additive columns keep v15/v16 records readable while the normalized tables give runtime
/// sessions, lifecycle transitions, communication edges, decisions, verification and recovery
/// durable identities. State-token rewrites are compatibility migrations only; no row is
/// deleted and legacy readers remain able to treat the new values as opaque strings.
fn migrate_v17(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        for (table, column, definition) in [
            ("swarms", "repository_identity", "TEXT"),
            ("swarms", "git_state_json", "TEXT NOT NULL DEFAULT '{}'"),
            ("swarms", "safeguards_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("swarms", "attachments_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("swarms", "current_milestone", "TEXT"),
            ("swarm_agents", "display_name", "TEXT"),
            (
                "swarm_agents",
                "runtime_session_state",
                "TEXT NOT NULL DEFAULT 'not_started'",
            ),
            ("swarm_agents", "working_directory", "TEXT"),
            ("swarm_agents", "worktree", "TEXT"),
            (
                "swarm_agents",
                "permissions_json",
                "TEXT NOT NULL DEFAULT '[]'",
            ),
            (
                "swarm_agents",
                "changed_files_json",
                "TEXT NOT NULL DEFAULT '[]'",
            ),
            (
                "swarm_agents",
                "test_progress_json",
                "TEXT NOT NULL DEFAULT '{}'",
            ),
            ("swarm_agents", "last_message", "TEXT"),
            ("swarm_agents", "current_blocker", "TEXT"),
            (
                "swarm_agents",
                "recovery_state",
                "TEXT NOT NULL DEFAULT 'none'",
            ),
            ("swarm_tasks", "required_runtime", "TEXT"),
            (
                "swarm_tasks",
                "progress_determinate",
                "INTEGER NOT NULL DEFAULT 0",
            ),
            ("swarm_tasks", "blocker", "TEXT"),
            ("swarm_tasks", "evidence_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("swarm_tasks", "tests_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("swarm_tasks", "lease_until", "TEXT"),
            (
                "swarm_tasks",
                "verification_required",
                "INTEGER NOT NULL DEFAULT 1",
            ),
            (
                "swarm_messages",
                "category",
                "TEXT NOT NULL DEFAULT 'update'",
            ),
            (
                "swarm_messages",
                "sender_kind",
                "TEXT NOT NULL DEFAULT 'user'",
            ),
            ("swarm_messages", "source_agent_id", "TEXT"),
            ("swarm_messages", "task_id", "TEXT"),
            ("swarm_messages", "links_json", "TEXT NOT NULL DEFAULT '[]'"),
            (
                "swarm_messages",
                "delivery_state",
                "TEXT NOT NULL DEFAULT 'queued'",
            ),
            ("swarm_events", "destination_agent_id", "TEXT"),
            ("swarm_events", "destination_role", "TEXT"),
            ("swarm_events", "evidence_id", "TEXT"),
            (
                "swarm_events",
                "metadata_json",
                "TEXT NOT NULL DEFAULT '{}'",
            ),
        ] {
            add_column_if_missing(connection, table, column, definition)?;
        }

        connection.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS swarm_lifecycle_history(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_runtime_sessions(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES swarm_agents(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  runtime TEXT NOT NULL,
  provider_session_id TEXT,
  terminal_session_id TEXT,
  state TEXT NOT NULL,
  resumable INTEGER NOT NULL DEFAULT 0,
  working_directory TEXT NOT NULL,
  instruction_hash TEXT NOT NULL,
  usage_json TEXT NOT NULL DEFAULT '{}',
  failure_class TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS swarm_canvas_connections(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  source_agent_id TEXT NOT NULL REFERENCES swarm_agents(id) ON DELETE CASCADE,
  destination_agent_id TEXT REFERENCES swarm_agents(id) ON DELETE SET NULL,
  destination_role TEXT,
  event_type TEXT NOT NULL,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  evidence_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_decisions(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  problem TEXT NOT NULL,
  reason TEXT NOT NULL,
  options_json TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  choice TEXT,
  affected_tasks_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS swarm_evidence(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES swarm_agents(id) ON DELETE SET NULL,
  criterion TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_uri TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_reviews(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  reviewer_agent_id TEXT NOT NULL REFERENCES swarm_agents(id) ON DELETE RESTRICT,
  subject_agent_id TEXT REFERENCES swarm_agents(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  notes TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS swarm_recovery_states(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES swarm_agents(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  summary TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS swarm_worktrees(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES swarm_agents(id) ON DELETE SET NULL,
  root_path TEXT NOT NULL,
  branch TEXT,
  base_revision TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released_at TEXT
);
CREATE TABLE IF NOT EXISTS swarm_file_ownership(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES swarm_agents(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  symbol TEXT,
  ownership_kind TEXT NOT NULL,
  read_hash TEXT,
  acquired_at TEXT NOT NULL,
  released_at TEXT
);
CREATE TABLE IF NOT EXISTS swarm_test_records(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES swarm_agents(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  command TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  log_uri TEXT,
  started_at TEXT,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS swarm_command_drafts(
  swarm_id TEXT PRIMARY KEY REFERENCES swarms(id) ON DELETE CASCADE,
  target TEXT NOT NULL DEFAULT '@swarm',
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_swarm_lifecycle_history ON swarm_lifecycle_history(swarm_id,created_at);
CREATE INDEX IF NOT EXISTS idx_swarm_runtime_sessions ON swarm_runtime_sessions(swarm_id,agent_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_connections ON swarm_canvas_connections(swarm_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_decisions_open ON swarm_decisions(swarm_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_evidence_task ON swarm_evidence(swarm_id,task_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_reviews_task ON swarm_reviews(swarm_id,task_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_recovery_open ON swarm_recovery_states(swarm_id,resolved_at);
CREATE INDEX IF NOT EXISTS idx_swarm_file_owner ON swarm_file_ownership(swarm_id,path,released_at);
CREATE INDEX IF NOT EXISTS idx_swarm_tests_task ON swarm_test_records(swarm_id,task_id,started_at DESC);
"#,
        ).map_err(AppError::database)?;

        connection.execute_batch(
            r#"
UPDATE swarms SET lifecycle='building' WHERE lifecycle='running';
UPDATE swarms SET lifecycle='decision_required' WHERE lifecycle='decision_needed';
UPDATE swarms SET lifecycle='ready_for_review' WHERE lifecycle='ready';
UPDATE swarm_agents SET status='starting' WHERE status='activating';
UPDATE swarm_agents SET status='active' WHERE status='working';
UPDATE swarm_agents SET status='completed' WHERE status='stopped';
UPDATE swarm_tasks SET status='proposed' WHERE status='pending';
UPDATE swarm_tasks SET status='claimed' WHERE status='assigned';
UPDATE swarm_tasks SET status='reviewing' WHERE status='review';
UPDATE swarm_tasks SET status='completed' WHERE status='done';
UPDATE swarm_agents
SET display_name=upper(substr(role,1,1)) || substr(role,2) || ' ' ||
  (SELECT count(*) FROM swarm_agents earlier
   WHERE earlier.swarm_id=swarm_agents.swarm_id AND earlier.role=swarm_agents.role
     AND (earlier.created_at < swarm_agents.created_at OR
          (earlier.created_at=swarm_agents.created_at AND earlier.id <= swarm_agents.id)))
WHERE display_name IS NULL OR trim(display_name)='';
INSERT INTO swarm_lifecycle_history(id,swarm_id,from_state,to_state,reason,created_at)
SELECT lower(hex(randomblob(16))),s.id,NULL,s.lifecycle,'Migrated existing Swarm into V2 lifecycle history',s.updated_at
FROM swarms s
WHERE NOT EXISTS(SELECT 1 FROM swarm_lifecycle_history h WHERE h.swarm_id=s.id);
"#,
        ).map_err(AppError::database)?;
        seed_builtin_presets(connection)?;
        refresh_builtin_presets(connection)?;
        record_migration(connection, 17)
    })();
    finish_migration_transaction(connection, result, 17)
}

/// Connect Swarms to the existing project Memory ledger without copying or mutating canonical
/// Memory records. Each row is an immutable-at-load context-pack projection for one task/agent.
fn migrate_v18(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS swarm_context_packs(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES swarm_agents(id) ON DELETE CASCADE,
  memory_item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE RESTRICT,
  revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  memory_state TEXT NOT NULL,
  summary TEXT NOT NULL,
  context TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_uris_json TEXT NOT NULL DEFAULT '[]',
  loaded_at TEXT NOT NULL,
  UNIQUE(swarm_id,task_id,agent_id,memory_item_id,revision_id)
);
CREATE INDEX IF NOT EXISTS idx_swarm_context_task ON swarm_context_packs(swarm_id,task_id,agent_id,loaded_at);
CREATE INDEX IF NOT EXISTS idx_swarm_context_memory ON swarm_context_packs(memory_item_id,revision_id);
"#,
            )
            .map_err(AppError::database)?;
        record_migration(connection, 18)
    })();
    finish_migration_transaction(connection, result, 18)
}

/// Persist the exact relationship between a bounded Debugger task and the failed task it repairs.
/// Older Swarms remain valid: their existing tasks simply have no repair link.
fn migrate_v19(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        if !column_exists(connection, "swarm_tasks", "repair_for_task_id")? {
            connection
                .execute(
                    "ALTER TABLE swarm_tasks ADD COLUMN repair_for_task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL",
                    [],
                )
                .map_err(AppError::database)?;
        }
        connection
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_swarm_tasks_repair_for ON swarm_tasks(swarm_id,repair_for_task_id)",
                [],
            )
            .map_err(AppError::database)?;
        record_migration(connection, 19)
    })();
    finish_migration_transaction(connection, result, 19)
}

/// Deduplicate provider JSONL while a PTY is live and after restart. Terminal tails are bounded
/// and replayed when a renderer or scheduler reconnects, so cursor-only bookkeeping would either
/// duplicate canonical activity or lose events after tail rotation. A stable hash of each
/// provider event is claimed transactionally before any Swarm side effect is recorded.
fn migrate_v20(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS swarm_runtime_event_receipts(
  terminal_session_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(terminal_session_id,event_key)
);
CREATE INDEX IF NOT EXISTS idx_swarm_runtime_event_receipts_session
  ON swarm_runtime_event_receipts(terminal_session_id,observed_at);
"#,
            )
            .map_err(AppError::database)?;
        record_migration(connection, 20)
    })();
    finish_migration_transaction(connection, result, 20)
}

/// Separate reusable Swarm configuration from durable executions without replacing the existing
/// current-state projection. Every historical Swarm is backfilled as one run, and future task
/// assignments append immutable agent attempts instead of overwriting execution history.
fn migrate_v21(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        add_column_if_missing(
            connection,
            "swarms",
            "revision",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            connection,
            "swarm_events",
            "sequence",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS swarm_runs(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  max_parallel INTEGER NOT NULL,
  failure_policy TEXT NOT NULL DEFAULT 'continue_independent',
  cancellation_requested_at TEXT,
  failure_json TEXT,
  result_summary_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_swarm_runs_one_active
  ON swarm_runs(swarm_id)
  WHERE status IN ('queued','starting','running','paused','needs_input','needs_permission','cancelling','recovering');
CREATE INDEX IF NOT EXISTS idx_swarm_runs_history
  ON swarm_runs(swarm_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS swarm_agent_runs(
  id TEXT PRIMARY KEY,
  swarm_run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES swarm_agents(id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  terminal_session_id TEXT,
  process_id INTEGER,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  exit_code INTEGER,
  failure_reason TEXT,
  cancellation_reason TEXT,
  structured_result_json TEXT,
  files_changed_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(swarm_run_id,task_id,attempt)
);
CREATE INDEX IF NOT EXISTS idx_swarm_agent_runs_history
  ON swarm_agent_runs(swarm_run_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_swarm_agent_runs_member
  ON swarm_agent_runs(member_id,created_at DESC);

CREATE TABLE IF NOT EXISTS swarm_attention_requests(
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  swarm_run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
  agent_run_id TEXT NOT NULL REFERENCES swarm_agent_runs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES swarm_agents(id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES swarm_tasks(id) ON DELETE SET NULL,
  request_kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  safe_payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  response TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(agent_run_id,request_kind,status)
);
CREATE INDEX IF NOT EXISTS idx_swarm_attention_open
  ON swarm_attention_requests(swarm_id,status,created_at DESC);

UPDATE swarms SET revision=1 WHERE revision=0;
UPDATE swarm_events
SET sequence=(
  SELECT count(*) FROM swarm_events earlier
  WHERE earlier.swarm_id=swarm_events.swarm_id
    AND (earlier.created_at < swarm_events.created_at
         OR (earlier.created_at=swarm_events.created_at AND earlier.id <= swarm_events.id))
)
WHERE sequence=0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_swarm_events_sequence
  ON swarm_events(swarm_id,sequence);

INSERT OR IGNORE INTO swarm_runs(
  id,swarm_id,project_id,objective,status,phase,progress,max_parallel,failure_policy,
  cancellation_requested_at,failure_json,result_summary_json,created_at,started_at,finished_at,updated_at
)
SELECT 'legacy-run-' || id,id,project_id,mission,
  CASE lifecycle
    WHEN 'draft' THEN 'cancelled'
    WHEN 'paused' THEN 'paused'
    WHEN 'decision_required' THEN 'needs_input'
    WHEN 'ready_for_review' THEN 'completed'
    WHEN 'completed' THEN 'completed'
    WHEN 'failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'archived' THEN 'completed'
    ELSE 'interrupted'
  END,
  phase,progress,max_parallel,'continue_independent',
  CASE WHEN lifecycle IN ('stopping','cancelled') THEN updated_at END,
  CASE WHEN lifecycle='failed' THEN json_object('reason','Migrated failed Swarm') END,
  summary_json,created_at,started_at,
  CASE WHEN lifecycle IN ('ready_for_review','completed','failed','cancelled','archived') THEN coalesce(completed_at,updated_at) END,
  updated_at
FROM swarms
WHERE lifecycle <> 'draft';
"#,
            )
            .map_err(AppError::database)?;
        record_migration(connection, 21)
    })();
    finish_migration_transaction(connection, result, 21)
}

/// Durable persistence for the Paralith Orchestration Kernel. A session is the authoritative
/// unit the backend state machine owns; turns record the conversation and system inputs; events
/// are the append-only observable timeline the UI derives from; capability executions record
/// every typed application-control action the gateway ran, with sanitized (never secret) payloads.
/// All four tables are project-scoped by `project_id` when a session is bound to a Project so the
/// same window-security boundary that governs the rest of Paralith applies to orchestration data.
fn migrate_v22(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS orchestration_sessions(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  originating_surface TEXT NOT NULL,
  project_id TEXT,
  workspace_id TEXT,
  operating_mode TEXT NOT NULL,
  state TEXT NOT NULL,
  objective TEXT NOT NULL,
  normalized_objective TEXT,
  failure_classification TEXT,
  token_budget INTEGER,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orch_sessions_recent
  ON orchestration_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orch_sessions_project
  ON orchestration_sessions(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS orchestration_turns(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  input_type TEXT NOT NULL,
  content TEXT NOT NULL,
  transcript_confidence REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orch_turns_session
  ON orchestration_turns(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS orchestration_events(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orch_events_sequence
  ON orchestration_events(session_id, sequence);

CREATE TABLE IF NOT EXISTS orchestration_capability_executions(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  validated_inputs_json TEXT NOT NULL,
  sanitized_result_json TEXT,
  state TEXT NOT NULL,
  error_classification TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orch_exec_session
  ON orchestration_capability_executions(session_id, created_at ASC);
"#,
            )
            .map_err(AppError::database)?;
        record_migration(connection, 22)
    })();
    finish_migration_transaction(connection, result, 22)
}

/// Per-member execution configuration and immutable attempt snapshots. Existing members keep
/// their provider identity but become visibly `unvalidated`; no arbitrary model is assigned.
fn migrate_v23(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        for (table, column, definition) in [
            (
                "swarm_role_allocations",
                "model_config_json",
                "TEXT NOT NULL DEFAULT '{}'",
            ),
            (
                "swarm_agents",
                "model_config_json",
                "TEXT NOT NULL DEFAULT '{}'",
            ),
            ("swarm_agent_runs", "requested_provider_id", "TEXT"),
            ("swarm_agent_runs", "requested_model_id", "TEXT"),
            ("swarm_agent_runs", "resolved_provider_id", "TEXT"),
            ("swarm_agent_runs", "resolved_model_id", "TEXT"),
            ("swarm_agent_runs", "reasoning_effort", "TEXT"),
            (
                "swarm_agent_runs",
                "fallback_used",
                "INTEGER NOT NULL DEFAULT 0",
            ),
            ("swarm_agent_runs", "fallback_reason", "TEXT"),
            ("swarm_agent_runs", "provider_runtime_version", "TEXT"),
            (
                "swarm_agent_runs",
                "execution_config_snapshot_json",
                "TEXT NOT NULL DEFAULT '{}'",
            ),
        ] {
            add_column_if_missing(connection, table, column, definition)?;
        }
        record_migration(connection, 23)
    })();
    finish_migration_transaction(connection, result, 23)
}

/// Provision the repository-intelligence graph projection. This is a derived cache rebuilt from
/// Git, so no user-authored data needs a backfill. The unique constraints exactly match the
/// snapshot writer's upsert keys and keep refreshes atomic and idempotent.
fn migrate_v26(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        connection
            .execute_batch(
                r#"
CREATE TABLE IF NOT EXISTS repository_graph_snapshots(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status_hash TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  impact_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repo_graph_snapshots_recent
  ON repository_graph_snapshots(project_id, repository_id, created_at DESC);

CREATE TABLE IF NOT EXISTS repository_graph_nodes(
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  external_key TEXT NOT NULL,
  display_label TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, repository_id, node_type, external_key, snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_repo_graph_nodes_snapshot
  ON repository_graph_nodes(snapshot_id, node_type);

CREATE TABLE IF NOT EXISTS repository_graph_edges(
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, repository_id, source_node_id, target_node_id, edge_type, snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_repo_graph_edges_snapshot
  ON repository_graph_edges(snapshot_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_repo_graph_edges_source
  ON repository_graph_edges(snapshot_id, source_node_id);

CREATE TABLE IF NOT EXISTS repository_graph_index_state(
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status_hash TEXT NOT NULL,
  last_success_at TEXT,
  extractor_version TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT,
  UNIQUE(project_id, repository_id, worktree_path)
);
"#,
            )
            .map_err(AppError::database)?;
        record_migration(connection, 26)
    })();
    finish_migration_transaction(connection, result, 26)
}

/// Extend the canonical agent-session record into the provider-neutral resume registry. These
/// fields are metadata snapshots only: provider transcripts, credentials, tokens, and complete
/// environments remain provider-owned and are never copied into SQLite.
fn migrate_v27(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(AppError::database)?;
    let result = (|| {
        for (column, definition) in [
            ("session_title", "TEXT NOT NULL DEFAULT ''"),
            ("repository_root", "TEXT NOT NULL DEFAULT ''"),
            ("repository_identity", "TEXT NOT NULL DEFAULT ''"),
            ("worktree_path", "TEXT NOT NULL DEFAULT ''"),
            ("branch_name", "TEXT"),
            ("working_directory", "TEXT NOT NULL DEFAULT ''"),
            ("launch_executable", "TEXT NOT NULL DEFAULT ''"),
            ("launch_args_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("original_launch_args_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("last_activity_at", "TEXT NOT NULL DEFAULT ''"),
            ("recovery_status", "TEXT NOT NULL DEFAULT 'unknown'"),
            ("shutdown_reason", "TEXT NOT NULL DEFAULT 'unknown'"),
            ("dismissed_at", "TEXT"),
            ("resume_attempt_id", "TEXT"),
            ("last_error_code", "TEXT"),
            ("last_error_message", "TEXT"),
            ("running_terminal_session_id", "TEXT"),
        ] {
            add_column_if_missing(connection, "agent_sessions", column, definition)?;
        }
        connection.execute_batch(
            r#"
UPDATE agent_sessions
SET session_title = coalesce(
      nullif(session_title, ''),
      (SELECT title FROM terminal_sessions t WHERE t.id=agent_sessions.terminal_session_id),
      provider_type
    ),
    repository_root = coalesce(
      nullif(repository_root, ''),
      (SELECT canonical_root_path FROM projects p WHERE p.id=agent_sessions.project_id),
      ''
    ),
    repository_identity = coalesce(
      nullif(repository_identity, ''),
      (SELECT canonical_root_path FROM projects p WHERE p.id=agent_sessions.project_id),
      ''
    ),
    worktree_path = coalesce(
      nullif(worktree_path, ''),
      (SELECT pw.worktree_path FROM pane_worktrees pw
       WHERE pw.workspace_id=agent_sessions.workspace_id
         AND pw.pane_id=agent_sessions.pane_id
         AND pw.status='active'
       ORDER BY pw.updated_at DESC LIMIT 1),
      (SELECT working_directory FROM terminal_sessions t WHERE t.id=agent_sessions.terminal_session_id),
      ''
    ),
    branch_name = coalesce(
      branch_name,
      (SELECT pw.branch_name FROM pane_worktrees pw
       WHERE pw.workspace_id=agent_sessions.workspace_id
         AND pw.pane_id=agent_sessions.pane_id
         AND pw.status='active'
       ORDER BY pw.updated_at DESC LIMIT 1),
      (SELECT git_branch FROM projects p WHERE p.id=agent_sessions.project_id)
    ),
    working_directory = coalesce(
      nullif(working_directory, ''),
      (SELECT working_directory FROM terminal_sessions t WHERE t.id=agent_sessions.terminal_session_id),
      ''
    ),
    launch_executable = coalesce(
      nullif(launch_executable, ''),
      (SELECT executable_path FROM terminal_sessions t WHERE t.id=agent_sessions.terminal_session_id),
      ''
    ),
    launch_args_json = coalesce(
      nullif(launch_args_json, '[]'),
      '[]'
    ),
    original_launch_args_json = coalesce(
      nullif(original_launch_args_json, '[]'),
      '[]'
    ),
    last_activity_at = coalesce(nullif(last_activity_at, ''), nullif(agent_state_updated_at, ''), updated_at),
    recovery_status = CASE
      WHEN recovery_status <> 'unknown' THEN recovery_status
      WHEN status='running' THEN 'reconciling'
      WHEN status='exited' AND agent_state='finished' THEN 'completed'
      ELSE 'resumable'
    END,
    shutdown_reason = CASE
      WHEN shutdown_reason <> 'unknown' THEN shutdown_reason
      WHEN status='running' THEN 'unclean_shutdown'
      WHEN status='exited' AND agent_state='finished' THEN 'completed'
      ELSE 'legacy_stopped'
    END,
    dismissed_at = CASE
      WHEN provider_session_id IS NULL THEN coalesce(dismissed_at,updated_at)
      ELSE dismissed_at
    END;
CREATE INDEX IF NOT EXISTS idx_agent_resume_center
  ON agent_sessions(dismissed_at,recovery_status,last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_provider_session
  ON agent_sessions(provider_type,provider_session_id,last_activity_at DESC);
"#,
        )
        .map_err(AppError::database)?;
        record_migration(connection, 27)
    })();
    finish_migration_transaction(connection, result, 27)
}

/// Rewrite every stored preset's `config_json` into the role-pool allocation shape. User presets
/// are upgraded in place (no data loss); built-in presets are refreshed to the canonical
/// composition from [`crate::models::swarm::builtin_presets`], which is where the Feature Team and
/// Deep Engineering builders gain their mixed Claude + Codex allocations.
fn upgrade_preset_configs(connection: &Connection) -> AppResult<()> {
    let rows: Vec<(String, bool, String)> = {
        let mut statement = connection
            .prepare("SELECT id, builtin, config_json FROM swarm_presets")
            .map_err(AppError::database)?;
        let mapped = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(AppError::database)?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?
    };
    let now = chrono::Utc::now().to_rfc3339();
    let builtin_canonical = crate::models::swarm::builtin_presets();
    for (id, builtin, config_json) in rows {
        let upgraded = if builtin {
            builtin_canonical
                .iter()
                .find(|(builtin_id, ..)| *builtin_id == id)
                .map(|(.., roles)| roles.clone())
        } else {
            None
        }
        .map(Ok)
        .unwrap_or_else(|| upgrade_saved_preset_config(&id, &config_json))?;
        let serialized = serde_json::to_string(&upgraded).map_err(AppError::database)?;
        connection
            .execute(
                "UPDATE swarm_presets SET config_json=?2, updated_at=?3 WHERE id=?1",
                params![id, serialized, now],
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}

fn upgrade_saved_preset_config(
    preset_id: &str,
    config_json: &str,
) -> AppResult<Vec<crate::models::swarm::SwarmRoleConfig>> {
    let value: serde_json::Value = serde_json::from_str(config_json).map_err(|error| {
        preset_migration_error(preset_id, format!("Invalid preset JSON: {error}"))
    })?;
    let source_roles = value.as_array().ok_or_else(|| {
        preset_migration_error(preset_id, "Preset configuration is not a role array.")
    })?;
    let upgraded = crate::models::swarm::upgrade_role_configs_json(&value).ok_or_else(|| {
        preset_migration_error(preset_id, "Preset configuration could not be upgraded.")
    })?;
    if upgraded.len() != source_roles.len()
        || source_roles.iter().zip(&upgraded).any(|(source, role)| {
            source
                .get("allocations")
                .or_else(|| source.get("agents"))
                .and_then(serde_json::Value::as_array)
                .is_some_and(|allocations| allocations.len() != role.allocations.len())
        })
    {
        return Err(preset_migration_error(
            preset_id,
            "Preset roles or allocations contain unsupported values.",
        ));
    }
    Ok(upgraded)
}

fn preset_migration_error(preset_id: &str, detail: impl Into<String>) -> AppError {
    AppError::new(
        "swarm_preset_migration_failed",
        "A saved Swarm preset could not be migrated without losing configuration.",
        false,
    )
    .detail(detail)
    .entity(preset_id)
    .action("Restore or repair this preset configuration before retrying the upgrade.")
    .layer("persistence")
}

/// Insert the built-in team presets. Idempotent: `INSERT OR IGNORE` keyed by the stable preset id
/// keeps a user's edits to their own presets untouched while ensuring the built-ins always exist.
/// `config_json` stores the ordered role-pool configuration (roles with their allocations).
fn seed_builtin_presets(connection: &Connection) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    for (id, name, max_parallel, roles) in crate::models::swarm::builtin_presets() {
        let config_json = serde_json::to_string(&roles).unwrap_or_else(|_| "[]".into());
        let is_default = i64::from(id == "auto");
        connection
            .execute(
                "INSERT OR IGNORE INTO swarm_presets(id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at) VALUES(?1,?2,1,?3,?4,'',?5,?6,?6)",
                params![id, name, is_default, max_parallel, config_json, now],
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}

fn refresh_builtin_presets(connection: &Connection) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    for (id, name, max_parallel, roles) in crate::models::swarm::builtin_presets() {
        let config_json = serde_json::to_string(&roles).map_err(AppError::database)?;
        connection.execute(
            "UPDATE swarm_presets SET name=?2,max_parallel=?3,config_json=?4,updated_at=?5 WHERE id=?1 AND builtin=1",
            params![id, name, max_parallel, config_json, now],
        ).map_err(AppError::database)?;
    }
    Ok(())
}

fn record_migration(connection: &Connection, version: i64) -> AppResult<()> {
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?1,datetime('now'))",
            [version],
        )
        .map_err(AppError::database)?;
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::database)?;
    connection
        .pragma_update(None, "user_version", current.max(version))
        .map_err(AppError::database)
}

fn finish_migration_transaction(
    connection: &Connection,
    result: AppResult<()>,
    version: i64,
) -> AppResult<()> {
    match result {
        Ok(()) => connection
            .execute_batch("COMMIT;")
            .map_err(AppError::database),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK;");
            Err(AppError::new(
                "migration_error",
                format!("PARALITH could not reconcile database migration {version}."),
                false,
            )
            .detail(error.to_string())
            .action("Restore the diagnostic backup and open Diagnostics.")
            .layer("migration"))
        }
    }
}

fn run_migration_batch(connection: &Connection, sql: &str, version: i64) -> AppResult<()> {
    if let Err(error) = connection.execute_batch(sql) {
        let _ = connection.execute_batch("ROLLBACK;");
        return Err(AppError::new(
            "migration_error",
            format!("PARALITH could not apply database migration {version}."),
            false,
        )
        .detail(error.to_string())
        .action("Restore the diagnostic backup and open Diagnostics.")
        .layer("migration"));
    }
    Ok(())
}

/// Migration 3 mixes schema and data repair, so it runs as Rust rather than a static SQL
/// batch: the duplicate-Project merge needs the same path normalization the app uses, and
/// the unique Workspace-name index can only be created after existing duplicates are
/// resolved. Idempotent — re-running finds nothing to repair.
fn migrate_v3(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(MIGRATION_3_DDL).map_err(|error| {
        AppError::new(
            "migration_error",
            "PARALITH could not upgrade its database.",
            false,
        )
        .detail(error.to_string())
    })?;
    merge_duplicate_projects(connection)?;
    dedupe_workspace_names(connection)?;
    connection
        .execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_unique_name ON workspaces(project_id, lower(name));",
        )
        .map_err(|error| {
            AppError::new("migration_error", "PARALITH could not upgrade its database.", false)
                .detail(error.to_string())
        })?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,datetime('now'))",
            [],
        )
        .map_err(AppError::database)?;
    connection
        .pragma_update(None, "user_version", 3)
        .map_err(AppError::database)?;
    Ok(())
}

/// Collapse Projects that resolve to the same filesystem path (e.g. a legacy `\\?\C:\x`
/// row next to the normalized `c:\x`). The oldest row wins; every Workspace is reassigned
/// to it, recency timestamps are kept as the most recent across the group, and only the
/// duplicate Project rows are removed. Project files are never touched.
fn merge_duplicate_projects(connection: &Connection) -> AppResult<()> {
    struct Row {
        id: String,
        canonical: String,
        root_path: String,
        created_at: String,
        last_opened_at: String,
    }
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT id,canonical_root_path,root_path,created_at,last_opened_at FROM projects",
            )
            .map_err(AppError::database)?;
        let mapped = statement
            .query_map([], |row| {
                Ok(Row {
                    id: row.get(0)?,
                    canonical: row.get(1)?,
                    root_path: row.get(2)?,
                    created_at: row.get(3)?,
                    last_opened_at: row.get(4)?,
                })
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        mapped
    };
    let mut groups: std::collections::HashMap<String, Vec<Row>> = std::collections::HashMap::new();
    for row in rows {
        groups
            .entry(normalize_path_key(&row.canonical))
            .or_default()
            .push(row);
    }
    for (normalized, mut members) in groups {
        if members.len() < 2 {
            continue;
        }
        // Oldest created row is canonical; deterministic tiebreak on id.
        members.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        let latest_open = members
            .iter()
            .map(|row| row.last_opened_at.clone())
            .max()
            .unwrap_or_default();
        let keeper = members[0].id.clone();
        let keeper_root = strip_verbatim_prefix(&members[0].root_path);
        for duplicate in &members[1..] {
            connection
                .execute(
                    "UPDATE workspaces SET project_id=?1 WHERE project_id=?2",
                    params![keeper, duplicate.id],
                )
                .map_err(AppError::database)?;
            connection
                .execute("DELETE FROM projects WHERE id=?1", [&duplicate.id])
                .map_err(AppError::database)?;
            log::info!(
                "migration: merged duplicate project {} into {} ({})",
                duplicate.id,
                keeper,
                normalized
            );
        }
        connection
            .execute(
                "UPDATE projects SET canonical_root_path=?1,root_path=?2,last_opened_at=?3 WHERE id=?4",
                params![normalized, keeper_root, latest_open, keeper],
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}

/// Resolve case-insensitive duplicate Workspace names within a Project by suffixing the
/// later rows (`Main`, `Main 2`, ...). Ordered by creation so the original name is kept.
fn dedupe_workspace_names(connection: &Connection) -> AppResult<()> {
    struct Row {
        id: String,
        project_id: String,
        name: String,
    }
    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT id,project_id,name FROM workspaces ORDER BY project_id, created_at, id",
            )
            .map_err(AppError::database)?;
        let collected = statement
            .query_map([], |row| {
                Ok(Row {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                })
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        collected
    };
    let mut seen: std::collections::HashMap<String, std::collections::HashSet<String>> =
        std::collections::HashMap::new();
    for row in rows {
        let taken = seen.entry(row.project_id.clone()).or_default();
        let base = row.name.trim().to_owned();
        let mut candidate = base.clone();
        let mut suffix = 2;
        while taken.contains(&candidate.to_lowercase()) {
            candidate = format!("{base} {suffix}");
            suffix += 1;
        }
        if candidate != row.name {
            connection
                .execute(
                    "UPDATE workspaces SET name=?1 WHERE id=?2",
                    params![candidate, row.id],
                )
                .map_err(AppError::database)?;
            log::info!(
                "migration: renamed duplicate workspace {} to '{}'",
                row.id,
                candidate
            );
        }
        taken.insert(candidate.to_lowercase());
    }
    Ok(())
}

/// Strip Windows verbatim prefixes so `\\?\C:\x` and `C:\x` compare equal.
fn strip_verbatim_prefix(value: &str) -> String {
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    value.strip_prefix(r"\\?\").unwrap_or(value).to_owned()
}

/// Normalized key used to detect two Projects that point at the same folder. Matches the
/// application's canonicalization: verbatim prefix removed, case-folded on Windows.
fn normalize_path_key(value: &str) -> String {
    let stripped = strip_verbatim_prefix(value);
    let trimmed = stripped.trim_end_matches(['\\', '/']);
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_owned()
    }
}

fn run_migration(connection: &Connection, sql: &str, version: i64) -> AppResult<()> {
    connection.execute_batch(sql).map_err(|error| {
        AppError::new(
            "migration_error",
            "PARALITH could not initialize its local database.",
            false,
        )
        .detail(error.to_string())
    })?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?1,datetime('now'))",
            [version],
        )
        .map_err(AppError::database)?;
    connection
        .pragma_update(None, "user_version", version)
        .map_err(AppError::database)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_configuration_migration_is_additive_and_preserves_existing_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("\
            CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE swarm_role_allocations(id TEXT PRIMARY KEY, swarm_id TEXT, role TEXT, runtime TEXT, count INTEGER, position INTEGER);
            CREATE TABLE swarm_agents(id TEXT PRIMARY KEY, swarm_id TEXT, runtime TEXT);
            CREATE TABLE swarm_agent_runs(id TEXT PRIMARY KEY, swarm_id TEXT);
            INSERT INTO swarm_role_allocations VALUES('allocation','swarm','builder','codex',1,0);
            INSERT INTO swarm_agents VALUES('member','swarm','codex');
            INSERT INTO swarm_agent_runs VALUES('attempt','swarm');
        ").unwrap();
        migrate_v23(&connection).unwrap();
        assert!(column_exists(&connection, "swarm_role_allocations", "model_config_json").unwrap());
        assert!(column_exists(&connection, "swarm_agents", "model_config_json").unwrap());
        assert!(column_exists(
            &connection,
            "swarm_agent_runs",
            "execution_config_snapshot_json"
        )
        .unwrap());
        assert_eq!(
            connection
                .query_row(
                    "SELECT runtime FROM swarm_agents WHERE id='member'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "codex"
        );
        connection
            .execute_batch("CREATE TABLE swarms(id TEXT PRIMARY KEY);")
            .unwrap();
        migrate_v24(&connection).unwrap();
        assert!(table_exists(&connection, "swarm_execution_defaults").unwrap());
    }

    #[test]
    fn v27_backfills_resume_metadata_without_losing_agent_identity() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE projects(id TEXT PRIMARY KEY, canonical_root_path TEXT NOT NULL, git_branch TEXT);
CREATE TABLE workspaces(id TEXT PRIMARY KEY);
CREATE TABLE workspace_panes(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, args_json TEXT NOT NULL);
CREATE TABLE terminal_sessions(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, working_directory TEXT NOT NULL,
  executable_path TEXT NOT NULL, args_json TEXT NOT NULL
);
CREATE TABLE pane_worktrees(
  workspace_id TEXT NOT NULL, pane_id TEXT NOT NULL, worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE agent_sessions(
  terminal_session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  pane_id TEXT NOT NULL, profile_id TEXT, provider_type TEXT NOT NULL,
  provider_session_id TEXT, transcript_path TEXT, status TEXT NOT NULL,
  agent_state TEXT NOT NULL, agent_state_source TEXT NOT NULL, agent_state_reason TEXT NOT NULL,
  agent_attention_since TEXT, agent_state_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO projects VALUES('project','C:/repo','main');
INSERT INTO workspaces VALUES('workspace');
INSERT INTO workspace_panes VALUES('pane','workspace','[]');
INSERT INTO terminal_sessions VALUES('terminal','Claude','C:/repo','C:/bin/claude.exe','["--model","opus"]');
INSERT INTO terminal_sessions VALUES('terminal-running','Codex','C:/repo','C:/bin/codex.exe','[]');
INSERT INTO terminal_sessions VALUES('terminal-unidentified','Claude','C:/repo','C:/bin/claude.exe','["prompt with secret"]');
INSERT INTO agent_sessions VALUES(
  'terminal','project','workspace','pane',NULL,'claude',
  '5bb49df0-2afe-4fe2-8fd4-8aa4ba2943a9',NULL,'terminated',
  'failed','process_exit','stopped',NULL,'2026-07-30T10:00:00Z',
  '2026-07-30T09:00:00Z','2026-07-30T10:00:00Z'
);
INSERT INTO agent_sessions VALUES(
  'terminal-unidentified','project','workspace','pane',NULL,'claude',
  NULL,NULL,'terminated',
  'failed','process_exit','stopped',NULL,'2026-07-30T10:00:00Z',
  '2026-07-30T09:00:00Z','2026-07-30T10:00:00Z'
);
INSERT INTO agent_sessions VALUES(
  'terminal-running','project','workspace','pane',NULL,'codex',
  'c79b35f1-f15f-4665-a2d0-b56e992167b5',NULL,'running',
  'working','process_running','active',NULL,'2026-07-30T10:00:00Z',
  '2026-07-30T09:00:00Z','2026-07-30T10:00:00Z'
);
PRAGMA user_version=26;
"#,
            )
            .unwrap();
        migrate_v27(&connection).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT provider_session_id FROM agent_sessions WHERE terminal_session_id='terminal'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "5bb49df0-2afe-4fe2-8fd4-8aa4ba2943a9"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT repository_root FROM agent_sessions WHERE terminal_session_id='terminal'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "C:/repo"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT recovery_status||':'||shutdown_reason FROM agent_sessions WHERE terminal_session_id='terminal'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "resumable:legacy_stopped"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT recovery_status||':'||shutdown_reason FROM agent_sessions WHERE terminal_session_id='terminal-running'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "reconciling:unclean_shutdown"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT launch_args_json FROM agent_sessions WHERE terminal_session_id='terminal'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "[]"
        );
        assert!(connection
            .query_row(
                "SELECT dismissed_at IS NOT NULL FROM agent_sessions WHERE terminal_session_id='terminal-unidentified'",
                [],
                |row| row.get::<_, bool>(0)
            )
            .unwrap());
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            27
        );
    }

    fn insert_session(connection: &Connection) -> rusqlite::Result<usize> {
        connection.execute(
            "INSERT INTO terminal_sessions(id,workspace_id,pane_id,provider_type,title,working_directory,status,started_at) \
             VALUES('s1','ephemeral-workspace','p1','claude','Claude','/tmp','running','now')",
            [],
        )
    }

    #[test]
    fn fresh_schema_contains_repository_control_plane_tables() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        for table in [
            "repository_connections",
            "repository_policies",
            "repository_worktree_leases",
            "repository_operations",
            "repository_approvals",
            "repository_remote_cache",
            "repository_sync_cursors",
            "repository_webhook_deliveries",
            "repository_recovery_checkpoints",
            "swarm_runs",
            "swarm_agent_runs",
            "swarm_attention_requests",
            "repository_graph_snapshots",
            "repository_graph_nodes",
            "repository_graph_edges",
            "repository_graph_index_state",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
        }
        for column in ["error_message", "required_permission", "recovery_action"] {
            assert!(column_exists(&connection, "repository_sync_cursors", column).unwrap());
        }
        assert!(column_exists(&connection, "swarm_tasks", "repair_for_task_id").unwrap());
        assert!(column_exists(&connection, "swarms", "revision").unwrap());
        assert!(column_exists(&connection, "swarm_events", "sequence").unwrap());
        assert!(table_exists(&connection, "swarm_runtime_event_receipts").unwrap());
    }

    #[test]
    fn v15_creates_swarm_tables_and_seeds_builtin_presets() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        for table in [
            "swarms",
            "swarm_roles",
            "swarm_agents",
            "swarm_tasks",
            "swarm_task_deps",
            "swarm_events",
            "swarm_messages",
            "swarm_presets",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
        }
        let builtin: i64 = connection
            .query_row(
                "SELECT count(*) FROM swarm_presets WHERE builtin=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(builtin, 5, "the five built-in presets must be seeded");
        let default: i64 = connection
            .query_row(
                "SELECT count(*) FROM swarm_presets WHERE is_default=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(default, 1, "exactly one default preset");
        assert!(column_exists(&connection, "swarms", "project_root").unwrap());
    }

    #[test]
    fn v21_backfills_run_history_and_event_sequences_without_losing_legacy_swarm() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
             CREATE TABLE projects(id TEXT PRIMARY KEY);
             CREATE TABLE swarms(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,mission TEXT NOT NULL,lifecycle TEXT NOT NULL,phase TEXT NOT NULL,progress REAL NOT NULL,max_parallel INTEGER NOT NULL,summary_json TEXT,created_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,updated_at TEXT NOT NULL);
             CREATE TABLE swarm_agents(id TEXT PRIMARY KEY);
             CREATE TABLE swarm_tasks(id TEXT PRIMARY KEY);
             CREATE TABLE swarm_events(id TEXT PRIMARY KEY,swarm_id TEXT NOT NULL,created_at TEXT NOT NULL);
             INSERT INTO projects(id) VALUES('project-1');
             INSERT INTO swarms(id,project_id,mission,lifecycle,phase,progress,max_parallel,created_at,started_at,updated_at) VALUES('swarm-1','project-1','Preserve this run','building','building',0.4,2,'2026-01-01T00:00:00Z','2026-01-01T00:01:00Z','2026-01-01T00:02:00Z');
             INSERT INTO swarm_events(id,swarm_id,created_at) VALUES('event-b','swarm-1','2026-01-01T00:02:00Z'),('event-a','swarm-1','2026-01-01T00:01:00Z');",
        ).unwrap();

        migrate_v21(&connection).unwrap();

        assert_eq!(
            connection
                .query_row("SELECT mission FROM swarms WHERE id='swarm-1'", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "Preserve this run"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM swarm_runs WHERE swarm_id='swarm-1'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "interrupted"
        );
        let sequences: Vec<i64> = connection
            .prepare(
                "SELECT sequence FROM swarm_events WHERE swarm_id='swarm-1' ORDER BY created_at",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(sequences, vec![1, 2]);
    }

    #[test]
    fn v15_reseeds_builtin_presets_but_preserves_user_presets() {
        // A partial v15 build could create the tables but skip seeding; re-running apply must
        // restore the built-ins idempotently without disturbing a user-created preset.
        let connection = Connection::open_in_memory().unwrap();
        apply(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO swarm_presets(id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at) VALUES('mine','My Team',0,0,4,'','[]','now','now')",
                [],
            )
            .unwrap();
        connection
            .execute("DELETE FROM swarm_presets WHERE builtin=1", [])
            .unwrap();
        seed_builtin_presets(&connection).unwrap();
        let builtin: i64 = connection
            .query_row(
                "SELECT count(*) FROM swarm_presets WHERE builtin=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(builtin, 5);
        let mine: i64 = connection
            .query_row(
                "SELECT count(*) FROM swarm_presets WHERE id='mine'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(mine, 1, "user preset must survive reseeding");
    }

    #[test]
    fn v15_backfills_project_root_for_partial_swarm_schema_without_losing_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p','Demo','C:/repo','c:/repo','[]',1,0,0,'t','t','t')",[]).unwrap();
        connection
            .execute("ALTER TABLE swarms DROP COLUMN project_root", [])
            .unwrap();
        connection.execute("INSERT INTO swarms(id,project_id,name,mission,lifecycle,phase,team_preset,max_parallel,instructions,progress,priority,archived,created_at,updated_at) VALUES('s','p','Existing','Keep me','draft','understanding','auto',2,'',0,0,0,'t','t')",[]).unwrap();

        apply(&connection).unwrap();

        let root: String = connection
            .query_row("SELECT project_root FROM swarms WHERE id='s'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(root, "c:/repo");
        let count: i64 = connection
            .query_row("SELECT count(*) FROM swarms WHERE id='s'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1, "the existing Swarm must survive the backfill");
    }

    #[test]
    fn v16_creates_allocation_schema_and_builtin_presets_use_mixed_agents() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        assert!(table_exists(&connection, "swarm_role_allocations").unwrap());
        assert!(column_exists(&connection, "swarm_agents", "allocation_id").unwrap());
        assert!(column_exists(&connection, "swarm_roles", "position").unwrap());

        // Standard's Builders must carry both Claude and Codex allocations.
        let config: String = connection
            .query_row(
                "SELECT config_json FROM swarm_presets WHERE id='feature_team'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let roles: Vec<crate::models::swarm::SwarmRoleConfig> =
            serde_json::from_str(&config).unwrap();
        let builders = roles
            .iter()
            .find(|role| role.role == crate::models::swarm::SwarmRole::Builder)
            .expect("Standard has a Builder role");
        let runtimes: Vec<_> = builders
            .allocations
            .iter()
            .map(|allocation| allocation.runtime)
            .collect();
        assert!(runtimes.contains(&crate::models::swarm::SwarmRuntimeKind::Claude));
        assert!(runtimes.contains(&crate::models::swarm::SwarmRuntimeKind::Codex));
        assert_eq!(builders.total_count(), 2);
    }

    #[test]
    fn v16_upgrades_legacy_single_agent_roles_and_user_presets_without_loss() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        // Simulate a pre-v16 world: a Swarm whose role pool exists only as a legacy swarm_roles
        // row (runtime + desired_count) with no allocation rows, and a user preset stored in the
        // old one-agent-per-role JSON shape.
        connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p','Demo','C:/repo','c:/repo','[]',1,0,0,'t','t','t')",[]).unwrap();
        connection.execute("INSERT INTO swarms(id,project_id,project_root,name,mission,lifecycle,phase,team_preset,max_parallel,instructions,progress,priority,archived,created_at,updated_at) VALUES('s','p','c:/repo','Legacy','Keep me','draft','understanding','auto',2,'',0,0,0,'t','t')",[]).unwrap();
        connection
            .execute(
                "INSERT INTO swarm_roles(id,swarm_id,role,runtime,desired_count,enabled) VALUES('rr','s','builder','codex',3,1)",
                [],
            )
            .unwrap();
        connection.execute("INSERT INTO swarm_agents(id,swarm_id,role,runtime,status,created_at,updated_at) VALUES('aa','s','builder','codex','idle','t','t')", []).unwrap();
        connection
            .execute("DELETE FROM swarm_role_allocations WHERE swarm_id='s'", [])
            .unwrap();
        connection
            .execute(
                "INSERT INTO swarm_presets(id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at) VALUES('mine','My Team',0,0,4,'','[{\"role\":\"builder\",\"runtime\":\"claude\",\"desiredCount\":2,\"enabled\":true}]','t','t')",
                [],
            )
            .unwrap();

        // Re-running the migration is idempotent and performs the backfill + JSON upgrade.
        migrate_v16(&connection).unwrap();

        let (runtime, count, allocation_id): (String, i64, String) = connection
            .query_row(
                "SELECT runtime, count, id FROM swarm_role_allocations WHERE swarm_id='s' AND role='builder'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(runtime, "codex");
        assert_eq!(
            count, 3,
            "legacy desired_count is preserved as the allocation count"
        );
        let agent_allocation: Option<String> = connection
            .query_row(
                "SELECT allocation_id FROM swarm_agents WHERE id='aa'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_allocation.as_deref(), Some(allocation_id.as_str()));

        let config: String = connection
            .query_row(
                "SELECT config_json FROM swarm_presets WHERE id='mine'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let roles: Vec<crate::models::swarm::SwarmRoleConfig> =
            serde_json::from_str(&config).unwrap();
        assert_eq!(roles.len(), 1);
        assert_eq!(roles[0].allocations.len(), 1);
        assert_eq!(
            roles[0].allocations[0].runtime,
            crate::models::swarm::SwarmRuntimeKind::Claude
        );
        assert_eq!(roles[0].allocations[0].count, 2);
        assert!(
            !roles[0].allocations[0].id.is_empty(),
            "allocation gains a stable id"
        );
    }

    #[test]
    fn v16_rolls_back_instead_of_erasing_a_malformed_user_preset() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO swarm_presets(id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at) VALUES('broken','Broken',0,0,1,'','{not-json','t','t')",
                [],
            )
            .unwrap();

        let error = migrate_v16(&connection).unwrap_err();
        assert_eq!(error.code, "migration_error");
        assert!(error
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("swarm_preset_migration_failed")));
        let stored: String = connection
            .query_row(
                "SELECT config_json FROM swarm_presets WHERE id='broken'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "{not-json");
    }

    #[test]
    fn v13_repository_projection_upgrades_without_losing_cursors() {
        let connection = Connection::open_in_memory().unwrap();
        apply(&connection).unwrap();
        connection
            .execute_batch(
                "ALTER TABLE repository_sync_cursors RENAME TO repository_sync_cursors_v14;
             CREATE TABLE repository_sync_cursors(
               project_id TEXT NOT NULL, provider TEXT NOT NULL, stream TEXT NOT NULL,
               cursor TEXT, status TEXT NOT NULL, last_attempt_at TEXT, last_success_at TEXT,
               stale_since TEXT, error_code TEXT,
               PRIMARY KEY(project_id,provider,stream)
             );
             INSERT INTO repository_sync_cursors(project_id,provider,stream,status,last_success_at)
               VALUES('project-1','github','workflow_run','healthy','2026-07-17T00:00:00Z');
             DROP TABLE repository_sync_cursors_v14;
             PRAGMA user_version=13;",
            )
            .unwrap();
        apply(&connection).unwrap();
        let preserved: String = connection.query_row(
            "SELECT last_success_at FROM repository_sync_cursors WHERE project_id='project-1' AND stream='workflow_run'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(preserved, "2026-07-17T00:00:00Z");
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn v13_preserves_active_pane_worktrees_as_authoritative_leases() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p','Demo','C:/repo','C:/repo','[]',1,0,0,'t','t','t')",[]).unwrap();
        connection.execute("INSERT INTO workspaces(id,project_id,name,layout_json,created_at,updated_at,last_opened_at) VALUES('w','p','Main','{\"type\":\"pane\",\"paneId\":\"pane\"}','t','t','t')",[]).unwrap();
        connection.execute("INSERT INTO workspace_panes(id,workspace_id,title,provider_type,executable_path,working_directory,position_order,created_at,updated_at) VALUES('pane','w','Agent','codex','codex','C:/worktree',0,'t','t')",[]).unwrap();
        connection.execute("INSERT INTO pane_worktrees(id,project_id,workspace_id,pane_id,repository_path,worktree_path,branch_name,base_ref,status,created_at,updated_at) VALUES('lease','p','w','pane','C:/repo','C:/worktree','paralith/task','0123456789012345678901234567890123456789','active','t','t')",[]).unwrap();

        connection
            .execute_batch(
                "DROP TABLE repository_recovery_checkpoints;
                 DROP TABLE repository_webhook_deliveries;
                 DROP TABLE repository_sync_cursors;
                 DROP TABLE repository_remote_cache;
                 DROP TABLE repository_approvals;
                 DROP TABLE repository_operations;
                 DROP TABLE repository_worktree_leases;
                 DROP TABLE repository_policies;
                 DROP TABLE repository_provider_installations;
                 DROP TABLE repository_provider_accounts;
                 DROP TABLE repository_connections;
                 DELETE FROM schema_migrations WHERE version=13;
                 PRAGMA user_version=12;",
            )
            .unwrap();

        migrate_v13(&connection).unwrap();
        let lease: (String, String, String, String) = connection
            .query_row(
                "SELECT branch_name,agent_id,task_id,status FROM repository_worktree_leases WHERE id='lease'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            lease,
            (
                "paralith/task".into(),
                "pane:pane".into(),
                "workspace:w".into(),
                "active".into()
            )
        );
    }

    #[test]
    fn upgrade_from_v1_restores_strict_session_ownership_in_v4() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        // Simulate an existing on-disk database created before this fix: v1 schema, with the
        // foreign key that rejected every session insert.
        run_migration(&connection, MIGRATION_1, 1).unwrap();
        assert_eq!(
            insert_session(&connection).unwrap_err().to_string(),
            "FOREIGN KEY constraint failed"
        );

        // The final migration deliberately restores strict ownership after Pane metadata
        // is durable, so renderer-created ephemeral sessions remain impossible.
        apply(&connection).unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        let error = insert_session(&connection).unwrap_err().to_string();
        assert!(error.contains("project_id") || error.contains("FOREIGN KEY"));
    }

    #[test]
    fn v3_merges_duplicate_projects_and_dedupes_workspace_names() {
        let connection = Connection::open_in_memory().unwrap();
        run_migration(&connection, MIGRATION_1, 1).unwrap();
        run_migration(&connection, MIGRATION_2, 2).unwrap();
        // A legacy verbatim-prefixed project row alongside its normalized twin.
        for (id, canonical, root, created) in [
            (
                "p-old",
                r"\\?\c:\code\demo",
                r"\\?\c:\code\demo",
                "2020-01-01T00:00:00Z",
            ),
            (
                "p-new",
                r"c:\code\demo",
                r"c:\code\demo",
                "2021-01-01T00:00:00Z",
            ),
        ] {
            connection.execute(
                "INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES(?1,'Demo',?2,?3,'[]',0,0,0,?4,?4,?4)",
                params![id, root, canonical, created],
            ).unwrap();
        }
        // Two workspaces per project; one pair collides case-insensitively after merge.
        for (id, project, name, created) in [
            ("w1", "p-old", "Main", "2020-02-01T00:00:00Z"),
            ("w2", "p-new", "main", "2021-02-01T00:00:00Z"),
            ("w3", "p-new", "Frontend", "2021-03-01T00:00:00Z"),
        ] {
            connection.execute(
                "INSERT INTO workspaces(id,project_id,name,layout_json,created_at,updated_at,last_opened_at) VALUES(?1,?2,?3,'{\"type\":\"pane\",\"paneId\":\"a\"}',?4,?4,?4)",
                params![id, project, name, created],
            ).unwrap();
        }

        apply(&connection).unwrap();

        let project_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap();
        assert_eq!(project_count, 1, "duplicate projects merge into one");
        let keeper: String = connection
            .query_row("SELECT canonical_root_path FROM projects", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(keeper, r"c:\code\demo", "canonical path is normalized");
        // All three workspaces survived and now belong to the surviving project.
        let workspace_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE project_id='p-old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(workspace_count, 3, "workspaces preserved and reassigned");
        // The colliding 'main' was suffixed; the unique index now holds.
        let names: Vec<String> = {
            let mut statement = connection
                .prepare("SELECT name FROM workspaces ORDER BY name")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        // The later duplicate ("main") is suffixed, keeping its own casing; the original
        // "Main" is untouched. The unique index now holds.
        assert_eq!(names, vec!["Frontend", "Main", "main 2"]);
        // Re-applying is idempotent.
        apply(&connection).unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        let normalized: Vec<String> = {
            let mut statement = connection
                .prepare("SELECT normalized_name FROM workspaces ORDER BY normalized_name")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(normalized, vec!["frontend", "main", "main 2"]);
    }

    #[test]
    fn v5_backfills_deterministic_sidebar_sort_order() {
        let connection = Connection::open_in_memory().unwrap();
        // Reach v4 first (v5's ALTER depends on the v4 workspace columns existing).
        run_migration(&connection, MIGRATION_1, 1).unwrap();
        run_migration(&connection, MIGRATION_2, 2).unwrap();
        migrate_v3(&connection).unwrap();
        run_migration_batch(&connection, MIGRATION_4, 4).unwrap();
        connection
            .execute(
                "INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p','Demo','/p','/p','[]',0,0,0,'t','t','t')",
                [],
            )
            .unwrap();
        // Three workspaces opened at distinct times; newest should sort first (0).
        for (id, name, opened) in [
            ("w-old", "Old", "2021-01-01T00:00:00Z"),
            ("w-new", "New", "2021-03-01T00:00:00Z"),
            ("w-mid", "Mid", "2021-02-01T00:00:00Z"),
        ] {
            connection.execute(
                "INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,created_at,updated_at,last_opened_at) VALUES(?1,'p',?2,lower(?2),'{\"type\":\"pane\",\"paneId\":\"a\"}','t','t',?3)",
                params![id, name, opened],
            ).unwrap();
        }

        run_migration_batch(&connection, MIGRATION_5, 5).unwrap();

        let ordered: Vec<(String, i64)> = {
            let mut statement = connection
                .prepare("SELECT id,sort_order FROM workspaces ORDER BY sort_order")
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            ordered,
            vec![
                ("w-new".to_owned(), 0),
                ("w-mid".to_owned(), 1),
                ("w-old".to_owned(), 2),
            ],
            "most-recently-opened workspace backfills to sort_order 0"
        );

        // Idempotent: a second apply must not disturb the assigned order.
        apply(&connection).unwrap();
        let unchanged: Vec<i64> = {
            let mut statement = connection
                .prepare("SELECT sort_order FROM workspaces ORDER BY id")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(unchanged, vec![1, 0, 2]);
    }

    fn schema_through_v6(connection: &Connection) {
        run_migration(connection, MIGRATION_1, 1).unwrap();
        run_migration(connection, MIGRATION_2, 2).unwrap();
        migrate_v3(connection).unwrap();
        run_migration_batch(connection, MIGRATION_4, 4).unwrap();
        run_migration_batch(connection, MIGRATION_5, 5).unwrap();
        run_migration_batch(connection, MIGRATION_6, 6).unwrap();
    }

    #[test]
    fn upgrades_each_shipped_mission_memory_schema_to_v10_without_loss() {
        for starting_version in [7_i64, 8, 9] {
            let connection = Connection::open_in_memory().unwrap();
            connection
                .pragma_update(None, "foreign_keys", true)
                .unwrap();
            schema_through_v6(&connection);
            migrate_v7(&connection).unwrap();
            connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p','Preserved','/p','/p','[]',0,0,0,'t','t','t')",[]).unwrap();
            connection.execute("INSERT INTO missions(id,project_id,title,objective,constraints_json,reference_paths_json,preferred_agent_ids_json,status,execution_mode,risk_level,permission_profile,created_at,updated_at) VALUES('m','p','Keep','Keep data','[]','[]','[]','draft','manual-plan','low','observe','t','t')",[]).unwrap();
            if starting_version >= 8 {
                migrate_v8(&connection).unwrap();
                connection.execute("INSERT INTO memory_items(id,project_id,memory_type,dedup_key,title,state,visibility,pinned,created_at,updated_at) VALUES('mem','p','note','keep-memory','Keep memory','active','project_shared',0,'t','t')",[]).unwrap();
            }
            if starting_version >= 9 {
                migrate_v9(&connection).unwrap();
            }
            connection
                .pragma_update(None, "user_version", starting_version)
                .unwrap();
            apply(&connection).unwrap();
            let version: i64 = connection
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, CURRENT_SCHEMA_VERSION);
            assert_eq!(
                connection
                    .query_row("SELECT title FROM missions WHERE id='m'", [], |row| row
                        .get::<_, String>(
                        0
                    ))
                    .unwrap(),
                "Keep"
            );
            if starting_version >= 8 {
                assert_eq!(
                    connection
                        .query_row("SELECT title FROM memory_items WHERE id='mem'", [], |row| {
                            row.get::<_, String>(0)
                        })
                        .unwrap(),
                    "Keep memory"
                );
            }
        }
    }

    #[test]
    fn repairs_unsafe_partial_v7_placement_schema_and_preserves_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        schema_through_v6(&connection);
        connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p','Partial','/p','/p','[]',0,0,0,'t','t','t')",[]).unwrap();
        connection.execute("INSERT INTO workspaces(id,project_id,name,normalized_name,layout_json,created_at,updated_at,last_opened_at) VALUES('w','p','Main','main','{\"type\":\"pane\",\"paneId\":\"a\"}','t','t','t')",[]).unwrap();
        connection.execute_batch("CREATE TABLE open_project_sessions(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,is_active INTEGER NOT NULL DEFAULT 0,last_workspace_id TEXT,last_pane_id TEXT,expanded INTEGER NOT NULL DEFAULT 1,opened_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE workspace_placements(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,mode TEXT NOT NULL DEFAULT 'attached',window_label TEXT,monitor_id TEXT,monitor_alias TEXT,pos_x INTEGER,pos_y INTEGER,width INTEGER,height INTEGER,maximized INTEGER NOT NULL DEFAULT 0,fullscreen INTEGER NOT NULL DEFAULT 0,placement_revision INTEGER NOT NULL DEFAULT 0,last_focus_at TEXT);CREATE TABLE monitor_aliases(monitor_key TEXT PRIMARY KEY,alias TEXT NOT NULL,updated_at TEXT NOT NULL);").unwrap();
        connection.execute("INSERT INTO open_project_sessions(project_id,is_active,last_workspace_id,expanded,opened_at,updated_at) VALUES('p',1,'w',1,'t','t')",[]).unwrap();
        connection.execute("INSERT INTO workspace_placements(workspace_id,mode,window_label,monitor_id,monitor_alias,pos_x,pos_y,width,height,placement_revision) VALUES('w','detached','ws-w','Display@1920,0','Right',1920,0,1200,800,4)",[]).unwrap();
        connection.execute("INSERT INTO monitor_aliases(monitor_key,alias,updated_at) VALUES('Display@1920,0','Right','t')",[]).unwrap();
        record_migration(&connection, 7).unwrap();
        apply(&connection).unwrap();
        assert!(table_exists(&connection, "missions").unwrap());
        assert!(table_exists(&connection, "memory_items").unwrap());
        let row:(String,String,Option<String>,i64)=connection.query_row("SELECT mode,monitor_alias,preferred_monitor_id,placement_revision FROM workspace_placements WHERE workspace_id='w'",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).unwrap();
        assert_eq!(
            row,
            (
                "detached".into(),
                "Right".into(),
                Some("Display@1920,0".into()),
                4
            )
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM open_project_sessions WHERE project_id='p'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn upgrades_v17_to_context_packs_without_losing_memory_or_presets() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p18','Preserved','/p18','/p18','[]',0,0,0,'t','t','t')", []).unwrap();
        connection.execute("INSERT INTO memory_items(id,project_id,memory_type,dedup_key,title,state,visibility,pinned,created_at,updated_at) VALUES('mem18','p18','procedure','keep-v18','Keep memory','active','project_shared',0,'t','t')", []).unwrap();
        connection.execute("INSERT INTO swarm_presets(id,name,builtin,is_default,max_parallel,instructions,config_json,created_at,updated_at) VALUES('preset18','Keep preset',0,0,2,'','[]','t','t')", []).unwrap();
        connection.execute_batch("DROP TABLE swarm_context_packs; DELETE FROM schema_migrations WHERE version=18; PRAGMA user_version=17;").unwrap();

        apply(&connection).unwrap();

        assert!(table_exists(&connection, "swarm_context_packs").unwrap());
        assert!(column_exists(&connection, "swarm_tasks", "repair_for_task_id").unwrap());
        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM memory_items WHERE id='mem18'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "Keep memory"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT name FROM swarm_presets WHERE id='preset18'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "Keep preset"
        );
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
    }

    /// The real installed Preview build reports database schema 10 (`readiness.json`). An update to
    /// the Orchestrator build must migrate that database through the full ladder to the current
    /// schema, create the orchestration tables, and preserve every pre-existing canonical record.
    /// This exercises that exact 10 → current path with schema-10-era data present.
    #[test]
    fn upgrades_installed_schema_10_to_current_preserving_data() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();

        // Canonical user data that exists at schema 10 (projects/app_settings are v1, memory_items
        // is v8). These stand in for the installed user's projects, settings, and memory.
        connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p10','Installed Project','/p10','/p10','[]',1,1,1,'t','t','t')", []).unwrap();
        connection
            .execute(
                "INSERT INTO app_settings(key,value_json,updated_at) VALUES('settings','{\"kept\":true}','t')",
                [],
            )
            .unwrap();
        connection.execute("INSERT INTO memory_items(id,project_id,memory_type,dedup_key,title,state,visibility,pinned,created_at,updated_at) VALUES('m10','p10','procedure','keep-10','Installed memory','active','project_shared',0,'t','t')", []).unwrap();

        // Simulate the installed schema-10 database: the post-10 additions this update introduces do
        // not yet exist, and the schema ledger reflects version 10. The intermediate tables carry
        // idempotent `IF NOT EXISTS` DDL, so re-running the ladder over them proves it is safe.
        connection
            .execute_batch(
                "DROP TABLE IF EXISTS orchestration_capability_executions;\
                 DROP TABLE IF EXISTS orchestration_events;\
                 DROP TABLE IF EXISTS orchestration_turns;\
                 DROP TABLE IF EXISTS orchestration_sessions;\
                 DELETE FROM schema_migrations WHERE version > 10;\
                 PRAGMA user_version=10;",
            )
            .unwrap();
        assert!(!table_exists(&connection, "orchestration_sessions").unwrap());

        // Run the full ladder 10 -> current.
        apply(&connection).unwrap();

        // Schema advanced to the current version and the orchestration tables now exist.
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        for table in [
            "orchestration_sessions",
            "orchestration_turns",
            "orchestration_events",
            "orchestration_capability_executions",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
        }

        // Pre-existing canonical data survived the migration untouched.
        assert_eq!(
            connection
                .query_row("SELECT name FROM projects WHERE id='p10'", [], |row| row
                    .get::<_, String>(
                    0
                ))
                .unwrap(),
            "Installed Project"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key='settings'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "{\"kept\":true}"
        );
        assert_eq!(
            connection
                .query_row("SELECT title FROM memory_items WHERE id='m10'", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "Installed memory"
        );

        // Integrity holds and a second startup does not re-run migrations (idempotent).
        assert_eq!(
            connection
                .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        assert!(!requires_migration(&connection).unwrap());
        apply(&connection).unwrap();
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn database_studio_v28_contract_constraints_match_gate1_probe() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();

        let object_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='database_objects'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(object_sql.contains("snapshot_id TEXT NOT NULL DEFAULT ''"));
        assert!(object_sql.contains("design_revision_id TEXT NOT NULL DEFAULT ''"));
        assert!(object_sql.contains("snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE"));
        assert!(object_sql.contains("design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE"));
        assert!(object_sql.contains("CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> ''))"));
        assert!(object_sql.contains("PRIMARY KEY(id, snapshot_id, design_revision_id)"));

        connection.execute("INSERT INTO database_sources(id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at) VALUES('src','repo','primary','Primary PostgreSQL','postgres',NULL,1,'t','t')", []).unwrap();
        connection.execute("INSERT INTO database_snapshots(id,source_id,layer,adapter_id,fingerprint,object_count,edge_count,extractor_version,status,created_at) VALUES('snap','src','declared','prisma','fp',0,0,'v','ready','t')", []).unwrap();
        connection.execute("INSERT INTO database_objects(id,source_id,snapshot_id,layer,object_kind,logical_key,qualified_name,payload_version,typed_payload_json,content_fingerprint,confidence,discovered_at,observed_at,updated_at) VALUES('obj','src','snap','declared','table','k','public.users',1,'{}','fp',1,'t','t','t')", []).unwrap();
        assert!(connection.execute("INSERT INTO database_objects(id,source_id,snapshot_id,layer,object_kind,logical_key,qualified_name,payload_version,typed_payload_json,content_fingerprint,confidence,discovered_at,observed_at,updated_at) VALUES('obj','src','snap','declared','table','k','public.users',1,'{}','fp',1,'t','t','t')", []).is_err());
        assert!(connection.execute("INSERT INTO database_objects(id,source_id,layer,object_kind,logical_key,qualified_name,payload_version,typed_payload_json,content_fingerprint,confidence,discovered_at,observed_at,updated_at) VALUES('bad','src','declared','table','k','public.bad',1,'{}','fp',1,'t','t','t')", []).is_err());
        assert!(connection.execute("INSERT INTO database_objects(id,source_id,snapshot_id,design_revision_id,layer,object_kind,logical_key,qualified_name,payload_version,typed_payload_json,content_fingerprint,confidence,discovered_at,observed_at,updated_at) VALUES('bad2','src','snap','rev','declared','table','k','public.bad',1,'{}','fp',1,'t','t','t')", []).is_err());
        assert!(connection.execute("INSERT INTO database_objects(id,source_id,snapshot_id,layer,object_kind,logical_key,qualified_name,payload_version,typed_payload_json,content_fingerprint,confidence,discovered_at,observed_at,updated_at) VALUES('missing','src','missing-snapshot','declared','table','k','public.missing',1,'{}','fp',1,'t','t','t')", []).is_err());
        connection.execute("INSERT INTO database_edges(id,source_id,snapshot_id,source_object_id,target_object_id,edge_type,confidence,created_at) VALUES('edge','src','snap','obj','obj','CONTAINS',1,'t')", []).unwrap();
        assert!(connection.execute("INSERT INTO database_edges(id,source_id,snapshot_id,source_object_id,target_object_id,edge_type,confidence,created_at) VALUES('edge2','src','snap','obj','obj','CONTAINS',1,'t')", []).is_err());
    }

    #[test]
    fn database_studio_upgrades_installed_schema_27_to_current_preserving_data() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        apply(&connection).unwrap();
        connection.execute("INSERT INTO projects(id,name,root_path,canonical_root_path,major_languages_json,is_git_repository,has_package_json,has_lockfile,created_at,updated_at,last_opened_at) VALUES('p27','Schema 27 Project','/p27','/p27','[]',1,1,1,'t','t','t')", []).unwrap();
        connection.execute_batch("DROP TABLE database_usage_refs; DROP TABLE database_issues; DROP TABLE database_diffs; DROP TABLE database_layouts; DROP TABLE database_design_operations; DROP TABLE database_design_revisions; DROP TABLE database_designs; DROP TABLE database_object_provenance; DROP TABLE database_edges; DROP TABLE database_objects; DROP TABLE database_snapshots; DROP TABLE database_source_evidence; DROP TABLE database_sources; DELETE FROM schema_migrations WHERE version > 27; PRAGMA user_version=27;").unwrap();
        assert!(requires_migration(&connection).unwrap());
        apply(&connection).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT name FROM projects WHERE id='p27'", [], |row| row
                    .get::<_, String>(
                    0
                ))
                .unwrap(),
            "Schema 27 Project"
        );
        assert!(table_exists(&connection, "database_sources").unwrap());
        assert!(!requires_migration(&connection).unwrap());
    }
}
