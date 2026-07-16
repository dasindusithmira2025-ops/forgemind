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

## Practical branch and release policy

1. Work on a short feature or fix branch.
2. Open a pull request into `integration`; all validation gates must pass.
3. Set `release/version.json` and create its single changelog entry under `release/changelog/`.
4. Publish `preview-vX.Y.Z-preview.N` for office migration/feature testing.
5. After Preview validation, promote the reviewed commit/version to `main` and create `stable-vX.Y.Z`.
6. Stable tags must point to a committed, clean tree. Normal commits never publish an update.

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
