import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Post-publish verification. A local manifest passing checks proves nothing about what an installed
// app can actually download — the app polls a live URL. This fetches the REAL published manifest and
// fails the release if the preview channel is not genuinely usable: wrong/old version, missing
// signed Windows artifact, unreachable artifact, or wrong channel. Run it after publishing.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

function parse(version) {
  const match = SEMVER.exec(String(version))
  if (!match) return null
  return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] ?? null }
}

/** SemVer precedence: >0 when a is newer than b (numeric prerelease identifiers compared numerically). */
export function comparePrecedence(a, b) {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) throw new Error(`Invalid version in comparison: ${a} vs ${b}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key]
  }
  if (pa.prerelease === pb.prerelease) return 0
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1
  const ia = pa.prerelease.split('.')
  const ib = pb.prerelease.split('.')
  for (let i = 0; i < Math.max(ia.length, ib.length); i += 1) {
    if (ia[i] === undefined) return -1
    if (ib[i] === undefined) return 1
    const na = Number(ia[i])
    const nb = Number(ib[i])
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb
    } else if (ia[i] !== ib[i]) {
      return ia[i] < ib[i] ? -1 : 1
    }
  }
  return 0
}

/**
 * Structural validation of a fetched manifest. Returns an array of human-readable problems; empty
 * means valid. Pure (no I/O) so it is unit-tested directly.
 * @param {any} manifest parsed latest.json
 * @param {{ expectedVersion: string, edition: string, previousVersion?: string|null }} opts
 */
export function validateManifest(manifest, { expectedVersion, edition, previousVersion = null }) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') {
    return ['manifest is not a JSON object']
  }
  if (manifest.version !== expectedVersion) {
    errors.push(`manifest version "${manifest.version}" does not equal released version "${expectedVersion}"`)
  }
  if (!parse(manifest.version)) {
    errors.push(`manifest version "${manifest.version}" is not valid SemVer`)
  } else if (edition === 'preview' && parse(manifest.version).prerelease === null) {
    errors.push('preview manifest version must be a prerelease')
  }
  if (previousVersion && parse(manifest.version) && parse(previousVersion)) {
    if (comparePrecedence(manifest.version, previousVersion) <= 0) {
      errors.push(`published version "${manifest.version}" is not strictly newer than previously published "${previousVersion}"`)
    }
  }
  const platforms = manifest.platforms
  if (!platforms || typeof platforms !== 'object') {
    errors.push('manifest.platforms is missing')
  } else {
    for (const key of ['windows-x86_64', 'windows-x86_64-nsis', 'windows-x86_64-msi']) {
      const entry = platforms[key]
      if (!entry || typeof entry !== 'object') {
        errors.push(`manifest.platforms["${key}"] is missing`)
        continue
      }
      if (!entry.url || !/^https:\/\//.test(String(entry.url))) {
        errors.push(`manifest.platforms["${key}"].url must be an https URL`)
      }
      if (!entry.signature || String(entry.signature).trim() === '') {
        errors.push(`manifest.platforms["${key}"].signature is missing or empty`)
      }
    }
  }
  const channel = manifest.paralith && manifest.paralith.channel
  if (channel !== edition) {
    errors.push(`manifest channel "${channel}" is not "${edition}"`)
  }
  return errors
}

async function fetchStatus(url, method = 'GET') {
  const response = await fetch(url, { method, redirect: 'follow' })
  return response
}

/**
 * One full check of a live manifest URL: reachable, structurally valid for the release, and
 * pointing at an artifact that actually downloads. Returns human-readable problems; empty is a pass.
 */
export async function checkPublishedManifest(edition, endpoint, expectedVersion, previousVersion = null) {
  const response = await fetchStatus(endpoint)
  if (response.status !== 200) {
    throw new Error(`Published ${edition} manifest ${endpoint} returned HTTP ${response.status}, expected 200`)
  }
  let manifest
  try {
    manifest = await response.json()
  } catch (error) {
    throw new Error(`Published ${edition} manifest is not valid JSON: ${error.message}`)
  }
  const errors = validateManifest(manifest, { expectedVersion, edition, previousVersion: previousVersion || null })

  // The manifest can be structurally valid but point at an artifact that was never uploaded.
  const artifactUrl = manifest?.platforms?.['windows-x86_64']?.url
  if (artifactUrl && /^https:\/\//.test(artifactUrl)) {
    let artifact = await fetchStatus(artifactUrl, 'HEAD')
    // Some static hosts do not answer HEAD; fall back to a ranged GET.
    if (artifact.status === 405 || artifact.status === 501) {
      artifact = await fetch(artifactUrl, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' })
    }
    if (![200, 206].includes(artifact.status)) {
      errors.push(`updater artifact ${artifactUrl} returned HTTP ${artifact.status}`)
    }
  }
  return errors
}

async function main() {
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
  const [edition, endpoint, expectedVersion, previousVersion] = positional
  if (!edition || !endpoint || !expectedVersion) {
    throw new Error('usage: verify-published-manifest <edition> <manifestUrl> <expectedVersion> [previousVersion] [--attempts=N]')
  }
  // A freshly published mirror is usually cold: the first request is what makes it pull from the
  // origin. Retrying turns that expected warm-up into a wait instead of a failed release.
  const attemptsFlag = process.argv.slice(2).find((argument) => argument.startsWith('--attempts='))
  const attempts = Math.max(1, Number(attemptsFlag?.split('=')[1] || 1))
  let errors = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      errors = await checkPublishedManifest(edition, endpoint, expectedVersion, previousVersion || null)
    } catch (error) {
      errors = [error.message]
    }
    if (errors.length === 0) break
    if (attempt < attempts) {
      console.log(`Attempt ${attempt}/${attempts} for ${endpoint} not ready yet; retrying in 10s.`)
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
  }

  if (errors.length > 0) {
    console.error(`Published ${edition} manifest verification FAILED:`)
    for (const problem of errors) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`Verified published ${edition} manifest at ${endpoint}: advertises ${expectedVersion} with a reachable signed Windows artifact.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
