import { describe, expect, it } from 'vitest'
import {
  describeDistribution,
  distributionEnvironmentLines,
  githubArtifactBaseUrl,
  githubChannelManifestUrl,
  mirrorArtifactBaseUrl,
  mirrorChannelManifestUrl,
  normalizeBaseUrl,
  originPullSources,
  resolveDistribution,
  validateDistribution,
} from './update-distribution.mjs'

const REPOSITORY = 'dasindusithmira2025-ops/paralith-updates'
const TAG = 'stable-v0.5.0'
const release = { repository: REPOSITORY, channel: 'stable', tag: TAG }
const CANONICAL_ENDPOINT = `https://raw.githubusercontent.com/${REPOSITORY}/main/channels/stable/latest.json`
const CANONICAL_ARTIFACTS = `https://github.com/${REPOSITORY}/releases/download/${TAG}`
const MIRROR = 'https://updates.example.com'

/** Environment for a correctly configured release, plus any overrides under test. */
const environment = (overrides = {}) => ({
  PARALITH_STABLE_UPDATE_ENDPOINT: CANONICAL_ENDPOINT,
  ...overrides,
})

describe('canonical distribution (no mirror)', () => {
  it('keeps the published GitHub origin for both the endpoint and the installers', () => {
    const distribution = resolveDistribution(environment(), release)

    expect(distribution.mirrorBase).toBeNull()
    expect(distribution.endpoint).toBe(CANONICAL_ENDPOINT)
    expect(distribution.artifactBaseUrl).toBe(CANONICAL_ARTIFACTS)
    expect(distribution.endpoint).toBe(githubChannelManifestUrl(REPOSITORY, 'stable'))
    expect(distribution.artifactBaseUrl).toBe(githubArtifactBaseUrl(REPOSITORY, TAG))
  })

  it('accepts the configuration shipped by the current stable environment', () => {
    expect(validateDistribution(environment(), release)).toEqual([])
  })

  it('rejects an endpoint that does not match the derived canonical URL', () => {
    const problems = validateDistribution(
      environment({ PARALITH_STABLE_UPDATE_ENDPOINT: 'https://raw.githubusercontent.com/someone/else/main/channels/stable/latest.json' }),
      release,
    )

    expect(problems).toEqual([`PARALITH_STABLE_UPDATE_ENDPOINT must be exactly ${CANONICAL_ENDPOINT}`])
  })

  it('rejects a missing endpoint rather than silently building an unusable installer', () => {
    expect(validateDistribution({}, release)).toContain('PARALITH_STABLE_UPDATE_ENDPOINT is required')
  })
})

describe('mirror in manifest mode', () => {
  const mirrored = environment({
    PARALITH_UPDATE_MIRROR_BASE_URL: MIRROR,
    PARALITH_STABLE_UPDATE_ENDPOINT: `${MIRROR}/channels/stable/latest.json`,
  })

  it('moves only the manifest to the mirror and leaves installers on GitHub', () => {
    const distribution = resolveDistribution(mirrored, release)

    expect(distribution.mirrorMode).toBe('manifest')
    expect(distribution.endpoint).toBe(`${MIRROR}/channels/stable/latest.json`)
    expect(distribution.artifactBaseUrl).toBe(CANONICAL_ARTIFACTS)
    expect(distribution.canonicalEndpoint).toBe(CANONICAL_ENDPOINT)
  })

  it('validates when the endpoint variable matches the mirror URL', () => {
    expect(validateDistribution(mirrored, release)).toEqual([])
  })

  it('rejects a mirror endpoint that still points at the canonical origin', () => {
    const problems = validateDistribution({ ...mirrored, PARALITH_STABLE_UPDATE_ENDPOINT: CANONICAL_ENDPOINT }, release)

    expect(problems).toEqual([`PARALITH_STABLE_UPDATE_ENDPOINT must be exactly ${MIRROR}/channels/stable/latest.json`])
  })
})

describe('mirror in full mode', () => {
  const mirrored = environment({
    PARALITH_UPDATE_MIRROR_BASE_URL: `${MIRROR}/paralith/`,
    PARALITH_UPDATE_MIRROR_MODE: 'full',
    PARALITH_STABLE_UPDATE_ENDPOINT: `${MIRROR}/paralith/channels/stable/latest.json`,
  })

  it('serves installers from the mirror once explicitly opted in', () => {
    const distribution = resolveDistribution(mirrored, release)

    expect(distribution.artifactBaseUrl).toBe(`${MIRROR}/paralith/releases/${TAG}`)
    expect(distribution.endpoint).toBe(`${MIRROR}/paralith/channels/stable/latest.json`)
    // The origin is still recorded so a rollback target always exists.
    expect(distribution.canonicalArtifactBaseUrl).toBe(CANONICAL_ARTIFACTS)
    expect(validateDistribution(mirrored, release)).toEqual([])
  })

  it('tolerates a trailing slash on the declared mirror base', () => {
    expect(normalizeBaseUrl(`${MIRROR}///`)).toBe(MIRROR)
    expect(mirrorChannelManifestUrl(`${MIRROR}/`, 'stable')).toBe(`${MIRROR}/channels/stable/latest.json`)
    expect(mirrorArtifactBaseUrl(`${MIRROR}/`, TAG)).toBe(`${MIRROR}/releases/${TAG}`)
  })
})

describe('mirror configuration is refused when it cannot be trusted', () => {
  const rejects = (overrides, expected) => {
    const problems = validateDistribution(environment({ PARALITH_UPDATE_MIRROR_BASE_URL: MIRROR, ...overrides }), release)
    expect(problems).toContain(expected)
  }

  it('requires HTTPS, because the manifest decides which binary gets installed', () => {
    rejects({ PARALITH_UPDATE_MIRROR_BASE_URL: 'http://updates.example.com' }, 'PARALITH_UPDATE_MIRROR_BASE_URL must use HTTPS')
  })

  it('refuses embedded credentials that would leak to every installed client', () => {
    rejects({ PARALITH_UPDATE_MIRROR_BASE_URL: 'https://user:pass@updates.example.com' }, 'PARALITH_UPDATE_MIRROR_BASE_URL must not embed credentials')
  })

  it('refuses a query string or fragment that path joining would drop', () => {
    rejects({ PARALITH_UPDATE_MIRROR_BASE_URL: 'https://updates.example.com?token=1' }, 'PARALITH_UPDATE_MIRROR_BASE_URL must not contain a query string or fragment')
  })

  it('refuses a mirror that is really the canonical origin', () => {
    rejects(
      { PARALITH_UPDATE_MIRROR_BASE_URL: 'https://raw.githubusercontent.com/x/y' },
      'PARALITH_UPDATE_MIRROR_BASE_URL must not point back at the canonical GitHub origin',
    )
  })

  it('refuses an unknown mirror mode', () => {
    rejects({ PARALITH_UPDATE_MIRROR_MODE: 'partial' }, 'PARALITH_UPDATE_MIRROR_MODE must be one of: manifest, full')
  })

  it('refuses a mode set without a mirror to apply it to', () => {
    const problems = validateDistribution(environment({ PARALITH_UPDATE_MIRROR_MODE: 'full' }), release)

    expect(problems).toContain('PARALITH_UPDATE_MIRROR_MODE is set but PARALITH_UPDATE_MIRROR_BASE_URL is not')
  })

  it('refuses a malformed updates repository before anything else is derived', () => {
    expect(validateDistribution(environment(), { ...release, repository: 'not-a-repo' })).toEqual([
      'PARALITH_UPDATES_REPOSITORY must be an "owner/name" public repository',
    ])
  })
})

describe('reporting', () => {
  it('exports the derived URLs for the release workflow without rebuilding them by hand', () => {
    const distribution = resolveDistribution(
      environment({ PARALITH_UPDATE_MIRROR_BASE_URL: MIRROR, PARALITH_STABLE_UPDATE_ENDPOINT: `${MIRROR}/channels/stable/latest.json` }),
      release,
    )

    expect(distributionEnvironmentLines(distribution)).toEqual([
      `PARALITH_UPDATE_ENDPOINT=${MIRROR}/channels/stable/latest.json`,
      `PARALITH_UPDATE_ARTIFACT_BASE_URL=${CANONICAL_ARTIFACTS}`,
      `PARALITH_UPDATE_CANONICAL_ENDPOINT=${CANONICAL_ENDPOINT}`,
      `PARALITH_UPDATE_MIRROR_ENDPOINT=${MIRROR}/channels/stable/latest.json`,
    ])
  })

  it('omits the mirror export when no mirror is configured', () => {
    const lines = distributionEnvironmentLines(resolveDistribution(environment(), release))

    expect(lines.some((line) => line.startsWith('PARALITH_UPDATE_MIRROR_ENDPOINT='))).toBe(false)
  })

  it('summarises the distribution without leaking configuration values beyond URLs', () => {
    expect(describeDistribution(resolveDistribution(environment(), release))).toContain('mirror:             none')
  })

  it('reports the origin a pull-through mirror must be pointed at', () => {
    expect(originPullSources(REPOSITORY)).toEqual({
      channels: `https://raw.githubusercontent.com/${REPOSITORY}/main/channels/`,
      releases: `https://github.com/${REPOSITORY}/releases/download/`,
    })
  })
})
