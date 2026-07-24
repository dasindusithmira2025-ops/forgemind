import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Preview/internal release preflight. A preview release exists to be *discovered and installed* by
// already-installed internal builds, so a build that cannot publish its manifest is worthless. This
// runs BEFORE the expensive Windows build and signing so a misconfigured environment fails fast and
// loudly instead of silently producing a GitHub-only prerelease no installed app can ever see.
//
// It reports only the NAMES of missing configuration keys — never their values.

// Always required to build, sign, and publish a discoverable preview release.
const REQUIRED = [
  'TAURI_SIGNING_PRIVATE_KEY', // secret: updater signing key (mandatory; signatures are not optional)
  'PARALITH_PREVIEW_UPDATE_ENDPOINT', // variable: the manifest URL installed apps poll
  'PARALITH_UPDATE_ARTIFACT_BASE_URL', // variable: public HTTPS base embedded in updater artifact links
  'PARALITH_UPDATE_PUBLISH_PROVIDER', // variable: filesystem | s3 | ssh | http | firebase-hosting
]

/** Return the names of required keys that are absent/blank in `env`. */
export function missingPublishKeys(env) {
  const missing = REQUIRED.filter((key) => !env[key] || String(env[key]).trim() === '')
  const provider = String(env.PARALITH_UPDATE_PUBLISH_PROVIDER || '').trim()
  if (provider === 'firebase-hosting') {
    for (const key of ['FIREBASE_PROJECT_ID', 'FIREBASE_HOSTING_SITE', 'GITHUB_REPOSITORY', 'PARALITH_INTERNAL_BUILD_NUMBER']) {
      if (!env[key] || String(env[key]).trim() === '') missing.push(key)
    }
    const hasWif = Boolean(String(env.GCP_WORKLOAD_IDENTITY_PROVIDER || '').trim() && String(env.GCP_SERVICE_ACCOUNT || '').trim())
    const hasServiceAccount = Boolean(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim())
    if (!hasWif && !hasServiceAccount) {
      missing.push('GCP_WORKLOAD_IDENTITY_PROVIDER + GCP_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_JSON')
    }
  } else if (!env.PARALITH_UPDATE_PUBLISH_TARGET || !String(env.PARALITH_UPDATE_PUBLISH_TARGET).trim()) {
    missing.push('PARALITH_UPDATE_PUBLISH_TARGET')
  }
  // The HTTP publishing provider additionally needs a bearer token.
  if (
    provider === 'http' &&
    (!env.PARALITH_UPDATE_PUBLISH_TOKEN || !String(env.PARALITH_UPDATE_PUBLISH_TOKEN).trim())
  ) {
    missing.push('PARALITH_UPDATE_PUBLISH_TOKEN')
  }
  return missing
}

/** Format only configuration names. Values (including credentials) must never reach CI output. */
export function formatMissingPublishKeys(missing) {
  return missing.map((key) => `  - ${key}`).join('\n')
}

/** Validate non-secret release inputs that must be correct before an expensive signed build starts. */
export function invalidPublishConfiguration(env, metadata) {
  const invalid = []
  try {
    const endpoint = new URL(env.PARALITH_PREVIEW_UPDATE_ENDPOINT)
    if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/preview/latest.json') invalid.push('PARALITH_PREVIEW_UPDATE_ENDPOINT')
  } catch {
    invalid.push('PARALITH_PREVIEW_UPDATE_ENDPOINT')
  }
  try {
    if (new URL(env.PARALITH_UPDATE_ARTIFACT_BASE_URL).protocol !== 'https:') invalid.push('PARALITH_UPDATE_ARTIFACT_BASE_URL')
  } catch {
    invalid.push('PARALITH_UPDATE_ARTIFACT_BASE_URL')
  }
  if (!metadata || !String(metadata.version || '').trim()) invalid.push('release/version.json.version')
  if (!Number.isInteger(metadata?.schemaVersion) || metadata.schemaVersion < 1) invalid.push('release/version.json.schemaVersion')
  return invalid
}

async function main() {
  const missing = missingPublishKeys(process.env)
  if (missing.length > 0) {
    console.error('Preview release preflight FAILED — missing required publish configuration (values not shown):')
    console.error(formatMissingPublishKeys(missing))
    console.error('')
    console.error('Add these to the GitHub "preview-release" environment (Settings → Environments),')
    console.error('then re-run the release. The release will not build until publishing can succeed.')
    process.exit(1)
  }
  const metadata = JSON.parse(await readFile(new URL('../../release/version.json', import.meta.url), 'utf8'))
  const invalid = invalidPublishConfiguration(process.env, metadata)
  if (invalid.length > 0) {
    console.error('Preview release preflight FAILED — invalid required publication metadata (values not shown):')
    console.error(formatMissingPublishKeys(invalid))
    process.exit(1)
  }
  console.log('Preview publish preflight passed: all required publish configuration is present.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
