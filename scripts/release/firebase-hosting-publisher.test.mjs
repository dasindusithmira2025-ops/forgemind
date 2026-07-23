import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatMissingPublishKeys, invalidPublishConfiguration, missingPublishKeys } from './preflight-publish.mjs'
import {
  FIREBASE_CLI_VERSION,
  FIREBASE_DEPLOYMENT_CONCURRENCY_GROUP,
  assertDeployReady,
  assertDeploySucceeded,
  firebaseDeployInvocation,
  firebaseHostingConfig,
  activatePreviewManifest,
  planReleasePublication,
  resolveConfigPublicDirectory,
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

// Regression coverage for the staging/config path defect that caused
// "Directory 'update-site-dist' for Hosting does not exist." in run 30021066339.
async function stageDeployTree(root, { version = '0.4.1-1002', generateConfig = true, configPublicDir } = {}) {
  const dist = join(root, '.artifacts', 'update-site-dist')
  const payloadDir = join(dist, 'preview', version)
  await mkdir(payloadDir, { recursive: true })
  await writeFile(join(payloadDir, 'PARALITH_0.4.1_x64-setup.exe'), 'signed installer bytes')
  await writeFile(join(payloadDir, 'PARALITH_0.4.1_x64-setup.exe.sig'), 'updater-signature')
  await writeFile(join(payloadDir, 'PARALITH_0.4.1_x64_en-US.msi'), 'signed installer bytes')
  const source = join(root, '.artifacts', 'update-site', 'preview')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'latest.json'), JSON.stringify(manifest()))
  const base = join(root, 'firebase.json')
  await writeFile(base, JSON.stringify({ hosting: { public: 'update-site-dist' } }))
  const configPath = join(root, '.artifacts', 'firebase-hosting.json')
  if (generateConfig) await writeFirebaseDeployConfig({ baseConfigPath: base, outputPath: configPath, site: 'site', publicDir: configPublicDir ?? dist })
  return { dist, base, sourceManifestPath: join(source, 'latest.json'), configPath }
}

describe('Firebase deploy path/staging coherence', () => {
  it('pins the generated deploy config public directory to an absolute staged path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const base = join(root, 'firebase.json')
      await writeFile(base, JSON.stringify({ hosting: { public: 'update-site-dist' } }))
      const output = join(root, '.artifacts', 'firebase-hosting.json')
      const dist = join(root, '.artifacts', 'update-site-dist')
      const config = await writeFirebaseDeployConfig({ baseConfigPath: base, outputPath: output, site: 'site', publicDir: dist })
      expect(isAbsolute(config.hosting.public)).toBe(true)
      expect(config.hosting.public).toBe(resolve(dist))
      // Firebase resolves public relative to the config file's directory; an absolute value is
      // interpreted identically no matter where the config lives.
      const written = JSON.parse(await readFile(output, 'utf8')).hosting.public
      expect(resolveConfigPublicDirectory(output, written)).toBe(resolve(dist))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves a relative config public path against the config directory, not the CWD', () => {
    const configPath = join('deep', 'nested', '.artifacts', 'firebase-hosting.json')
    expect(resolveConfigPublicDirectory(configPath, 'update-site-dist')).toBe(resolve('deep', 'nested', '.artifacts', 'update-site-dist'))
    const absolute = resolve('elsewhere', 'update-site-dist')
    expect(resolveConfigPublicDirectory(configPath, absolute)).toBe(absolute)
  })

  it('passes when the staged Hosting site is coherent with the generated config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const { dist, sourceManifestPath, configPath } = await stageDeployTree(root)
      const result = await assertDeployReady({ publicDir: dist, sourceManifestPath, configPath, log: () => {} })
      expect(result.publicDir).toBe(resolve(dist))
      expect(result.configPublic).toBe(resolve(dist))
      expect(result.installers.length).toBeGreaterThan(0)
      expect(result.signatures.length).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('normalizes a denormalized staging path and still matches the deploy config (Windows-safe)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const { dist, sourceManifestPath, configPath } = await stageDeployTree(root)
      const denormalized = join(dist, 'sub', '..')
      const result = await assertDeployReady({ publicDir: denormalized, sourceManifestPath, configPath, log: () => {} })
      expect(result.publicDir).toBe(resolve(dist))
      expect(result.configPublic).toBe(resolve(dist))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails before the Firebase CLI runs when the Hosting public directory is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const source = join(root, '.artifacts', 'update-site', 'preview')
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'latest.json'), JSON.stringify(manifest()))
      const base = join(root, 'firebase.json')
      await writeFile(base, JSON.stringify({ hosting: { public: 'update-site-dist' } }))
      const dist = join(root, '.artifacts', 'update-site-dist') // deliberately never created
      const configPath = join(root, '.artifacts', 'firebase-hosting.json')
      await writeFirebaseDeployConfig({ baseConfigPath: base, outputPath: configPath, site: 'site', publicDir: dist })
      await expect(assertDeployReady({ publicDir: dist, sourceManifestPath: join(source, 'latest.json'), configPath, log: () => {} })).rejects.toThrow(/does not exist/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a config whose public directory does not match the staged directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const { dist, base, sourceManifestPath, configPath } = await stageDeployTree(root, { generateConfig: false })
      await writeFirebaseDeployConfig({ baseConfigPath: base, outputPath: configPath, site: 'site', publicDir: join(root, 'a-different-directory') })
      await expect(assertDeployReady({ publicDir: dist, sourceManifestPath, configPath, log: () => {} })).rejects.toThrow(/does not match/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails when no signed payload or signature is staged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-firebase-'))
    try {
      const dist = join(root, '.artifacts', 'update-site-dist')
      await mkdir(join(dist, 'preview'), { recursive: true }) // preview dir exists but empty
      const source = join(root, '.artifacts', 'update-site', 'preview')
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'latest.json'), JSON.stringify(manifest()))
      const base = join(root, 'firebase.json')
      await writeFile(base, JSON.stringify({ hosting: { public: 'update-site-dist' } }))
      const configPath = join(root, '.artifacts', 'firebase-hosting.json')
      await writeFirebaseDeployConfig({ baseConfigPath: base, outputPath: configPath, site: 'site', publicDir: dist })
      await expect(assertDeployReady({ publicDir: dist, sourceManifestPath: join(source, 'latest.json'), configPath, log: () => {} })).rejects.toThrow(/installer payload|signature/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('idempotent internal release publication', () => {
  it('supersedes an existing internal prerelease tag instead of creating a duplicate', () => {
    expect(planReleasePublication({ existingTags: ['internal-v0.4.1-1006', 'internal-v0.4.1-1009'], tag: 'internal-v0.4.1-1009' }))
      .toEqual({ tag: 'internal-v0.4.1-1009', supersede: true })
  })

  it('creates a fresh internal prerelease when a strictly newer tag does not yet exist', () => {
    expect(planReleasePublication({ existingTags: ['internal-v0.4.1-1009'], tag: 'internal-v0.4.1-1010' }))
      .toEqual({ tag: 'internal-v0.4.1-1010', supersede: false })
  })

  it('requires a release tag', () => {
    expect(() => planReleasePublication({ existingTags: [], tag: '' })).toThrow('release tag is required')
  })
})

describe('release workflow wiring', () => {
  it('stages, generates config, asserts, deploys, and activates against one .artifacts staging root', async () => {
    const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'release-internal.yml'), 'utf8')
    const stagingReferences = workflow.match(/\.artifacts\/update-site-dist/g) || []
    expect(stagingReferences.length).toBeGreaterThanOrEqual(4)
    // The fail-fast readiness assertion must run before the first Firebase deploy.
    expect(workflow.indexOf('assert-deploy-ready')).toBeGreaterThan(-1)
    expect(workflow.indexOf('assert-deploy-ready')).toBeLessThan(workflow.indexOf('firebase deploy --only hosting'))
  })

  it('publishes the internal prerelease idempotently by superseding an existing tag', async () => {
    const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'release-internal.yml'), 'utf8')
    expect(workflow).toContain('gh release view $tag')
    expect(workflow).toContain('gh release delete $tag --yes --cleanup-tag')
  })
})
