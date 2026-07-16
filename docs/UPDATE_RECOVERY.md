# PARALITH update and recovery runbook

## Lifecycle

PARALITH persists every update transition outside SQLite under the edition-specific `update-data` directory: check, download, signature verification, restart request, installer start, first launch, migration, health check, and healthy startup confirmation. Installation success alone is never treated as update success.

Before the legacy-ID migration, every database migration, and every update installation, PARALITH creates an SQLite online snapshot and captures settings/configuration, Missions, Memory, Workspace and project-session state, window placement, logs, updater state, and durable WebView local state. Backups live under `%LOCALAPPDATA%\Corelith Technologies\PARALITH\Backups\<edition>`, outside the installation and source repository. The manifest records reason, app/schema versions, UTC time, SQLite integrity and foreign-key results, file sizes, and SHA-256 hashes. WAL/SHM files are retained as forensic state when SQLite keeps them after a full checkpoint. Recovery uses the consistent snapshot.

If migration or health confirmation fails, or three first launches remain unconfirmed, PARALITH opens Safe Recovery instead of restarting repeatedly. Recovery shows the failing app/schema, updater diagnostics, the validated backup, and the previous installer URL. Restoring a backup is explicit; PARALITH never automatically downgrades a migrated database.

## Reproducible A to B validation

Use disposable Windows VMs or office test machines, never the only copy of production data.

1. Install Stable A and confirm Diagnostics reports Stable, version A, schema, and expected installer type.
2. Open real external Projects. Create Workspace, Mission, Memory, settings, terminal-session metadata, and detached window placements.
3. Record database row counts and Project directory checksums. Close active terminals before the update test.
4. Publish Stable B from a protected tag to a test HTTPS endpoint with a limited rollout.
5. Check, review notes, download, and confirm the bundled public key verifies the artifact.
6. Install and restart. Confirm a pre-migration backup manifest exists when B changes schema.
7. Wait for healthy startup confirmation. Compare all row counts, settings, placements, and Project checksums; Diagnostics must report B.
8. Repeat independently with Preview A/B. Confirm Stable data timestamps and checksums do not change.
9. Replace the test manifest signature with a different signature. Download must fail and `signatureVerified` must remain false.
10. In a disposable build, inject a failing migration/startup. Confirm the lifecycle enters Safe Recovery and does not loop.
11. Validate backup restoration only when appropriate, and confirm the failed database copy remains available.
12. Test MSI and NSIS installs/uninstalls for each edition and launch both simultaneously. A second Stable launch must focus Stable; it must not focus or close Preview.

The automated suite covers identity/channel isolation, version consistency, manifest compatibility and rollout rejection, signature-failure state, lifecycle transitions, backup/checksum creation and restoration, supported migration upgrades, post-update confirmation rules, repeated-start recovery, changelog loading, diagnostics redaction, external Project preservation, and existing single-instance/window behavior. Installer UI, actual process replacement, and office endpoint reachability remain manual release-candidate gates.
