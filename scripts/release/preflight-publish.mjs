import process from 'node:process'
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
  'PARALITH_UPDATE_ARTIFACT_BASE_URL', // variable: base URL embedded in manifest artifact links
  'PARALITH_UPDATE_PUBLISH_PROVIDER', // variable: filesystem | s3 | ssh | http
  'PARALITH_UPDATE_PUBLISH_TARGET', // secret: where the update site is published
]

/** Return the names of required keys that are absent/blank in `env`. */
export function missingPublishKeys(env) {
  const missing = REQUIRED.filter((key) => !env[key] || String(env[key]).trim() === '')
  // The HTTP publishing provider additionally needs a bearer token.
  if (
    String(env.PARALITH_UPDATE_PUBLISH_PROVIDER || '').trim() === 'http' &&
    (!env.PARALITH_UPDATE_PUBLISH_TOKEN || !String(env.PARALITH_UPDATE_PUBLISH_TOKEN).trim())
  ) {
    missing.push('PARALITH_UPDATE_PUBLISH_TOKEN')
  }
  return missing
}

function main() {
  const missing = missingPublishKeys(process.env)
  if (missing.length > 0) {
    console.error('Preview release preflight FAILED — missing required publish configuration (values not shown):')
    for (const key of missing) console.error(`  - ${key}`)
    console.error('')
    console.error('Add these to the GitHub "preview-release" environment (Settings → Environments),')
    console.error('then re-run the release. The release will not build until publishing can succeed.')
    process.exit(1)
  }
  console.log('Preview publish preflight passed: all required publish configuration is present.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
