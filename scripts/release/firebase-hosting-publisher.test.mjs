import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatMissingPublishKeys, invalidPublishConfiguration, missingPublishKeys } from './preflight-publish.mjs'
import {
  FIREBASE_CLI_VERSION,
  FIREBASE_DEPLOYMENT_CONCURRENCY_GROUP,
  assertDeploySucceeded,
  firebaseDeployInvocation,
  firebaseHostingConfig,
  activatePreviewManifest,
  stageFirebaseHostingSite,
  verifyFirebaseDeployment,
  verifyReleaseArtifacts,
  writeFirebaseDeployConfig,
} from './firebase-hosting-publisher.mjs'

const previewEndpoint = 'https://corelith-paralith-updates.web.app/preview/latest.json'
const stableEndpoint = 'https://corelith-paralith-updates.web.app/stable/latest.json'
const completeFirebaseEnv = {
  TAURI_SIGNING_PRIVATE_KEY: 'private-key',
  PARALITH_PREVIEW_UPDATE_ENDPOINT: previewEndpoint,
  PARALITH_UPDATE_ARTIFACT_BASE_URL: 'https://corelith-paralith-updates.web.app/preview',
  PARALITH_UPDATE_PUBLISH_PROVIDER: 'firebase-hosting',
  FIREBASE_PROJECT_ID: 'project',
  FIREBASE_HOSTING_SITE: 'site',
  GITHUB_REPOSITORY: 'owner/repo',
  PARALITH_INTERNAL_BUILD_NUMBER: '1002',
  GCP_WORKLOAD_IDENTITY_PROVIDER: 'projects/1/locations/global/workloadIdentityPools/pool/providers/provider',
  GCP_SERVICE_ACCOUNT: 'publisher@project.iam.gserviceaccount.com',
}

function manifest(overrides = {}) {
  return {
    version: '0.4.1-1002',
    notes: 'Release notes',
    platforms: {
      'windows-x86_64': { url: 'https://corelith-paralith-updates.web.app/preview/0.4.1-1002/app.exe', signature: 'signature' },
      'windows-x86_64-nsis': { url: 'https://corelith-paralith-updates.web.app/preview/0.4.1-1002/app.exe', signature: 'signature' },
      'windows-x86_64-msi': { url: 'https://corelith-paralith-updates.web.app/preview/0.4.1-1002/app.msi', signature: 'signature' },
    },
    paralith: { edition: 'preview', channel: 'preview', schemaVersion: 22 },
    ...overrides,
  }
}

const jsonResponse = (value, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const artifactResponse = () => new Response('', { status: 200, headers: { 'content-length': '1024' } })

describe('Firebase Hosting publication preflight', () => {
  it('accepts Workload Identity Federation configuration', () => {
    expect(missingPublishKeys(completeFirebaseEnv)).toEqual([])
  })

  it('accepts the service-account fallback without Workload Identity Federation', () => {
    const env = { ...completeFirebaseEnv, GCP_WORKLOAD_IDENTITY_PROVIDER: '', GCP_SERVICE_ACCOUNT: '', FIREBASE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}' }
    expect(missingPublishKeys(env)).toEqual([])
  })

  it('names missing Firebase configuration without leaking secrets', () => {
    const missing = missingPublishKeys({ ...completeFirebaseEnv, FIREBASE_PROJECT_ID: '', GCP_WORKLOAD_IDENTITY_PROVIDER: '', GCP_SERVICE_ACCOUNT: '' })
    const output = formatMissingPublishKeys(missing)
    expect(missing).toContain('FIREBASE_PROJECT_ID')
    expect(missing).toContain('GCP_WORKLOAD_IDENTITY_PROVIDER + GCP_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_JSON')
    expect(output).not.toContain('private-key')
  })

  it('requires the installed-client endpoint, HTTPS artifact base, and schema metadata', () => {
    expect(invalidPublishConfiguration({ ...completeFirebaseEnv, PARALITH_PREVIEW_UPDATE_ENDPOINT: 'https://host/other.json', PARALITH_UPDATE_ARTIFACT_BASE_URL: 'http://host/preview' }, { version: '', schemaVersion: 0 })).toEqual(expect.arrayContaining([
      'PARALITH_PREVIEW_UPDATE_ENDPOINT',
      'PARALITH_UPDATE_ARTIFACT_BASE_URL',
      'release/version.json.version',
      'release/version.json.schemaVersion',
    ]))
  })
})

describe('Firebase Hosting site staging', () => {
  it('writes the Preview manifest at /preview/latest.json and preserves exact Stable bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const source = join(root, 'update-site', 'preview')
      const destination = join(root, 'update-site-dist')
      const statePath = join(root, 'state.json')
      const stableBytes = Buffer.from('{"stable":"exact bytes"}\n')
      await mkdir(join(source, '0.4.1-1002'), { recursive: true })
      await writeFile(join(source, 'latest.json'), JSON.stringify(manifest()))
      await writeFile(join(source, '0.4.1-1002', 'app.exe'), 'signed payload')
      const result = await stageFirebaseHostingSite({
        previewSourceDirectory: source,
        previewEndpoint,
        destination,
        statePath,
        fetchImpl: async (url) => {
          if (url === stableEndpoint) return new Response(stableBytes, { status: 200 })
          if (url === previewEndpoint) return new Response('{"previous":true}', { status: 200 })
          throw new Error(`Unexpected URL ${url}`)
        },
      })
      expect(await readFile(join(destination, 'preview', 'latest.json'), 'utf8')).toBe('{"previous":true}')
      expect(await readFile(join(destination, 'preview', '0.4.1-1002', 'app.exe'), 'utf8')).toBe('signed payload')
      expect(await readFile(join(destination, 'stable', 'latest.json'))).toEqual(stableBytes)
      expect(result.stable.sha256).toMatch(/^[a-f0-9]{64}$/)
      await activatePreviewManifest({ previewManifestPath: join(source, 'latest.json'), destination })
      expect(await readFile(join(destination, 'preview', 'latest.json'), 'utf8')).toContain('0.4.1-1002')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves a Stable 404 by not generating a fake manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const source = join(root, 'update-site', 'preview')
      const destination = join(root, 'update-site-dist')
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'latest.json'), JSON.stringify(manifest()))
      const result = await stageFirebaseHostingSite({ previewSourceDirectory: source, previewEndpoint, destination, statePath: join(root, 'state.json'), fetchImpl: async () => new Response('', { status: 404 }) })
      expect(result.stable.status).toBe(404)
      await expect(readFile(join(destination, 'stable', 'latest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses deployment when existing Stable content cannot be read safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const source = join(root, 'update-site', 'preview')
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'latest.json'), JSON.stringify(manifest()))
      await expect(stageFirebaseHostingSite({ previewSourceDirectory: source, previewEndpoint, destination: join(root, 'site'), statePath: join(root, 'state.json'), fetchImpl: async () => new Response('', { status: 503 }) })).rejects.toThrow('refusing to deploy')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Firebase configuration and deployment command', () => {
  it('pins Firebase CLI and configures no-cache JSON without an SPA rewrite', async () => {
    const base = JSON.parse(await readFile(join(process.cwd(), 'firebase.json'), 'utf8'))
    const config = firebaseHostingConfig(base, 'corelith-paralith-updates')
    expect(FIREBASE_CLI_VERSION).toBe('13.35.1')
    expect(config.hosting.site).toBe('corelith-paralith-updates')
    expect(config.hosting.public).toBe('update-site-dist')
    expect(config.hosting.rewrites).toBeUndefined()
    expect(config.hosting.headers[0].source).toBe('/preview/latest.json')
    expect(config.hosting.headers[0].headers).toEqual(expect.arrayContaining([
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Content-Type', value: 'application/json; charset=utf-8' },
    ]))
  })

  it('creates a selected-site Firebase deploy config and command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const base = join(root, 'firebase.json')
      const output = join(root, '.artifacts', 'firebase.json')
      await writeFile(base, JSON.stringify({ hosting: { public: 'update-site-dist' } }))
      await writeFirebaseDeployConfig({ baseConfigPath: base, outputPath: output, site: 'site' })
      expect(JSON.parse(await readFile(output, 'utf8')).hosting.site).toBe('site')
      expect(firebaseDeployInvocation({ projectId: 'project', configPath: output })).toEqual(['firebase', 'deploy', '--only', 'hosting', '--project', 'project', '--config', output, '--non-interactive'])
      expect(() => assertDeploySucceeded(1)).toThrow('deployment failed')
      expect(() => assertDeploySucceeded(0)).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the shared Firebase deployment concurrency group', async () => {
    expect(FIREBASE_DEPLOYMENT_CONCURRENCY_GROUP).toBe('firebase-hosting-update-site')
    const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'release-internal.yml'), 'utf8')
    expect(workflow).toContain(`group: ${FIREBASE_DEPLOYMENT_CONCURRENCY_GROUP}`)
  })
})

describe('release and live deployment verification', () => {
  it('rejects an inaccessible Firebase-hosted artifact before manifest activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const path = join(root, 'latest.json')
      await writeFile(path, JSON.stringify(manifest()))
      await expect(verifyReleaseArtifacts({ manifestPath: path, expectedVersion: '0.4.1-1002', fetchImpl: async () => new Response('', { status: 404 }) })).rejects.toThrow('returned HTTP 404')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects missing signatures, Windows entries, and versions that do not advance the installed build', async () => {
    const bad = manifest({ version: '0.4.1-1001' })
    delete bad.platforms['windows-x86_64-msi']
    bad.platforms['windows-x86_64'].signature = ''
    await expect(verifyFirebaseDeployment({
      previewEndpoint,
      expectedVersion: '0.4.1-1001',
      stable: { status: 404, endpoint: stableEndpoint },
      attempts: 1,
      fetchImpl: async (url) => url === previewEndpoint ? jsonResponse(bad) : new Response('', { status: 404 }),
    })).rejects.toThrow(/signature|missing|not strictly newer/)
  })

  it('rejects HTML fallback and Stable hash changes', async () => {
    await expect(verifyFirebaseDeployment({
      previewEndpoint,
      expectedVersion: '0.4.1-1002',
      stable: { status: 200, endpoint: stableEndpoint, sha256: '0'.repeat(64) },
      attempts: 1,
      fetchImpl: async (url) => url === previewEndpoint
        ? new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response('{"different":true}', { status: 200 }),
    })).rejects.toThrow(/content type|HTML/)

    await expect(verifyFirebaseDeployment({
      previewEndpoint,
      expectedVersion: '0.4.1-1002',
      stable: { status: 200, endpoint: stableEndpoint, sha256: '0'.repeat(64) },
      attempts: 1,
      fetchImpl: async (url, options = {}) => {
        if (url === previewEndpoint) return jsonResponse(manifest())
        if (url === stableEndpoint) return new Response('{"different":true}', { status: 200 })
        if (options.method === 'HEAD') return artifactResponse()
        return artifactResponse()
      },
    })).rejects.toThrow('Stable manifest hash changed')
  })

  it('retries boundedly until Firebase CDN serves the valid manifest and unchanged Stable content', async () => {
    const stableBytes = Buffer.from('{"stable":true}')
    const stableHash = (await import('node:crypto')).createHash('sha256').update(stableBytes).digest('hex')
    let previewCalls = 0
    const deployed = await verifyFirebaseDeployment({
      previewEndpoint,
      expectedVersion: '0.4.1-1002',
      stable: { status: 200, endpoint: stableEndpoint, sha256: stableHash },
      attempts: 2,
      delay: async () => {},
      fetchImpl: async (url, options = {}) => {
        if (url === previewEndpoint) {
          previewCalls += 1
          return previewCalls === 1 ? new Response('', { status: 404 }) : jsonResponse(manifest())
        }
        if (url === stableEndpoint) return new Response(stableBytes, { status: 200 })
        if (options.method === 'HEAD') return artifactResponse()
        return artifactResponse()
      },
    })
    expect(deployed.version).toBe('0.4.1-1002')
    expect(previewCalls).toBe(2)
  })
})
