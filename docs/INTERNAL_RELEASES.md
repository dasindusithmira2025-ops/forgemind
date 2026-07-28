# PARALITH internal Windows releases

PARALITH source remains private in `dasindusithmira2025-ops/forgemind`. Signed installers, updater signatures, checksums, release notes, and channel manifests are distributed from the public artifact-only repository [`dasindusithmira2025-ops/paralith-updates`](https://github.com/dasindusithmira2025-ops/paralith-updates). Installed applications use anonymous HTTPS and never receive a GitHub credential.

Versioned binaries are immutable GitHub Release assets. The discoverable manifests are:

- Preview: `https://raw.githubusercontent.com/dasindusithmira2025-ops/paralith-updates/main/channels/preview/latest.json`
- Stable: `https://raw.githubusercontent.com/dasindusithmira2025-ops/paralith-updates/main/channels/stable/latest.json`

The private workflow validates each signed payload and pushes a publication batch with a repository-scoped deploy key. The public repository's own workflow creates the GitHub Release, proves anonymous reachability, then updates only the selected channel manifest after comparing the current blob SHA. A stale or concurrent activation fails instead of overwriting a newer manifest. The private source-repository release remains the authenticated engineering archive.

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
- Variable `PARALITH_UPDATES_REPOSITORY`: `dasindusithmira2025-ops/paralith-updates`.
- Variable `PARALITH_UPDATE_PUBLISH_PROVIDER`: `github-artifacts`.
- Secret `PARALITH_UPDATES_DEPLOY_KEY`: private half of a write-enabled deploy key attached only to `paralith-updates`. The source workflow can stage publication batches but cannot use it to read the private source repository or access any other repository. A fine-grained `PARALITH_UPDATES_TOKEN` with Contents and Releases write access remains supported as a fallback.
- Variable `PARALITH_PREVIEW_BRIDGE_ENDPOINT`: `https://corelith-paralith-updates.web.app/preview/latest.json`, retained only for the installed `0.4.1-1023` migration bridge.
- Variable `PARALITH_UPDATE_ARTIFACT_BASE_URL`: legacy static-host provider input. GitHub publication derives the versioned Release URL inside the workflow.
- Secret `PARALITH_UPDATE_PUBLISH_TARGET`: provider destination. It may contain private infrastructure routing but must not be bundled.
- Secret `PARALITH_UPDATE_PUBLISH_TOKEN`: required only by the HTTP PUT adapter.
- Variable `PARALITH_ROLLOUT_PERCENT`: integer 0-100; start Preview at 100 and Stable with the approved office cohort.
- Variable `PARALITH_PREVIOUS_INSTALLER_URL`: internal URL for the previous Stable installer retained for recovery.
- Optional secret `PARALITH_WINDOWS_SIGN_COMMAND`: Tauri `signCommand` for the company's Authenticode service. The updater signature is mandatory even when Authenticode is not configured.

GitHub's generated `GITHUB_TOKEN` is used only by Actions to create the private repository release. It is never compiled into PARALITH.

### Firebase Preview compatibility bridge

Installed Preview `0.4.1-1023` polls `https://corelith-paralith-updates.web.app/preview/latest.json`. The first migrated release therefore deploys the same signed manifest to that URL after the public GitHub assets and canonical public Preview manifest are live. Firebase receives JSON only; `.exe`, `.msi`, and signature payloads never enter Firebase Hosting.

Set these **preview-release environment variables**:

- `PARALITH_UPDATE_PUBLISH_PROVIDER=github-artifacts`
- `PARALITH_PREVIEW_BRIDGE_ENDPOINT=https://corelith-paralith-updates.web.app/preview/latest.json`
- `FIREBASE_PROJECT_ID`: Firebase project ID supplied by the Firebase administrator.
- `FIREBASE_HOSTING_SITE`: Firebase Hosting site ID supplied by the Firebase administrator.
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: full Workload Identity Provider resource name.
- `GCP_SERVICE_ACCOUNT`: deployer service-account email.

The preferred authentication method is Workload Identity Federation. The workflow requests `id-token: write` and uses `google-github-actions/auth@v3` immediately before deployment. Restrict the provider to `dasindusithmira2025-ops/forgemind` and the `preview-release` environment. Grant the deployer service account exactly `roles/firebasehosting.admin` and `roles/serviceusage.apiKeysViewer` (the latter is required by Firebase CLI deployment); grant the GitHub Workload Identity principal only `roles/iam.workloadIdentityUser` on that service account. If WIF cannot be provisioned, leave both WIF variables unset and set only the `FIREBASE_SERVICE_ACCOUNT_JSON` secret with credentials for that same least-privilege deployer service account.

No updater executable is staged in the Firebase public directory. Credential files emitted by Google authentication and generated Firebase deployment configuration are ignored and never packaged.

The bridge reads `/stable/latest.json` before deployment: HTTP 200 is preserved byte-for-byte and checked by SHA-256 afterward; HTTP 404 remains absent; any other response fails closed. The staged tree is rejected if it contains anything except channel `latest.json` files. There is no SPA rewrite.

Protect the `stable-release` and `preview-release` environments with required reviewers. Protect `stable-v*` and `preview-v*` tags. Require the `Validate` workflow on `integration` and `main`.

## Release channels

| Channel | Edition | Trigger | Version shape | Workflow |
|---|---|---|---|---|
| internal | `preview` | automatic on push/merge to `main` | `X.Y.Z-<1001 + runNumber>` | `release-internal.yml` |
| stable | `stable` | protected tag `stable-vX.Y.Z` | `X.Y.Z` | `release-stable.yml` |

The **internal channel is delivered on the `preview` edition** (separate identifier, data, updater state, and update endpoint from stable). A `beta` channel can be added later by introducing a third edition config plus a `ProductEdition` variant without changing the updater flow. Internal installs only ever query `PARALITH_PREVIEW_UPDATE_ENDPOINT`; stable installs only ever query `PARALITH_STABLE_UPDATE_ENDPOINT`. Internal releases publish only the preview manifest and never touch the stable manifest; stable releases use clean `X.Y.Z` versions. Within a channel the Tauri updater rejects same-or-lower versions, so an accidental downgrade is refused.

## Automatic internal releases (push to `main`)

Every merge or push to `main` runs `release-internal.yml`: validation gates a unique internal version and signed Preview bundles; the private repository receives the engineering archive; the public artifact repository receives the immutable assets; anonymous verification passes; the public Preview manifest activates with optimistic SHA protection; and the JSON-only Firebase bridge is refreshed for the migration cohort. No manual tagging or version editing is required.

- **Versioning.** `scripts/release/internal-version.mjs` derives `X.Y.(Z+1)-<1001 + github.run_number>` from the shipped stable base in `release/version.json`. The `1001` floor keeps every automatic build strictly above the updater bootstrap version while the numeric prerelease remains MSI-compatible. Each build is therefore a valid upgrade over the previous one, sorts above the current stable, and sorts below the eventual stable release of that patch (`0.4.1-1002 < 0.4.1-1003 < 0.4.1`).
- **Ephemeral, never committed.** The version bump and its generated changelog are written only inside the runner and are never committed back to `main`, so `main` stays on its canonical stable version.
- **Fail-closed and de-duplicated.** The job aborts if `TAURI_SIGNING_PRIVATE_KEY` or `PARALITH_PREVIEW_UPDATE_ENDPOINT` is missing, so a build never ships unsigned or unpublishable. A `concurrency` group keyed to the commit SHA prevents two runs from publishing the same commit; the unique per-run version prevents accumulating conflicting drafts.
- **Emergency disablement.** Disable `Release Internal` under the repository Actions tab (or remove the `preview-release` environment's signing secret) to immediately stop internal publication without affecting stable.

## Practical branch and release policy

1. Work on a short feature or fix branch.
2. Open a pull request; CI validation (`ci.yml`) runs on the PR and must pass. No release is produced from a PR.
3. Merge to `main`. This automatically produces and publishes a signed **Preview** build — no tag needed.
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

1. Configure the `preview-release` environment with the signing key, public manifest endpoint, `PARALITH_UPDATES_REPOSITORY`, repository-scoped `PARALITH_UPDATES_DEPLOY_KEY`, `PARALITH_UPDATE_PUBLISH_PROVIDER=github-artifacts`, bridge endpoint, and Firebase WIF variables (or the service-account fallback) listed above.
2. Push a trivial change to `main`.
3. Watch **Actions → Release Internal**: validation runs before the signed build, public payload verification, optimistic manifest activation, and Firebase JSON bridge.
4. On installed Preview `0.4.1-1023`, confirm the bridge discovers the release, **Update now** shows real progress, signature verification succeeds, the safe-restart gate is respected, and the restarted application confirms a healthy database and workspace state.

## Publishing a stable release

1. Land the release commit on `main` with `release/version.json` at the target `X.Y.Z` and a matching `stable` changelog entry (CI's `release:check` enforces consistency).
2. Create and push the protected tag: `git tag stable-vX.Y.Z && git push origin stable-vX.Y.Z`.
3. `release-stable.yml` runs full validation, verifies the tag matches the version on a clean tree, builds signed artifacts, publishes both the private archive and public immutable assets, anonymously verifies them, then activates only the Stable manifest after the `stable-release` environment approval gate.

Ordinary pushes and Preview releases never update `channels/stable/latest.json`. This feature does not create a Stable tag or customer release.
