# PARALITH Stable Windows releases

PARALITH has one customer release channel: **Stable**. The private source repository validates and
builds the tagged source; the public artifact-only repository
[`dasindusithmira2025-ops/paralith-updates`](https://github.com/dasindusithmira2025-ops/paralith-updates)
holds immutable signed installers and the manifest installed applications poll:

`https://raw.githubusercontent.com/dasindusithmira2025-ops/paralith-updates/main/channels/stable/latest.json`

Installed applications use anonymous HTTPS and never receive a GitHub credential. Preview and
automatic push-to-main release workflows are intentionally absent. Merging a feature does not ship
it to users; only a confirmed `Release Stable` run can activate the Stable manifest.

## Release guarantees

`.github/workflows/release-stable.yml` is the complete Stable delivery pipeline. One run:

1. requires an existing `stable-vX.Y.Z` tag and the explicit **RELEASE TO ALL STABLE USERS** choice;
2. checks out that tag and proves its commit is on `origin/main`;
3. provisions a clean GitHub-hosted Windows runner with lockfile-keyed dependency caches;
4. verifies the signing key, update endpoint, publisher, and public artifact repository;
5. checks canonical version/changelog/schema metadata and runs the full frontend and Rust gate;
6. builds one signed Stable MSI, one per-user NSIS installer, and both updater signatures;
7. validates the artifact set, hashes, tag, commit, channel, and a fixed `rolloutPercent: 100`;
8. archives the evidence and creates or verifies the private source release;
9. publishes immutable assets before atomically activating `channels/stable/latest.json`;
10. publishes the optional mirror after the canonical origin and verifies the public checksums,
    canonical manifest, installed-app endpoint, signed artifact reachability, and full rollout.

All Stable runs share one non-cancelling concurrency group. A second version waits instead of
interrupting publication in flight. Publication fails closed: the previous Stable manifest remains
active until the new signed payloads are anonymously reachable.

## What “all users” means

The Stable manifest is always published with `rolloutPercent: 100`; staged Stable rollouts are not
supported by this workflow. Every compatible Stable installation is therefore eligible for the same
release. The application checks after a healthy startup and every 45 minutes by default, then offers
the signed update through the Safe Update Gate.

This is intentionally not a forced process termination. A user who is offline, has disabled
automatic checks, or has active work protected by the restart gate receives the update on a later
check or after choosing a safe restart. The workflow makes the release available to the entire
eligible cohort; it cannot truthfully prove that every device is online and has installed it.

## GitHub environment

Create a `stable-release` environment and configure required reviewers. Disable administrator bypass
where repository policy permits it. Restrict deployment branches/tags to the intended release policy.
The workflow is manual-only, but the environment remains the final approval and secret boundary.

Required environment configuration:

| Name | Kind | Purpose |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | secret | Password-protected Tauri updater private key contents. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | Private-key password; empty only when the offline key intentionally has none. |
| `PARALITH_STABLE_UPDATE_ENDPOINT` | variable | Exact Stable `latest.json` URL derived by `update-distribution.mjs`. |
| `PARALITH_UPDATE_PUBLISH_PROVIDER` | variable | Must be `github-artifacts`. |
| `PARALITH_UPDATES_REPOSITORY` | variable | `dasindusithmira2025-ops/paralith-updates`. |
| `PARALITH_UPDATES_DEPLOY_KEY` | secret | Preferred: write-enabled deploy key scoped only to the artifact repository. |
| `PARALITH_UPDATES_TOKEN` | secret | Fine-grained Contents/Releases write fallback when no deploy key is configured. |
| `PARALITH_WINDOWS_SIGN_COMMAND` | secret | Optional Tauri `signCommand` for company Authenticode signing. |
| `PARALITH_PREVIOUS_INSTALLER_URL` | variable | Recovery URL for the preceding Stable installer. |

The updater key is mandatory. Authenticode is a separate trust system: do not describe an installer
as Windows code-signed unless the configured signing command ran and the resulting signature was
verified.

Generate and store the updater key on a protected offline administrator machine:

```powershell
npm run tauri signer generate -- -w D:\OfflineBackup\paralith-stable-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo OWNER/PRIVATE_REPOSITORY --env stable-release < D:\OfflineBackup\paralith-stable-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo OWNER/PRIVATE_REPOSITORY --env stable-release
```

Commit only `release/updater.stable.pubkey`. Never commit the private key, password, deployment key,
token, or signing command.

Optional mirror variables and secrets are documented in [UPDATE_DISTRIBUTION.md](UPDATE_DISTRIBUTION.md).

## Publishing Stable

1. Update `release/version.json` to a strictly newer `X.Y.Z`.
2. Add `release/changelog/X.Y.Z.json` with `channel: "stable"` and run `npm run release:sync`.
3. Land the release commit on `main` through the normal pull-request and validation path.
4. Create `stable-vX.Y.Z` at that merged commit and push the tag. Pushing the tag alone publishes
   nothing.
5. Run **Actions → Release Stable → Run workflow** from `main`. Enter the tag and select
   **RELEASE TO ALL STABLE USERS**.
6. Approve the `stable-release` deployment when its reviewer gate opens.
7. Do not report success until the workflow verifies the public release checksums and live manifest.

CLI dispatch is equivalent:

```powershell
gh workflow run "Release Stable" `
  --repo dasindusithmira2025-ops/forgemind `
  --ref main `
  -f tag=stable-vX.Y.Z `
  -f confirm_all_users="RELEASE TO ALL STABLE USERS"
```

## Version ownership and local checks

`release/version.json` is canonical. `npm run release:sync` updates `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and
`release/generated/current-release.json`. `npm run release:check` fails on drift.

An unsigned local Stable bundle can be built for non-production testing:

```powershell
$env:PARALITH_EDITION='stable'
$env:PARALITH_RELEASE_CHANNEL='stable'
$env:PARALITH_UPDATE_ENDPOINT='https://updates.invalid/paralith/stable/latest.json'
$config = node scripts/release/render-tauri-config.mjs stable local | Select-Object -Last 1
npm run tauri -- build --bundles msi,nsis --config $config
```

Release mode refuses placeholder keys, non-HTTPS endpoints, metadata drift, wrong tags, non-main
commits, incomplete signed artifacts, non-100% Stable rollout, checksum mismatches, or failed live
verification.

## Bootstrap and rollback

An installation that predates updater support cannot update itself. Install the first updater-enabled
Stable NSIS package once; later Stable releases arrive through the application updater.

Do not overwrite `latest.json` by hand to roll back. Tauri rejects same-or-lower versions by default,
and users may already have downloaded the new installer. Stop new publication, preserve the failed
artifacts and logs, fix forward with a higher reviewed version, and use the recovery installer only
for an explicitly diagnosed device. Database backup, post-update health, and restore behavior are in
[UPDATE_RECOVERY.md](UPDATE_RECOVERY.md).

## Emergency procedures

### A release failed before publication

Nothing reached users: the workflow activates `channels/stable/latest.json` last, so a failure in
validation, build, signing, asset upload, or pre-activation verification leaves the previous Stable
manifest serving. Do not re-run the workflow against a mutated tag. Read the failed step, land the
fix on `main` through the normal path, cut a new `stable-vX.Y.Z`, and dispatch again. The workflow
reuses an existing private source release only when its checksums match the rebuilt artifacts
exactly, so a partially completed run cannot silently blend into the next one.

### A bad release is already published

Fix forward. Publish a strictly higher version through the ordinary path.

Never re-upload different bytes under an already-published version. Installed clients cache the
manifest version they last saw and Tauri refuses same-or-lower versions, so a silent asset swap does
not reach the users who already updated, does not reach users who already downloaded the installer,
and permanently destroys the guarantee that a version string identifies one exact signed payload.
Checksums recorded in workflow evidence would no longer match the published assets, making later
incident analysis unreliable. If the release is actively harmful, stop further publication, keep the
artifacts and logs for analysis, and direct explicitly diagnosed devices to
`PARALITH_PREVIOUS_INSTALLER_URL` while the forward fix is prepared.

### The updater signing key is compromised or lost

Both cases are severe and neither is recoverable from inside the application.

*Compromised* — an attacker holding the private key can sign a payload that every installed client
accepts. Immediately revoke the `stable-release` environment secrets, disable the release workflow,
and audit the public artifact repository for assets or manifest revisions the team did not publish.
Recovery requires generating a new key pair, committing the new `release/updater.stable.pubkey`, and
shipping a rebuilt installer through a **manually distributed** package: clients trust the key
compiled into them, so the replacement key cannot be delivered by the updater it is replacing.

*Lost* — installed clients keep trusting the old public key and will reject everything signed with
any new key. There is no in-application remedy; every existing installation must be reinstalled
manually from a new signed package. This is why the private key and its password belong on protected
offline storage with an independent backup, and why the backup is verified before it is needed.

Rotating the key is a full reinstall event for the entire Stable cohort. Treat key custody as the
highest-severity operational risk in this pipeline.
