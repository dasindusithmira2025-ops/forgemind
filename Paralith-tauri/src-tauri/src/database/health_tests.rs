use super::*;
use std::sync::{mpsc, Arc};
use std::time::Duration;

#[test]
fn disk_health_scan_does_not_wait_for_the_project_connection() {
    let root = std::env::temp_dir().join(format!("paralith-health-{}", Uuid::new_v4()));
    let database =
        Arc::new(DatabaseService::open_with_backup(&root.join("test.sqlite3"), None).unwrap());
    let held = database.connection.lock();
    let (send, receive) = mpsc::channel();
    let reader = database.clone();
    let worker = std::thread::spawn(move || send.send(reader.health_report()).unwrap());
    let result = receive.recv_timeout(Duration::from_secs(10));
    // Release even on regression so the worker can exit rather than hanging the test process.
    drop(held);
    worker.join().unwrap();
    let health = result
        .expect("health scan waited for the shared database connection")
        .unwrap();
    assert!(health.healthy, "{:?}", health.messages);
    assert_eq!(
        database.schema_version().unwrap(),
        migrations::CURRENT_SCHEMA_VERSION
    );
    drop(database);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn disk_health_scan_reads_committed_wal_and_preserves_integrity_failures() {
    let root = std::env::temp_dir().join(format!("paralith-health-{}", Uuid::new_v4()));
    let database = DatabaseService::open_with_backup(&root.join("test.sqlite3"), None).unwrap();
    database
        .connection
        .lock()
        .execute_batch(
            "PRAGMA foreign_keys=OFF;
         CREATE TABLE health_parent(id INTEGER PRIMARY KEY);
         CREATE TABLE health_child(parent_id INTEGER REFERENCES health_parent(id));
         INSERT INTO health_child VALUES(42);
         PRAGMA foreign_keys=ON;",
        )
        .unwrap();
    let health = database.health_report().unwrap();
    assert!(!health.healthy);
    assert_eq!(health.foreign_key_violations, 1);
    assert_eq!(health.integrity_check, "ok");
    drop(database);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn in_memory_health_scan_remains_supported() {
    let database = DatabaseService::in_memory().unwrap();
    assert!(database.health_report().unwrap().healthy);
    assert_eq!(
        database.schema_version().unwrap(),
        migrations::CURRENT_SCHEMA_VERSION
    );
}
