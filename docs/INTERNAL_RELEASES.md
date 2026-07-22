# PARALITH internal Windows releases

PARALITH is distributed only inside the company. The private GitHub repository archives source and release artifacts; installed applications never authenticate to GitHub. Signed updater files are copied by CI to a company-controlled HTTPS static endpoint.

## Editions and data isolation

| Property | Stable | Preview |
|---|---|---|
| Product | PARALITH | PARALITH Preview |
| Identifier | `com.corelith.paralith` | `com.corelith.paralith.preview` |
| Channel | `stable` | `preview` |
| Update manifest | `PARALITH_STABLE_UPDATE_ENDPOINT` | `PARALITH_PREVIEW_UPDATE_ENDPOINT` |

Stable performs a one-time, validated migration from the legacy `com.forgemind.workspace` profile into `com.corelith.paralith`; the original profile and its external recovery backup remain intact. Preview never reads Stable or legacy Stable data. Its different identifier gives it an independent installation, WebView storage, database, settings, logs, recovery backups, updater state, and single-instance lock. Projects are external folders and are never copied, deleted, or uninstalled by PARALITH.

## Administrator setup

Generate the production updater key once on a protected offline administrator machine:

```powershell
npm run tauri signer generate -- -w D:\OfflineBackup\paralith-updater.key
```

Keep the password-protected private key and its password in the protected offline backup. Commit only the generated public key content to `release/updater.pubkey`. Set the private key in GitHub without printing it:

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo OWNER/PRIVATE_REPOSITORY < D:\OfflineBackup\paralith-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo OWNER/PRIVATE_REPOSITORY
```

Required GitHub Actions configuration:

- Secret `TAURI_SIGNING_PRIVATE_KEY`: complete Tauri updater private key or protected runner path.
- Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: updater key password; configure an empty value only if the offline key intentionally has no password.
- Variable `PARALITH_STABLE_UPDATE_ENDPOINT`: Stable HTTPS `latest.json` URL.
- Variable `PARALITH_PREVIEW_UPDATE_ENDPOINT`: Preview HTTPS `latest.json` URL.
- Variable `PARALITH_UPDATE_ARTIFACT_BASE_URL`: public-to-office-clients HTTPS base used inside manifests.
- Variable `PARALITH_UPDATE_PUBLISH_PROVIDER`: `filesystem`, `s3`, `ssh`, or `http`.
- Secret `PARALITH_UPDATE_PUBLISH_TARGET`: provider destination. It may contain private infrastructure routing but must not be bundled.
- Secret `PARALITH_UPDATE_PUBLISH_TOKEN`: required only by the HTTP PUT adapter.
- Variable `PARALITH_ROLLOUT_PERCENT`: integer 0-100; start Preview at 100 and Stable with the approved office cohort.
- Variable `PARALITH_PREVIOUS_INSTALLER_URL`: internal URL for the previous Stable installer retained for recovery.
- Optional secret `PARALITH_WINDOWS_SIGN_COMMAND`: Tauri `signCommand` for the company's Authenticode service. The updater signature is mandatory even when Authenticode is not configured.

GitHub's generated `GITHUB_TOKEN` is used only by Actions to create the private repository release. It is never compiled into PARALITH.

Protect the `stable-release` and `preview-release` environments with required reviewers. Protect `stable-v*` and `preview-v*` tags. Require the `Validate` workflow on `integration` and `main`.

## Release channels

| Channel | Edition | Trigger | Version shape | Workflow |
|---|---|---|---|---|
| internal | `preview` | automatic on push/merge to `main` | `X.Y.Z-internal.<runNumber>` | `release-internal.yml` |
| stable | `stable` | protected tag `stable-vX.Y.Z` | `X.Y.Z` | `release-stable.yml` |

The **internal channel is delivered on the `preview` edition** (separate identifier, data, updater state, and update endpoint from stable). A `beta` channel can be added later by introducing a third edition config plus a `ProductEdition` variant without changing the updater flow. Internal installs only ever query `PARALITH_PREVIEW_UPDATE_ENDPOINT`; stable installs only ever query `PARALITH_STABLE_UPDATE_ENDPOINT`. Internal releases publish only the preview manifest and never touch the stable manifest; stable releases never use an `-internal.*` prerelease version. Within a channel the Tauri updater rejects same-or-lower versions, so an accidental downgrade is refused.

## Automatic internal releases (push to `main`)

Every merge or push to `main` runs `release-internal.yml`: full CI validation (`ci.yml`) gates a build job that generates a unique internal version, builds the signed `preview` installer + updater artifacts, publishes a non-draft GitHub prerelease, and pushes the signed `latest.json` to the internal endpoint. Installed internal builds detect it on their next check and install on the next safe restart. No manual tagging or version editing is required.

- **Versioning.** `scripts/release/internal-version.mjs` derives `X.Y.(Z+1)-internal.<github.run_number>` from the shipped stable base in `release/version.json`. The run number is monotonic, so each internal build is a valid upgrade over the previous one, sorts above the current stable, and sorts below the eventual stable release of that patch (`0.4.1-internal.101 < 0.4.1-internal.102 < 0.4.1`).
- **Ephemeral, never committed.** The version bump and its generated changelog are written only inside the runner and are never committed back to `main`, so `main` stays on its canonical stable version.
- **Fail-closed and de-duplicated.** The job aborts if `TAURI_SIGNING_PRIVATE_KEY` or `PARALITH_PREVIEW_UPDATE_ENDPOINT` is missing, so a build never ships unsigned or unpublishable. A `concurrency` group keyed to the commit SHA prevents two runs from publishing the same commit; the unique per-run version prevents accumulating conflicting drafts.
- **Emergency disablement.** Disable `Release Internal` under the repository Actions tab (or remove the `preview-release` environment's signing secret) to immediately stop internal publication without affecting stable.

## Practical branch and release policy

1. Work on a short feature or fix branch.
2. Open a pull request; CI validation (`ci.yml`) runs on the PR and must pass. No release is produced from a PR.
3. Merge to `main`. This automatically produces and publishes a signed **internal** build — no tag needed.
4. To cut a **stable** release, set `release/version.json`, add its single `release/changelog/` entry, land it on `main`, then create the protected `stable-vX.Y.Z` tag. Stable tags must point to a committed, clean tree.

The release workflows build MSI, NSIS, updater signatures, checksums, `latest.json`, release manifest, release notes, build metadata, and schema metadata. They archive all files in the private GitHub release and then run the configured internal publication adapter.

## Version and changelog ownership

`release/version.json` is canonical. `npm run release:sync` updates the Tauri config, Cargo package, frontend package, and bundled release entry. `npm run release:check` fails CI on drift. The versioned changelog entry supplies GitHub notes, updater notes, What's New, diagnostics build metadata, and internal release documentation.

## Local packaging

Unsigned local installers can be produced without a private updater key:

```powershell
$env:PARALITH_EDITION='stable'
$env:PARALITH_RELEASE_CHANNEL='stable'
$env:PARALITH_UPDATE_ENDPOINT='https://updates.invalid/paralith/stable/latest.json'
$config = node scripts/release/render-tauri-config.mjs stable local | Select-Object -Last 1
npm run tauri -- build --bundles msi,nsis --config $config
```

Repeat with `preview`. Production `release` mode refuses placeholder public keys, non-HTTPS endpoints, missing signing secrets, dirty/tag-version mismatches, or failed validation.

## Bootstrap: the one required manual install

An existing installation that predates updater support cannot update itself — it has no updater public key, endpoint, or coordinator. Deliver the **first** updater-enabled internal build by hand once:

1. Merge the updater-enabled code to `main` (or run `npm run build:preview` locally with production signing configured) to produce a signed `preview` NSIS installer.
2. Install `PARALITH Preview_<version>_x64-setup.exe` on each office machine (per-user, `AppData\Local\PARALITH Preview`, no elevation).
3. From then on, every push to `main` is delivered automatically to that install through the internal channel — no further manual installs.

Stable follows the same one-time bootstrap using a `stable` build; after that, `stable-vX.Y.Z` tags update it automatically.

## Testing an internal update locally

`npm run update-server` serves a local `.artifacts/update-site` over HTTP for end-to-end verification without touching production infrastructure:

1. Build `v1`: bump `release/version.json`, `npm run build:preview`, install the resulting NSIS setup.
2. Build `v2` at a higher internal version and `npm run release:assemble` against the local server's base URL.
3. Point the install's endpoint at the local server, then use **Settings → About & Updates → Check for Updates → Update Now**.

## Testing the push-to-main automatic flow

1. Configure the `preview-release` environment secrets/variables listed above (`TAURI_SIGNING_PRIVATE_KEY`, `PARALITH_PREVIEW_UPDATE_ENDPOINT`, `PARALITH_UPDATE_ARTIFACT_BASE_URL`, and a publication adapter target).
2. Push a trivial change to `main`.
3. Watch **Actions → Release Internal**: `validate` runs full CI, then `release` builds `X.Y.(Z+1)-internal.<run>`, publishes the prerelease, and syncs `latest.json`.
4. On a bootstrapped internal install, confirm the new version is detected on the next check and installs on the next safe restart.

## Publishing a stable release

1. Land the release commit on `main` with `release/version.json` at the target `X.Y.Z` and a matching `stable` changelog entry (CI's `release:check` enforces consistency).
2. Create and push the protected tag: `git tag stable-vX.Y.Z && git push origin stable-vX.Y.Z`.
3. `release-stable.yml` runs full validation, verifies the tag matches the version on a clean tree, builds signed artifacts, and publishes a non-draft stable release plus the stable `latest.json` after the `stable-release` environment approval gate.
