import { describe, expect, it } from 'vitest'
import { comparePrecedence, validateManifest } from './verify-published-manifest.mjs'
import { missingPublishKeys } from './preflight-publish.mjs'

function manifest(overrides = {}) {
  return {
    version: '0.4.1-1002',
    notes: 'notes',
    pub_date: '2026-07-23T00:00:00Z',
    platforms: {
      'windows-x86_64': { url: 'https://host/preview/0.4.1-1002/setup.exe', signature: 'sig-nsis' },
      'windows-x86_64-nsis': { url: 'https://host/preview/0.4.1-1002/setup.exe', signature: 'sig-nsis' },
      'windows-x86_64-msi': { url: 'https://host/preview/0.4.1-1002/app.msi', signature: 'sig-msi' },
    },
    paralith: { edition: 'preview', channel: 'preview', schemaVersion: 22 },
    ...overrides,
  }
}

describe('comparePrecedence', () => {
  it('orders internal builds and stable per SemVer precedence', () => {
    expect(comparePrecedence('0.4.1-1002', '0.4.1-1001')).toBeGreaterThan(0)
    expect(comparePrecedence('0.4.1-1001', '0.4.1-1001')).toBe(0)
    expect(comparePrecedence('0.4.1-1001', '0.4.1-1002')).toBeLessThan(0)
    // Numeric prerelease identifiers compare numerically, not lexically (10 > 2).
    expect(comparePrecedence('0.4.1-10', '0.4.1-2')).toBeGreaterThan(0)
    // A released stable sorts above its own prereleases.
    expect(comparePrecedence('0.4.1', '0.4.1-9999')).toBeGreaterThan(0)
  })
})

describe('validateManifest', () => {
  const opts = { expectedVersion: '0.4.1-1002', edition: 'preview' }

  it('accepts a well-formed preview manifest', () => {
    expect(validateManifest(manifest(), opts)).toEqual([])
  })

  it('rejects a version mismatch', () => {
    const errors = validateManifest(manifest({ version: '0.4.1-1001' }), opts)
    expect(errors.join(' ')).toMatch(/does not equal released version/)
  })

  it('rejects a missing or empty signature', () => {
    const m = manifest()
    m.platforms['windows-x86_64'].signature = ''
    expect(validateManifest(m, opts).join(' ')).toMatch(/signature is missing/)
  })

  it('rejects a non-https artifact url', () => {
    const m = manifest()
    m.platforms['windows-x86_64'].url = 'http://insecure/setup.exe'
    expect(validateManifest(m, opts).join(' ')).toMatch(/must be an https URL/)
  })

  it('rejects a wrong channel (stable metadata must not appear on preview)', () => {
    const m = manifest({ paralith: { edition: 'stable', channel: 'stable', schemaVersion: 22 } })
    expect(validateManifest(m, opts).join(' ')).toMatch(/is not "preview"/)
  })

  it('rejects a preview version that is not a prerelease', () => {
    expect(validateManifest(manifest({ version: '0.4.1' }), { expectedVersion: '0.4.1', edition: 'preview' }).join(' ')).toMatch(/must be a prerelease/)
  })

  it('rejects a version that is not strictly newer than the previous published one', () => {
    const errors = validateManifest(manifest({ version: '0.4.1-1002' }), { ...opts, previousVersion: '0.4.1-1002' })
    expect(errors.join(' ')).toMatch(/not strictly newer/)
  })
})

describe('missingPublishKeys', () => {
  const complete = {
    TAURI_SIGNING_PRIVATE_KEY: 'k',
    PARALITH_PREVIEW_UPDATE_ENDPOINT: 'https://host/preview/latest.json',
    PARALITH_UPDATE_ARTIFACT_BASE_URL: 'https://host/preview',
    PARALITH_UPDATE_PUBLISH_PROVIDER: 'filesystem',
    PARALITH_UPDATE_PUBLISH_TARGET: '/site',
  }

  it('passes when all required keys are present', () => {
    expect(missingPublishKeys(complete)).toEqual([])
  })

  it('names every missing key (and nothing else)', () => {
    const missing = missingPublishKeys({ TAURI_SIGNING_PRIVATE_KEY: 'k' })
    expect(missing).toContain('PARALITH_UPDATE_PUBLISH_TARGET')
    expect(missing).toContain('PARALITH_UPDATE_PUBLISH_PROVIDER')
    expect(missing).not.toContain('TAURI_SIGNING_PRIVATE_KEY')
  })

  it('requires a bearer token only for the http provider', () => {
    expect(missingPublishKeys({ ...complete, PARALITH_UPDATE_PUBLISH_PROVIDER: 'http' })).toEqual(['PARALITH_UPDATE_PUBLISH_TOKEN'])
    expect(missingPublishKeys({ ...complete, PARALITH_UPDATE_PUBLISH_PROVIDER: 'http', PARALITH_UPDATE_PUBLISH_TOKEN: 't' })).toEqual([])
  })
})
