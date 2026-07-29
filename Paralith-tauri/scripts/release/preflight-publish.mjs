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
  'PARALITH_UPDATE_PUBLISH_PROVIDER', // variable: github-artifacts (preferred) or a legacy provider
]

/** Return the names of required keys that are absent/blank in `env`. */
export function missingPublishKeys(env) {
  const missing = REQUIRED.filter((key) => !env[key] || String(env[key]).trim() === '')
  const provider = String(env.PARALITH_UPDATE_PUBLISH_PROVIDER || '').trim()
  if (provider === 'github-artifacts') {
    for (const key of ['PARALITH_UPDATES_REPOSITORY', 'PARALITH_PREVIEW_BRIDGE_ENDPOINT', 'FIREBASE_PROJECT_ID', 'FIREBASE_HOSTING_SITE', 'GITHUB_REPOSITORY', 'PARALITH_INTERNAL_BUILD_NUMBER']) {
      if (!env[key] || String(env[key]).trim() === '') missing.push(key)
    }
    if (
      !String(env.PARALITH_UPDATES_TOKEN || '').trim()
      && !String(env.PARALITH_UPDATES_DEPLOY_KEY || '').trim()
    ) {
      missing.push('PARALITH_UPDATES_TOKEN or PARALITH_UPDATES_DEPLOY_KEY')
    }
    const hasWif = Boolean(String(env.GCP_WORKLOAD_IDENTITY_PROVIDER || '').trim() && String(env.GCP_SERVICE_ACCOUNT || '').trim())
    const hasServiceAccount = Boolean(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim())
    if (!hasWif && !hasServiceAccount) {
      missing.push('GCP_WORKLOAD_IDENTITY_PROVIDER + GCP_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_JSON')
    }
  } else if (provider === 'firebase-hosting') {
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
    const provider = String(env.PARALITH_UPDATE_PUBLISH_PROVIDER || '').trim()
    if (endpoint.protocol !== 'https:') invalid.push('PARALITH_PREVIEW_UPDATE_ENDPOINT')
    else if (provider === 'github-artifacts') {
      const expected = `/dasindusithmira2025-ops/paralith-updates/main/channels/preview/latest.json`
      const repository = String(env.PARALITH_UPDATES_REPOSITORY || '')
      const repositoryPath = repository ? `/${repository}/main/channels/preview/latest.json` : expected
      if (endpoint.hostname !== 'raw.githubusercontent.com' || endpoint.pathname !== repositoryPath) invalid.push('PARALITH_PREVIEW_UPDATE_ENDPOINT')
    } else if (endpoint.pathname !== '/preview/latest.json') invalid.push('PARALITH_PREVIEW_UPDATE_ENDPOINT')
  } catch {
    invalid.push('PARALITH_PREVIEW_UPDATE_ENDPOINT')
  }
  if (String(env.PARALITH_UPDATE_PUBLISH_PROVIDER || '').trim() !== 'github-artifacts') {
    try {
      if (new URL(env.PARALITH_UPDATE_ARTIFACT_BASE_URL).protocol !== 'https:') invalid.push('PARALITH_UPDATE_ARTIFACT_BASE_URL')
    } catch {
      invalid.push('PARALITH_UPDATE_ARTIFACT_BASE_URL')
    }
  }
  if (String(env.PARALITH_UPDATE_PUBLISH_PROVIDER || '').trim() === 'github-artifacts') {
    try {
      const bridge = new URL(env.PARALITH_PREVIEW_BRIDGE_ENDPOINT)
      if (bridge.protocol !== 'https:' || bridge.pathname !== '/preview/latest.json') invalid.push('PARALITH_PREVIEW_BRIDGE_ENDPOINT')
    } catch {
      invalid.push('PARALITH_PREVIEW_BRIDGE_ENDPOINT')
    }
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
