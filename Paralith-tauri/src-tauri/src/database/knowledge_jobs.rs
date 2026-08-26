//! Persistence for the knowledge job queue.
//!
//! The queue is a table rather than a channel because the work it carries is knowledge
//! maintenance: a change that arrives while PARALITH is closing must still be analyzed on the
//! next launch, and an automatic write to a memory has to leave an auditable record of what
//! triggered it. Every method here is Project-scoped in its WHERE clause, like the rest of the
//! Context Fabric persistence.
//!
//! Claiming is a conditional UPDATE, not a select-then-update: the row is only claimed if it is
//! still in a claimable state, so two workers racing for the same job cannot both win.

use super::DatabaseService;
use crate::errors::AppResult;
use crate::models::knowledge::*;
use crate::models::KnowledgeJobDiagnostics;
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

/// Cap on a job listing. The queue drains, so a healthy Project has few rows; the bound exists so
/// a Project that accumulated failures cannot stream its whole history into IPC.
const MAX_JOBS: usize = 200;

/// Terminal rows older than this are pruned when the queue is next written. Job history is
/// diagnostic, not canonical: nothing else references it, so keeping it forever would grow a
/// table that no query benefits from.
const RETAIN_TERMINAL_DAYS: i64 = 7;

fn row_to_job(row: &Row<'_>) -> rusqlite::Result<KnowledgeJob> {
    let kind: String = row.get("kind")?;
    let status: String = row.get("status")?;
    Ok(KnowledgeJob {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        // Reads are filtered to known kinds in SQL, so the fallback is unreachable rather than a
        // silent reinterpretation. An unknown *status* from a newer build reads as `failed`: the
        // conservative direction, since the alternative would make it claimable.
        kind: KnowledgeJobKind::parse(&kind).unwrap_or(KnowledgeJobKind::AnalyzeImpact),
        status: KnowledgeJobStatus::parse(&status).unwrap_or(KnowledgeJobStatus::Failed),
        payload: row.get("payload")?,
        attempts: row.get("attempts")?,
        max_attempts: row.get("max_attempts")?,
        dedup_key: row.get("dedup_key")?,
        result: row.get("result")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

const JOB_COLUMNS: &str = "id,project_id,kind,status,payload,attempts,max_attempts,dedup_key,\
                           result,error,created_at,started_at,finished_at";

/// SQL literal list of the kinds this build can run, e.g. `'analyze_impact'`.
///
/// Every read filters on it so a row written by a newer build — a kind this binary has no handler
/// for — is left untouched instead of being claimed and immediately failed. Downgrading PARALITH
/// must not destroy queued work it does not understand. The values are compile-time constants, so
/// this is interpolation of a fixed vocabulary, never of caller input.
fn known_kinds() -> String {
    KnowledgeJobKind::ALL
        .iter()
        .map(|kind| format!("'{}'", kind.as_str()))
        .collect::<Vec<_>>()
        .join(",")
}

impl DatabaseService {
    pub fn knowledge_job_diagnostics(&self) -> AppResult<KnowledgeJobDiagnostics> {
        let connection = self.connection.lock();
        let mut diagnostics = KnowledgeJobDiagnostics::default();
        let mut statement = connection.prepare(
            "SELECT status,COUNT(*),COALESCE(SUM(LENGTH(payload)),0) FROM memory_jobs \
             WHERE status IN ('queued','running','retrying','failed') GROUP BY status",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (status, count, payload_bytes) = row?;
            let count = count.max(0) as u64;
            let payload_bytes = payload_bytes.max(0) as u64;
            match status.as_str() {
                "queued" => diagnostics.queued = count,
                "running" => diagnostics.running = count,
                "retrying" => diagnostics.retrying = count,
                "failed" => diagnostics.failed = count,
                _ => {}
            }
            diagnostics.payload_bytes = diagnostics.payload_bytes.saturating_add(payload_bytes);
        }
        Ok(diagnostics)
    }

    /// Queue a job, coalescing into an existing claimable job with the same `dedup_key`.
    ///
    /// Coalescing replaces the payload rather than appending to it, because only the caller knows
    /// whether two payloads union or supersede one another.
    /// [`Self::pending_impact_paths`] exists so the caller can read what is already queued and
    /// union into it — which is what the changed-paths enqueuer does, so a burst of saves does not
    /// discard the paths that were already waiting.
    ///
    /// Returns the id of the job that now carries the work — a new row, or the existing one.
    pub fn enqueue_knowledge_job(
        &self,
        project_id: &str,
        kind: KnowledgeJobKind,
        payload: &str,
        dedup_key: Option<&str>,
    ) -> AppResult<String> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let now = Utc::now().to_rfc3339();
        if let Some(key) = dedup_key {
            let existing: Option<String> = transaction
                .query_row(
                    "SELECT id FROM memory_jobs \
                     WHERE project_id=?1 AND dedup_key=?2 AND status IN ('queued','retrying') \
                     LIMIT 1",
                    params![project_id, key],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(id) = existing {
                transaction.execute(
                    "UPDATE memory_jobs SET payload=?1 WHERE id=?2",
                    params![payload, id],
                )?;
                transaction.commit()?;
                return Ok(id);
            }
        }
        let id = Uuid::new_v4().to_string();
        transaction.execute(
            "INSERT INTO memory_jobs(id,project_id,kind,status,payload,dedup_key,created_at) \
             VALUES(?1,?2,?3,'queued',?4,?5,?6)",
            params![id, project_id, kind.as_str(), payload, dedup_key, now],
        )?;
        transaction.commit()?;
        Ok(id)
    }

    /// Claim the oldest claimable job across all Projects, moving it to `running` in the same
    /// statement that selects it.
    ///
    /// The conditional UPDATE is what makes this safe: if another worker claimed the row between
    /// the SELECT and the UPDATE, the UPDATE matches zero rows and this call returns `None`
    /// rather than running the job twice.
    pub fn claim_knowledge_job(&self) -> AppResult<Option<KnowledgeJob>> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let candidate: Option<String> = transaction
            .query_row(
                &format!(
                    "SELECT id FROM memory_jobs WHERE status IN ('queued','retrying') \
                     AND kind IN ({}) ORDER BY created_at LIMIT 1",
                    known_kinds()
                ),
                [],
                |row| row.get(0),
            )
            .optional()?;
        let Some(id) = candidate else {
            transaction.commit()?;
            return Ok(None);
        };
        let now = Utc::now().to_rfc3339();
        let claimed = transaction.execute(
            "UPDATE memory_jobs SET status='running',attempts=attempts+1,started_at=?1,error=NULL \
             WHERE id=?2 AND status IN ('queued','retrying')",
            params![now, id],
        )?;
        if claimed == 0 {
            transaction.commit()?;
            return Ok(None);
        }
        let job = transaction.query_row(
            &format!("SELECT {JOB_COLUMNS} FROM memory_jobs WHERE id=?1"),
            params![id],
            row_to_job,
        )?;
        transaction.commit()?;
        Ok(Some(job))
    }

    /// Record a successful run and prune aged terminal rows.
    pub fn complete_knowledge_job(&self, job_id: &str, result: &str) -> AppResult<()> {
        let connection = self.connection.lock();
        let now = Utc::now().to_rfc3339();
        connection.execute(
            "UPDATE memory_jobs SET status='complete',result=?1,error=NULL,finished_at=?2 \
             WHERE id=?3",
            params![result, now, job_id],
        )?;
        prune(&connection)?;
        Ok(())
    }

    /// Record a failed attempt. The job returns to the queue as `retrying` while attempts remain,
    /// and only becomes terminally `failed` once they are exhausted — so a transient filesystem
    /// error does not permanently drop a staleness analysis, and a genuinely broken job does not
    /// spin forever.
    ///
    /// Returns the status the job landed in.
    pub fn fail_knowledge_job(&self, job_id: &str, error: &str) -> AppResult<KnowledgeJobStatus> {
        let connection = self.connection.lock();
        let now = Utc::now().to_rfc3339();
        let (attempts, max_attempts): (i64, i64) = connection.query_row(
            "SELECT attempts,max_attempts FROM memory_jobs WHERE id=?1",
            params![job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let exhausted = attempts >= max_attempts;
        let status = if exhausted {
            KnowledgeJobStatus::Failed
        } else {
            KnowledgeJobStatus::Retrying
        };
        connection.execute(
            "UPDATE memory_jobs SET status=?1,error=?2,finished_at=?3 WHERE id=?4",
            params![
                status.as_str(),
                error,
                if exhausted { Some(now) } else { None },
                job_id
            ],
        )?;
        prune(&connection)?;
        Ok(status)
    }

    /// Return jobs the previous process died holding to the queue.
    ///
    /// A crash — or a plain window close mid-analysis — leaves a row in `running`, and
    /// [`Self::claim_knowledge_job`] only claims `queued` and `retrying`. Without this the job is
    /// stranded: never run, never failed, and (because `dedup_key` matching also ignores `running`)
    /// silently shadowed by every later enqueue of the same kind.
    ///
    /// The attempt was already counted when it was claimed, so a job that reliably kills the
    /// process is retried at most `max_attempts` times and then recorded as failed rather than
    /// crash-looping on every launch.
    ///
    /// Safe only because it runs once at startup, before the single worker begins: at that moment
    /// no live handler owns a `running` row.
    pub fn recover_running_knowledge_jobs(&self) -> AppResult<usize> {
        let connection = self.connection.lock();
        let now = Utc::now().to_rfc3339();
        let recovered = connection.execute(
            "UPDATE memory_jobs \
             SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retrying' END, \
                 error = 'interrupted before completion', \
                 finished_at = CASE WHEN attempts >= max_attempts THEN ?1 ELSE NULL END \
             WHERE status='running'",
            params![now],
        )?;
        Ok(recovered)
    }

    /// Cancel a job that has not started, or stop a failing job from retrying. A `running` job is
    /// left alone: the queue cannot interrupt a handler mid-write, and pretending otherwise would
    /// report a cancellation that did not happen.
    pub fn cancel_knowledge_job(&self, project_id: &str, job_id: &str) -> AppResult<bool> {
        let connection = self.connection.lock();
        let now = Utc::now().to_rfc3339();
        let changed = connection.execute(
            "UPDATE memory_jobs SET status='cancelled',finished_at=?1 \
             WHERE id=?2 AND project_id=?3 AND status IN ('queued','retrying')",
            params![now, job_id, project_id],
        )?;
        Ok(changed > 0)
    }

    /// Job rows for a Project, newest first. `active_only` restricts to work that has not
    /// finished, which is what a status indicator needs.
    pub fn list_knowledge_jobs(
        &self,
        project_id: &str,
        active_only: bool,
        limit: Option<usize>,
    ) -> AppResult<Vec<KnowledgeJob>> {
        let connection = self.connection.lock();
        let capped = limit.unwrap_or(MAX_JOBS).min(MAX_JOBS);
        let filter = if active_only {
            " AND status IN ('queued','running','retrying')"
        } else {
            ""
        };
        let mut statement = connection.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM memory_jobs WHERE project_id=?1 AND kind IN ({kinds})\
             {filter} ORDER BY created_at DESC LIMIT ?2",
            kinds = known_kinds()
        ))?;
        let rows = statement
            .query_map(params![project_id, capped as i64], row_to_job)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Paths already queued for impact analysis in this Project, so an enqueuer can union a new
    /// burst into the pending job instead of discarding what was already waiting.
    pub fn pending_impact_paths(
        &self,
        project_id: &str,
        dedup_key: &str,
    ) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let payload: Option<String> = connection
            .query_row(
                "SELECT payload FROM memory_jobs \
                 WHERE project_id=?1 AND dedup_key=?2 AND status IN ('queued','retrying') LIMIT 1",
                params![project_id, dedup_key],
                |row| row.get(0),
            )
            .optional()?;
        let Some(payload) = payload else {
            return Ok(Vec::new());
        };
        Ok(serde_json::from_str::<AnalyzeImpactPayload>(&payload)
            .map(|parsed| parsed.paths)
            .unwrap_or_default())
    }
}

/// Drop terminal rows past the retention window. Runs on write rather than on a timer so the
/// table is bounded without a second background thread whose only job is deletion.
fn prune(connection: &rusqlite::Connection) -> AppResult<()> {
    let cutoff = (Utc::now() - chrono::Duration::days(RETAIN_TERMINAL_DAYS)).to_rfc3339();
    connection.execute(
        "DELETE FROM memory_jobs WHERE status IN ('complete','failed','cancelled') \
         AND finished_at IS NOT NULL AND finished_at < ?1",
        params![cutoff],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Project;

    fn project_row(name: &str) -> Project {
        let now = Utc::now().to_rfc3339();
        Project {
            id: Uuid::new_v4().to_string(),
            name: name.to_owned(),
            root_path: format!("/tmp/{name}"),
            canonical_root_path: format!("/tmp/{name}"),
            git_branch: None,
            detected_framework: None,
            package_manager: None,
            major_languages: Vec::new(),
            is_git_repository: false,
            has_package_json: false,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        }
    }

    fn database() -> (DatabaseService, String) {
        let database = DatabaseService::in_memory().unwrap();
        let project = project_row("fixture");
        database.upsert_project(&project).unwrap();
        let id = project.id.clone();
        (database, id)
    }

    fn payload(paths: &[&str]) -> String {
        serde_json::to_string(&AnalyzeImpactPayload {
            paths: paths.iter().map(|path| path.to_string()).collect(),
            changes: Vec::new(),
            trigger: "file change".into(),
        })
        .unwrap()
    }

    fn enqueue(
        database: &DatabaseService,
        project: &str,
        paths: &[&str],
        key: Option<&str>,
    ) -> String {
        database
            .enqueue_knowledge_job(
                project,
                KnowledgeJobKind::AnalyzeImpact,
                &payload(paths),
                key,
            )
            .unwrap()
    }

    #[test]
    fn enqueue_then_claim_moves_the_job_to_running() {
        let (database, project) = database();
        let id = enqueue(&database, &project, &["src/a.rs"], Some("analyze_impact"));
        let claimed = database.claim_knowledge_job().unwrap().unwrap();
        assert_eq!(claimed.id, id);
        assert_eq!(claimed.status, KnowledgeJobStatus::Running);
        assert_eq!(claimed.attempts, 1);
        // A claimed job is no longer claimable, which is what stops two workers running it twice.
        assert!(database.claim_knowledge_job().unwrap().is_none());
    }

    #[test]
    fn a_second_enqueue_coalesces_into_the_pending_job() {
        let (database, project) = database();
        let first = enqueue(&database, &project, &["src/a.rs"], Some("analyze_impact"));
        let second = enqueue(
            &database,
            &project,
            &["src/a.rs", "src/b.rs"],
            Some("analyze_impact"),
        );
        assert_eq!(first, second, "a burst of saves must not queue two jobs");
        assert_eq!(
            database
                .list_knowledge_jobs(&project, false, None)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            database
                .pending_impact_paths(&project, "analyze_impact")
                .unwrap(),
            vec!["src/a.rs".to_owned(), "src/b.rs".to_owned()]
        );
    }

    #[test]
    fn a_claimed_job_no_longer_blocks_a_new_one_with_the_same_key() {
        let (database, project) = database();
        enqueue(&database, &project, &["src/a.rs"], Some("analyze_impact"));
        let running = database.claim_knowledge_job().unwrap().unwrap();
        // A change arriving while analysis is in flight must queue its own job rather than mutate
        // the payload of work that is already executing.
        let queued = enqueue(&database, &project, &["src/b.rs"], Some("analyze_impact"));
        assert_ne!(running.id, queued);
        assert_eq!(
            database
                .pending_impact_paths(&project, "analyze_impact")
                .unwrap(),
            vec!["src/b.rs".to_owned()]
        );
    }

    #[test]
    fn failure_retries_until_attempts_are_exhausted() {
        let (database, project) = database();
        enqueue(&database, &project, &["src/a.rs"], None);
        for attempt in 1..=3 {
            let job = database
                .claim_knowledge_job()
                .unwrap()
                .expect("a retrying job stays claimable");
            assert_eq!(job.attempts, attempt);
            let status = database
                .fail_knowledge_job(&job.id, "disk unavailable")
                .unwrap();
            let expected = if attempt < 3 {
                KnowledgeJobStatus::Retrying
            } else {
                KnowledgeJobStatus::Failed
            };
            assert_eq!(status, expected);
        }
        assert!(
            database.claim_knowledge_job().unwrap().is_none(),
            "an exhausted job must stop spinning"
        );
        let jobs = database.list_knowledge_jobs(&project, false, None).unwrap();
        assert_eq!(jobs[0].status, KnowledgeJobStatus::Failed);
        assert_eq!(jobs[0].error.as_deref(), Some("disk unavailable"));
    }

    #[test]
    fn completion_records_the_result_and_clears_the_error() {
        let (database, project) = database();
        enqueue(&database, &project, &["src/a.rs"], None);
        let job = database.claim_knowledge_job().unwrap().unwrap();
        database.fail_knowledge_job(&job.id, "transient").unwrap();
        let retried = database.claim_knowledge_job().unwrap().unwrap();
        database
            .complete_knowledge_job(&retried.id, "{\"markedStale\":[\"m1\"]}")
            .unwrap();
        let jobs = database.list_knowledge_jobs(&project, false, None).unwrap();
        assert_eq!(jobs[0].status, KnowledgeJobStatus::Complete);
        assert_eq!(
            jobs[0].result.as_deref(),
            Some("{\"markedStale\":[\"m1\"]}")
        );
        assert!(
            jobs[0].error.is_none(),
            "a retry that succeeded is not still a failure"
        );
    }

    #[test]
    fn cancel_applies_to_pending_work_only() {
        let (database, project) = database();
        let pending = enqueue(&database, &project, &["src/a.rs"], None);
        assert!(database.cancel_knowledge_job(&project, &pending).unwrap());
        assert!(database
            .list_knowledge_jobs(&project, true, None)
            .unwrap()
            .is_empty());

        enqueue(&database, &project, &["src/b.rs"], None);
        let running = database.claim_knowledge_job().unwrap().unwrap();
        assert!(
            !database
                .cancel_knowledge_job(&project, &running.id)
                .unwrap(),
            "the queue cannot interrupt a handler that is mid-write"
        );
    }

    #[test]
    fn jobs_are_project_scoped() {
        let (database, project) = database();
        let other = project_row("other");
        database.upsert_project(&other).unwrap();
        let id = enqueue(&database, &project, &["src/a.rs"], None);

        assert!(database
            .list_knowledge_jobs(&other.id, false, None)
            .unwrap()
            .is_empty());
        assert!(
            !database.cancel_knowledge_job(&other.id, &id).unwrap(),
            "another Project must not be able to cancel this Project's knowledge work"
        );

        // Two Projects each keep their own pending job despite sharing a dedup key: the coalescing
        // index is scoped, so one busy Project cannot swallow another's analysis.
        enqueue(&database, &other.id, &["src/z.rs"], Some("analyze_impact"));
        enqueue(&database, &project, &["src/y.rs"], Some("analyze_impact"));
        assert_eq!(
            database
                .pending_impact_paths(&project, "analyze_impact")
                .unwrap(),
            vec!["src/y.rs".to_owned()]
        );
        assert_eq!(
            database
                .pending_impact_paths(&other.id, "analyze_impact")
                .unwrap(),
            vec!["src/z.rs".to_owned()]
        );
    }

    #[test]
    fn a_job_kind_this_build_cannot_run_is_left_alone() {
        let (database, project) = database();
        {
            let connection = database.connection.lock();
            connection
                .execute(
                    "INSERT INTO memory_jobs(id,project_id,kind,status,payload,created_at) \
                     VALUES('future','__p__','generate_embedding','queued','{}','2026-01-01')"
                        .replace("__p__", &project)
                        .as_str(),
                    [],
                )
                .unwrap();
        }
        assert!(
            database.claim_knowledge_job().unwrap().is_none(),
            "a downgrade must not claim and fail work it has no handler for"
        );
        assert!(
            database
                .list_knowledge_jobs(&project, false, None)
                .unwrap()
                .is_empty(),
            "and must not surface it as a job this build owns"
        );
    }
}
