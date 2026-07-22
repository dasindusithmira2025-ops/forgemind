import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Deterministic internal (preview-edition) version generation for the automatic push-to-main
// release pipeline. Internal builds are never hand-versioned: every merge to `main` produces a
// unique, monotonically increasing SemVer prerelease derived from the GitHub Actions run number.
//
// Given a shipped stable base of `0.4.0`, successive internal builds are
//   0.4.1-internal.101  <  0.4.1-internal.102  <  0.4.1-internal.103  <  0.4.1 (eventual stable)
// so each internal build is a valid upgrade over the previous one, sorts ABOVE the current stable
// (internal leads development), and sorts BELOW the eventual stable release of that patch.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseSemver(version) {
  const match = SEMVER.exec(String(version))
  if (!match) throw new Error(`Invalid semantic version: ${version}`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null }
}

/**
 * Compute the internal SemVer for a build.
 * @param {string} baseVersion canonical stable/prerelease version from release/version.json
 * @param {number|string} buildNumber positive integer (GitHub Actions run number)
 */
export function computeInternalVersion(baseVersion, buildNumber) {
  const build = Number(buildNumber)
  if (!Number.isInteger(build) || build <= 0) {
    throw new Error(`Internal build number must be a positive integer, received: ${buildNumber}`)
  }
  const { major, minor, patch, prerelease } = parseSemver(baseVersion)
  // A clean stable base means the next unreleased patch line is internal's target. A base that is
  // already a prerelease keeps its patch so we don't skip an unreleased line.
  const targetPatch = prerelease ? patch : patch + 1
  return `${major}.${minor}.${targetPatch}-internal.${build}`
}

/**
 * Build an ephemeral changelog entry for an internal build by carrying the base entry's notes.
 * The channel is `preview` (the recognized prerelease channel that backs the internal edition);
 * the internal prerelease identifier keeps `release:sync`'s "preview requires prerelease" gate happy.
 */
export function buildInternalChangelog(baseChangelog, version, { date, commit }) {
  return {
    version,
    channel: 'preview',
    date,
    highlights: baseChangelog.highlights,
    fixes: baseChangelog.fixes,
    databaseChanges: baseChangelog.databaseChanges,
    knownIssues: baseChangelog.knownIssues,
    requiredManualActions: baseChangelog.requiredManualActions,
    internal: { generated: true, commit, baseVersion: baseChangelog.version },
  }
}

async function apply() {
  const root = new URL('../../', import.meta.url)
  const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))
  const canonical = await readJson('release/version.json')
  const buildNumber = process.env.PARALITH_INTERNAL_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER
  const commit = (process.env.PARALITH_GIT_COMMIT || process.env.GITHUB_SHA || 'unknown').trim()
  const date = (process.env.PARALITH_BUILD_DATE || new Date().toISOString().slice(0, 10)).trim()

  const version = computeInternalVersion(canonical.version, buildNumber)
  const baseChangelog = await readJson(`release/changelog/${canonical.version.replace(/-.*$/, '')}.json`)
  const changelog = buildInternalChangelog(baseChangelog, version, { date, commit })

  await writeFile(new URL('release/version.json', root), `${JSON.stringify({ ...canonical, version }, null, 2)}\n`)
  await writeFile(new URL(`release/changelog/${version}.json`, root), `${JSON.stringify(changelog, null, 2)}\n`)

  // Machine-readable output for the workflow, plus a human line.
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `version=${version}\ntag=internal-v${version}\n`, { flag: 'a' })
  }
  console.log(version)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2] || 'apply'
  if (mode === 'compute') {
    const base = process.argv[3] ?? JSON.parse(await readFile(new URL('../../release/version.json', import.meta.url), 'utf8')).version
    const build = process.argv[4] ?? process.env.PARALITH_INTERNAL_BUILD_NUMBER ?? process.env.GITHUB_RUN_NUMBER
    console.log(computeInternalVersion(base, build))
  } else if (mode === 'apply') {
    await apply()
  } else {
    throw new Error(`Unknown mode: ${mode} (expected "apply" or "compute")`)
  }
}
