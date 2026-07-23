//! Persistence for the Paralith Orchestration Kernel. Sessions, transcript turns, the append-only
//! event timeline, and capability-execution records are owned here. The kernel
//! ([`crate::orchestration::OrchestrationKernel`]) reads and writes exclusively through these
//! methods, so the database stays the single authority the frontend renders and the surface that
//! survives UI remounts and application restart.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::orchestration::model::{
    CapabilityExecution, ExecutionState, InputType, OperatingMode, OrchestrationEvent,
    OrchestrationSession, OrchestrationTurn, OriginatingSurface, RiskLevel, SessionState,
    TurnActor,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

fn decode<T>(value: Option<T>, column: &'static str) -> rusqlite::Result<T> {
    value.ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unrecognized orchestration enum in column {column}"),
            )),
        )
    })
}

fn row_to_session(row: &Row<'_>) -> rusqlite::Result<OrchestrationSession> {
    let surface: String = row.get(2)?;
    let mode: String = row.get(5)?;
    let state: String = row.get(6)?;
    Ok(OrchestrationSession {
        id: row.get(0)?,
        title: row.get(1)?,
        originating_surface: decode(OriginatingSurface::from_db(&surface), "originating_surface")?,
        project_id: row.get(3)?,
        workspace_id: row.get(4)?,
        operating_mode: decode(OperatingMode::from_db(&mode), "operating_mode")?,
        state: decode(SessionState::from_db(&state), "state")?,
        objective: row.get(7)?,
        normalized_objective: row.get(8)?,
        failure_classification: row.get(9)?,
        token_budget: row.get(10)?,
        tokens_used: row.get(11)?,
        provider: row.get(12)?,
        model: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        started_at: row.get(16)?,
        completed_at: row.get(17)?,
    })
}

const SESSION_COLUMNS: &str = "id,title,originating_surface,project_id,workspace_id,operating_mode,state,objective,normalized_objective,failure_classification,token_budget,tokens_used,provider,model,created_at,updated_at,started_at,completed_at";

fn row_to_turn(row: &Row<'_>) -> rusqlite::Result<OrchestrationTurn> {
    let actor: String = row.get(2)?;
    let input_type: String = row.get(3)?;
    Ok(OrchestrationTurn {
        id: row.get(0)?,
        session_id: row.get(1)?,
        actor: decode(TurnActor::from_db(&actor), "actor")?,
        input_type: decode(InputType::from_db(&input_type), "input_type")?,
        content: row.get(4)?,
        transcript_confidence: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn row_to_event(row: &Row<'_>) -> rusqlite::Result<OrchestrationEvent> {
    Ok(OrchestrationEvent {
        id: row.get(0)?,
        session_id: row.get(1)?,
        sequence: row.get(2)?,
        event_type: row.get(3)?,
        payload_json: row.get(4)?,
        source: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn row_to_execution(row: &Row<'_>) -> rusqlite::Result<CapabilityExecution> {
    let risk: String = row.get(3)?;
    let state: String = row.get(6)?;
    Ok(CapabilityExecution {
        id: row.get(0)?,
        session_id: row.get(1)?,
        capability_id: row.get(2)?,
        risk_level: decode(RiskLevel::from_db(&risk), "risk_level")?,
        validated_inputs_json: row.get(4)?,
        sanitized_result_json: row.get(5)?,
        state: decode(ExecutionState::from_db(&state), "state")?,
        error_classification: row.get(7)?,
        duration_ms: row.get(8)?,
        created_at: row.get(9)?,
        completed_at: row.get(10)?,
    })
}

impl DatabaseService {
    pub fn insert_orchestration_session(&self, session: &OrchestrationSession) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO orchestration_sessions(id,title,originating_surface,project_id,workspace_id,operating_mode,state,objective,normalized_objective,failure_classification,token_budget,tokens_used,provider,model,created_at,updated_at,started_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
            params![
                session.id,
                session.title,
                session.originating_surface.as_str(),
                session.project_id,
                session.workspace_id,
                session.operating_mode.as_str(),
                session.state.as_str(),
                session.objective,
                session.normalized_objective,
                session.failure_classification,
                session.token_budget,
                session.tokens_used,
                session.provider,
                session.model,
                session.created_at,
                session.updated_at,
                session.started_at,
                session.completed_at,
            ],
        )?;
        Ok(())
    }

    /// Persist the mutable fields of a session after a validated state transition or budget update.
    pub fn update_orchestration_session(&self, session: &OrchestrationSession) -> AppResult<()> {
        let affected = self.connection.lock().execute(
            "UPDATE orchestration_sessions SET title=?2,operating_mode=?3,state=?4,normalized_objective=?5,failure_classification=?6,token_budget=?7,tokens_used=?8,provider=?9,model=?10,updated_at=?11,started_at=?12,completed_at=?13 WHERE id=?1",
            params![
                session.id,
                session.title,
                session.operating_mode.as_str(),
                session.state.as_str(),
                session.normalized_objective,
                session.failure_classification,
                session.token_budget,
                session.tokens_used,
                session.provider,
                session.model,
                session.updated_at,
                session.started_at,
                session.completed_at,
            ],
        )?;
        if affected == 0 {
            return Err(AppError::new(
                "orchestration_session_not_found",
                "The orchestration session no longer exists.",
                true,
            )
            .entity(&session.id)
            .layer("orchestration"));
        }
        Ok(())
    }

    pub fn get_orchestration_session(&self, id: &str) -> AppResult<OrchestrationSession> {
        self.connection
            .lock()
            .query_row(
                &format!("SELECT {SESSION_COLUMNS} FROM orchestration_sessions WHERE id=?1"),
                [id],
                row_to_session,
            )
            .optional()?
            .ok_or_else(|| {
                AppError::new(
                    "orchestration_session_not_found",
                    "The orchestration session no longer exists.",
                    true,
                )
                .entity(id)
                .layer("orchestration")
            })
    }

    /// Recent sessions newest-first, optionally scoped to one project. `None` returns every session
    /// (main-window scope); `Some(project)` returns that project's sessions plus unbound ones.
    pub fn list_orchestration_sessions(
        &self,
        project_id: Option<&str>,
        limit: i64,
    ) -> AppResult<Vec<OrchestrationSession>> {
        let connection = self.connection.lock();
        let sessions = match project_id {
            Some(project) => {
                let mut statement = connection.prepare(&format!(
                    "SELECT {SESSION_COLUMNS} FROM orchestration_sessions WHERE project_id=?1 OR project_id IS NULL ORDER BY updated_at DESC LIMIT ?2"
                ))?;
                let rows = statement
                    .query_map(params![project, limit], row_to_session)?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            }
            None => {
                let mut statement = connection.prepare(&format!(
                    "SELECT {SESSION_COLUMNS} FROM orchestration_sessions ORDER BY updated_at DESC LIMIT ?1"
                ))?;
                let rows = statement
                    .query_map(params![limit], row_to_session)?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            }
        };
        Ok(sessions)
    }

    /// Interrupted sessions that were left in a non-terminal state — the recovery candidates after
    /// an application restart.
    pub fn list_interrupted_orchestration_sessions(&self) -> AppResult<Vec<OrchestrationSession>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(&format!(
            "SELECT {SESSION_COLUMNS} FROM orchestration_sessions WHERE state NOT IN ('completed','partially_completed','cancelled','failed','idle') ORDER BY updated_at DESC"
        ))?;
        let sessions = statement
            .query_map([], row_to_session)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn insert_orchestration_turn(&self, turn: &OrchestrationTurn) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO orchestration_turns(id,session_id,actor,input_type,content,transcript_confidence,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                turn.id,
                turn.session_id,
                turn.actor.as_str(),
                turn.input_type.as_str(),
                turn.content,
                turn.transcript_confidence,
                turn.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_orchestration_turns(&self, session_id: &str) -> AppResult<Vec<OrchestrationTurn>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,session_id,actor,input_type,content,transcript_confidence,created_at FROM orchestration_turns WHERE session_id=?1 ORDER BY created_at ASC, rowid ASC",
        )?;
        let turns = statement
            .query_map([session_id], row_to_turn)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(turns)
    }

    /// Append an event to a session's ordered timeline, assigning the next per-session sequence
    /// under the connection lock so concurrent appends cannot collide on `sequence`.
    pub fn append_orchestration_event(
        &self,
        session_id: &str,
        event_type: &str,
        payload_json: &str,
        source: &str,
    ) -> AppResult<OrchestrationEvent> {
        let connection = self.connection.lock();
        let sequence: i64 = connection.query_row(
            "SELECT COALESCE(MAX(sequence)+1,0) FROM orchestration_events WHERE session_id=?1",
            [session_id],
            |row| row.get(0),
        )?;
        let event = OrchestrationEvent {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_owned(),
            sequence,
            event_type: event_type.to_owned(),
            payload_json: payload_json.to_owned(),
            source: source.to_owned(),
            created_at: Utc::now().to_rfc3339(),
        };
        connection.execute(
            "INSERT INTO orchestration_events(id,session_id,sequence,event_type,payload_json,source,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                event.id,
                event.session_id,
                event.sequence,
                event.event_type,
                event.payload_json,
                event.source,
                event.created_at,
            ],
        )?;
        Ok(event)
    }

    pub fn list_orchestration_events(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<OrchestrationEvent>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,session_id,sequence,event_type,payload_json,source,created_at FROM orchestration_events WHERE session_id=?1 ORDER BY sequence ASC",
        )?;
        let events = statement
            .query_map([session_id], row_to_event)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(events)
    }

    pub fn insert_orchestration_execution(&self, execution: &CapabilityExecution) -> AppResult<()> {
        self.connection.lock().execute(
            "INSERT INTO orchestration_capability_executions(id,session_id,capability_id,risk_level,validated_inputs_json,sanitized_result_json,state,error_classification,duration_ms,created_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(id) DO UPDATE SET sanitized_result_json=excluded.sanitized_result_json,state=excluded.state,error_classification=excluded.error_classification,duration_ms=excluded.duration_ms,completed_at=excluded.completed_at",
            params![
                execution.id,
                execution.session_id,
                execution.capability_id,
                execution.risk_level.as_str(),
                execution.validated_inputs_json,
                execution.sanitized_result_json,
                execution.state.as_str(),
                execution.error_classification,
                execution.duration_ms,
                execution.created_at,
                execution.completed_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_orchestration_executions(
        &self,
        session_id: &str,
    ) -> AppResult<Vec<CapabilityExecution>> {
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT id,session_id,capability_id,risk_level,validated_inputs_json,sanitized_result_json,state,error_classification,duration_ms,created_at,completed_at FROM orchestration_capability_executions WHERE session_id=?1 ORDER BY created_at ASC, rowid ASC",
        )?;
        let executions = statement
            .query_map([session_id], row_to_execution)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(executions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestration::model::OrchestrationSession;

    fn session(id: &str) -> OrchestrationSession {
        let now = Utc::now().to_rfc3339();
        OrchestrationSession {
            id: id.to_owned(),
            title: "Repair the browser".to_owned(),
            originating_surface: OriginatingSurface::InvocationBar,
            project_id: None,
            workspace_id: None,
            operating_mode: OperatingMode::Execute,
            state: SessionState::Idle,
            objective: "Repair the embedded browser and verify it.".to_owned(),
            normalized_objective: None,
            failure_classification: None,
            token_budget: Some(100_000),
            tokens_used: 0,
            provider: None,
            model: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            started_at: None,
            completed_at: None,
        }
    }

    #[test]
    fn session_round_trips_and_updates() {
        let database = DatabaseService::in_memory().unwrap();
        let mut record = session("s1");
        database.insert_orchestration_session(&record).unwrap();

        let loaded = database.get_orchestration_session("s1").unwrap();
        assert_eq!(loaded.objective, record.objective);
        assert_eq!(loaded.state, SessionState::Idle);

        record.state = SessionState::Executing;
        record.started_at = Some(Utc::now().to_rfc3339());
        database.update_orchestration_session(&record).unwrap();
        assert_eq!(
            database.get_orchestration_session("s1").unwrap().state,
            SessionState::Executing
        );
    }

    #[test]
    fn events_get_monotonic_per_session_sequence() {
        let database = DatabaseService::in_memory().unwrap();
        database
            .insert_orchestration_session(&session("s2"))
            .unwrap();
        let first = database
            .append_orchestration_event("s2", "session_created", "{}", "kernel")
            .unwrap();
        let second = database
            .append_orchestration_event("s2", "capability_started", "{}", "gateway")
            .unwrap();
        assert_eq!(first.sequence, 0);
        assert_eq!(second.sequence, 1);
        assert_eq!(database.list_orchestration_events("s2").unwrap().len(), 2);
    }

    #[test]
    fn interrupted_sessions_exclude_terminal_and_idle() {
        let database = DatabaseService::in_memory().unwrap();
        let mut running = session("running");
        running.state = SessionState::Executing;
        database.insert_orchestration_session(&running).unwrap();
        let mut done = session("done");
        done.state = SessionState::Completed;
        database.insert_orchestration_session(&done).unwrap();

        let interrupted = database.list_interrupted_orchestration_sessions().unwrap();
        assert_eq!(interrupted.len(), 1);
        assert_eq!(interrupted[0].id, "running");
    }
}
