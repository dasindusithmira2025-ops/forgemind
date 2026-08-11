#[cfg(test)]
pub mod tests {
    use crate::database::migrations;
    use crate::services::database_studio::discovery::discover_repository;
    use rusqlite::Connection;
    use std::path::PathBuf;

    #[test]
    fn no_credential_value_is_persisted_in_database_studio_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        migrations::apply(&connection).unwrap();
        let secret = "postgres://user:super-secret-password@localhost/app";
        connection.execute("INSERT INTO database_sources(id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at) VALUES('src','repo','primary','Primary PostgreSQL','postgres',NULL,1,'t','t')", []).unwrap();
        connection.execute("INSERT INTO database_source_evidence(id,source_id,repository_id,project_id,adapter_id,evidence_kind,relative_path,symbol_or_key,safe_value_fingerprint,source_hint,owner_signal,consumer_signal,certainty,confidence,content_sha256,extractor_version,discovered_at) VALUES('ev','src','repo','project','prisma','environment_reference','.env.example','DATABASE_URL','sha256:redacted','DATABASE_URL',0.1,1,'exact',1,'hash','v1','t')", []).unwrap();
        let mut statement = connection.prepare("SELECT group_concat(row_text, '\n') FROM (SELECT id || repository_id || logical_key || display_name || engine || coalesce(owner_project_id,'') AS row_text FROM database_sources UNION ALL SELECT id || source_id || repository_id || coalesce(project_id,'') || adapter_id || evidence_kind || relative_path || coalesce(symbol_or_key,'') || coalesce(safe_value_fingerprint,'') || coalesce(source_hint,'') || certainty || content_sha256 || extractor_version AS row_text FROM database_source_evidence)").unwrap();
        let rows: String = statement
            .query_row([], |row| row.get::<_, Option<String>>(0))
            .unwrap()
            .unwrap_or_default();
        assert!(!rows.contains(secret));
        assert!(!rows.contains("super-secret-password"));
    }

    #[test]
    fn discovery_never_opens_connection_for_sqlite_or_network_sources() {
        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/database_studio/sqlite");
        let report = discover_repository(&fixture).unwrap();
        assert!(!report.opened_connection);
    }
}
