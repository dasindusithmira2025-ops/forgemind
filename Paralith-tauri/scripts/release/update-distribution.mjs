// Where an installed PARALITH looks for updates, and where it downloads them from.
//
// The public `paralith-updates` GitHub repository is the canonical publication target and stays
// that way: every release is written there first, so builds that were shipped with a GitHub
// endpoint baked in keep updating forever. A third-party mirror is an optional layer *in front* of
// it, declared by `PARALITH_UPDATE_MIRROR_BASE_URL`, and only new builds are pointed at it.
//
// The mirror is expected to be origin-pull (it fetches from GitHub on demand and caches). That is
// deliberate: no credentials, no signing key, and no upload step ever leaves this repository, and a
// mirror operator can never publish an update we did not sign.
//
// Two modes exist so the switchover can be staged instead of gambled on:
//
//   manifest (default) — the mirror serves only `channels/<channel>/latest.json`. Installers keep
//                        their GitHub Release URLs. A mirror outage costs an update *check*, which
//                        the app retries; it cannot strand a download half-way.
//   full               — the mirror serves the installers too. Use this only once the mirror has
//                        proven itself in `manifest` mode, because these URLs are signed into the
//                        manifest and cannot be rewritten after the fact.
//
// Every value here is derived, never hand-typed into CI, so the endpoint compiled into the binary
// and the URLs written into the manifest cannot drift apart.

import { appendFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const MIRROR_BASE_ENV = 'PARALITH_UPDATE_MIRROR_BASE_URL'
export const MIRROR_MODE_ENV = 'PARALITH_UPDATE_MIRROR_MODE'
export const MIRROR_MODES = ['manifest', 'full']

/** Trim whitespace and trailing slashes so `https://cdn/` and `https://cdn` build identical URLs. */
export function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

export function githubChannelManifestUrl(repository, channel, branch = 'main') {
  return `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/channels/${channel}/latest.json`
}

export function githubArtifactBaseUrl(repository, tag) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`
}

/** Mirror path for a channel manifest. Mirrors the GitHub layout so origin-pull needs no rewriting. */
export function mirrorChannelManifestUrl(mirrorBase, channel) {
  return `${normalizeBaseUrl(mirrorBase)}/channels/${channel}/latest.json`
}

/** Mirror path for a release's flat installer assets. */
export function mirrorArtifactBaseUrl(mirrorBase, tag) {
  return `${normalizeBaseUrl(mirrorBase)}/releases/${encodeURIComponent(tag)}`
}

/** The upstream origin a mirror must pull from, reported so an operator can be configured from CI. */
export function originPullSources(repository, branch = 'main') {
  return {
    channels: `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/channels/`,
    releases: `https://github.com/${repository}/releases/download/`,
  }
}

/**
 * Resolve every distribution URL for one release from the environment.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{ repository: string, channel: string, tag: string, branch?: string }} release
 * @returns {{
 *   mirrorBase: string|null, mirrorMode: string,
 *   endpoint: string, artifactBaseUrl: string,
 *   canonicalEndpoint: string, canonicalArtifactBaseUrl: string,
 *   mirrorEndpoint: string|null,
 * }}
 */
export function resolveDistribution(env, { repository, channel, tag, branch = 'main' }) {
  const mirrorBase = normalizeBaseUrl(env[MIRROR_BASE_ENV]) || null
  const mirrorMode = String(env[MIRROR_MODE_ENV] || 'manifest').trim() || 'manifest'
  const canonicalEndpoint = githubChannelManifestUrl(repository, channel, branch)
  const canonicalArtifactBaseUrl = githubArtifactBaseUrl(repository, tag)
  const mirrorEndpoint = mirrorBase ? mirrorChannelManifestUrl(mirrorBase, channel) : null
  return {
    mirrorBase,
    mirrorMode,
    endpoint: mirrorEndpoint ?? canonicalEndpoint,
    // Installer URLs are signed into the manifest permanently, so they only move to the mirror
    // under the explicit `full` opt-in.
    artifactBaseUrl: mirrorBase && mirrorMode === 'full'
      ? mirrorArtifactBaseUrl(mirrorBase, tag)
      : canonicalArtifactBaseUrl,
    canonicalEndpoint,
    canonicalArtifactBaseUrl,
    mirrorEndpoint,
  }
}

/**
 * Validate the release distribution configuration before an expensive signed build starts.
 * Returns human-readable problems (never values of secrets); empty means valid.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{ repository: string, channel: string, tag: string, branch?: string }} release
 */
export function validateDistribution(env, { repository, channel, tag, branch = 'main' }) {
  const problems = []
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    problems.push('PARALITH_UPDATES_REPOSITORY must be an "owner/name" public repository')
    return problems
  }
  const rawMirror = String(env[MIRROR_BASE_ENV] ?? '').trim()
  const mirrorMode = String(env[MIRROR_MODE_ENV] ?? '').trim()
  if (mirrorMode && !MIRROR_MODES.includes(mirrorMode)) {
    problems.push(`${MIRROR_MODE_ENV} must be one of: ${MIRROR_MODES.join(', ')}`)
  }
  if (!rawMirror && mirrorMode) {
    problems.push(`${MIRROR_MODE_ENV} is set but ${MIRROR_BASE_ENV} is not`)
  }
  if (rawMirror) {
    let mirror
    try {
      mirror = new URL(rawMirror)
    } catch {
      problems.push(`${MIRROR_BASE_ENV} is not a valid URL`)
    }
    if (mirror) {
      // A mirror is fetched by every installed copy of the app, so it gets the same scrutiny as the
      // canonical origin: transport-encrypted, no embedded credentials, no query or fragment that a
      // cache or path join would silently drop.
      if (mirror.protocol !== 'https:') problems.push(`${MIRROR_BASE_ENV} must use HTTPS`)
      if (mirror.username || mirror.password) problems.push(`${MIRROR_BASE_ENV} must not embed credentials`)
      if (mirror.search || mirror.hash) problems.push(`${MIRROR_BASE_ENV} must not contain a query string or fragment`)
      if (mirror.hostname === 'raw.githubusercontent.com' || mirror.hostname === 'github.com') {
        problems.push(`${MIRROR_BASE_ENV} must not point back at the canonical GitHub origin`)
      }
    }
  }

  const expected = resolveDistribution(env, { repository, channel, tag, branch })
  const endpointName = channel === 'stable' ? 'PARALITH_STABLE_UPDATE_ENDPOINT' : 'PARALITH_PREVIEW_UPDATE_ENDPOINT'
  const configured = String(env[endpointName] ?? '').trim()
  if (!configured) {
    problems.push(`${endpointName} is required`)
  } else if (configured !== expected.endpoint) {
    // Reported without the configured value: the name plus the derived expectation is enough to fix
    // it, and endpoints are copied between environments by hand often enough to warrant the hint.
    problems.push(`${endpointName} must be exactly ${expected.endpoint}`)
  }
  return problems
}

/** Secret-free summary of where a release will be published and polled from. */
export function describeDistribution(distribution) {
  const lines = [
    `update endpoint:    ${distribution.endpoint}`,
    `installer base URL: ${distribution.artifactBaseUrl}`,
    `canonical origin:   ${distribution.canonicalEndpoint}`,
  ]
  if (distribution.mirrorBase) {
    lines.push(`mirror:             ${distribution.mirrorBase} (mode: ${distribution.mirrorMode})`)
  } else {
    lines.push('mirror:             none (canonical GitHub origin only)')
  }
  return lines.join('\n')
}

/** `KEY=value` lines for `$GITHUB_ENV`, so the workflow never rebuilds these URLs by hand. */
export function distributionEnvironmentLines(distribution) {
  const lines = [
    `PARALITH_UPDATE_ENDPOINT=${distribution.endpoint}`,
    `PARALITH_UPDATE_ARTIFACT_BASE_URL=${distribution.artifactBaseUrl}`,
    `PARALITH_UPDATE_CANONICAL_ENDPOINT=${distribution.canonicalEndpoint}`,
  ]
  if (distribution.mirrorEndpoint) lines.push(`PARALITH_UPDATE_MIRROR_ENDPOINT=${distribution.mirrorEndpoint}`)
  return lines
}

async function main() {
  const [channel, tag] = process.argv.slice(2)
  if (!['stable', 'preview'].includes(channel) || !tag) {
    throw new Error('usage: update-distribution <stable|preview> <tag>')
  }
  const repository = String(process.env.PARALITH_UPDATES_REPOSITORY || '')
  const branch = process.env.PARALITH_UPDATES_BRANCH || 'main'
  const problems = validateDistribution(process.env, { repository, channel, tag, branch })
  if (problems.length > 0) {
    console.error(`${channel} update distribution configuration FAILED:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  const distribution = resolveDistribution(process.env, { repository, channel, tag, branch })
  console.log(describeDistribution(distribution))
  const origins = originPullSources(repository, branch)
  if (distribution.mirrorBase) {
    console.log(`mirror origin (channels): ${origins.channels}`)
    if (distribution.mirrorMode === 'full') console.log(`mirror origin (releases): ${origins.releases}`)
  }
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `${distributionEnvironmentLines(distribution).join('\n')}\n`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
