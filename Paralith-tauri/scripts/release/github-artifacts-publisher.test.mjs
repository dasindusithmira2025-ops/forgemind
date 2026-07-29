import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PUBLICATION_CONCURRENCY_GROUP,
  channelManifestUrl,
  githubReleaseAssetName,
  publishPreparedRelease,
  releaseAssetBaseUrl,
  stagePublicationHandoff,
  validateGithubManifest,
  validatePublicArtifactNames,
  verifyAnonymousPublication,
} from './github-artifacts-publisher.mjs'
import { invalidPublishConfiguration, missingPublishKeys } from './preflight-publish.mjs'

const repository = 'dasindusithmira2025-ops/paralith-updates'
const tag = 'internal-v0.4.1-1024'
const version = '0.4.1-1024'
const base = releaseAssetBaseUrl(repository, tag)
const repositoryRoot = resolve(process.cwd(), '..')

function manifest(overrides = {}) {
  return {
    version,
    notes: 'Signed one-click updates',
    pub_date: '2026-07-28T00:00:00Z',
    platforms: {
      'windows-x86_64': { url: `${base}/PARALITH.Preview_${version}_x64-setup.exe`, signature: 'sig' },
      'windows-x86_64-nsis': { url: `${base}/PARALITH.Preview_${version}_x64-setup.exe`, signature: 'sig' },
      'windows-x86_64-msi': { url: `${base}/PARALITH.Preview_${version}_x64_en-US.msi`, signature: 'sig' },
    },
    paralith: { edition: 'preview', channel: 'preview', schemaVersion: 22 },
    ...overrides,
  }
}

const artifacts = [
  { name: `PARALITH.Preview_${version}_x64-setup.exe`, bytes: Buffer.from('exe') },
  { name: `PARALITH.Preview_${version}_x64-setup.exe.sig`, bytes: Buffer.from('sig') },
  { name: `PARALITH.Preview_${version}_x64_en-US.msi`, bytes: Buffer.from('msi') },
  { name: `PARALITH.Preview_${version}_x64_en-US.msi.sig`, bytes: Buffer.from('sig') },
  { name: 'checksums.sha256', bytes: Buffer.from('checksums') },
  { name: 'release-manifest.json', bytes: Buffer.from('{}') },
  { name: 'release-notes.md', bytes: Buffer.from('# Notes') },
]

function fakeClient({ current, uploadFailure, activationFailure } = {}) {
  const calls = []
  const client = {
    calls,
    assertPublicRepository: vi.fn(async () => calls.push('public')),
    getChannelManifest: vi.fn(async (channel) => { calls.push(`read:${channel}`); return current || null }),
    getRelease: vi.fn(async () => { calls.push('release:get'); return null }),
    deleteDraftRelease: vi.fn(),
    createDraftRelease: vi.fn(async () => { calls.push('release:draft'); return { id: 1, upload_url: 'upload' } }),
    uploadAsset: vi.fn(async (_release, artifact) => {
      calls.push(`upload:${artifact.name}`)
      if (uploadFailure && artifact.name === uploadFailure) throw new Error('upload failed')
    }),
    publishRelease: vi.fn(async (release) => { calls.push('release:publish'); return { ...release, draft: false } }),
    assertPublishedReleaseMatches: vi.fn(),
    verifyAnonymousArtifacts: vi.fn(async () => calls.push('verify:artifacts')),
    activateChannelManifest: vi.fn(async ({ channel, currentSha }) => {
      calls.push(`activate:${channel}:${currentSha || 'new'}`)
      if (activationFailure) throw new Error('channel activation rejected a stale manifest SHA')
    }),
    verifyAnonymousManifest: vi.fn(async () => calls.push('verify:manifest')),
  }
  return client
}

async function publish(client, next = manifest()) {
  return publishPreparedRelease({
    client,
    repository,
    tag,
    channel: 'preview',
    version,
    artifacts,
    manifestBytes: Buffer.from(JSON.stringify(next)),
    releaseNotes: '# Notes',
    title: `PARALITH Preview ${version}`,
    prerelease: true,
  })
}

describe('public update repository contract', () => {
  it('accepts either scoped API publication or a repository deploy key', () => {
    const env = {
      TAURI_SIGNING_PRIVATE_KEY: 'signing-key',
      PARALITH_PREVIEW_UPDATE_ENDPOINT: channelManifestUrl(repository, 'preview'),
      PARALITH_PREVIEW_BRIDGE_ENDPOINT: 'https://corelith-paralith-updates.web.app/preview/latest.json',
      PARALITH_UPDATE_PUBLISH_PROVIDER: 'github-artifacts',
      PARALITH_UPDATES_REPOSITORY: repository,
      PARALITH_UPDATES_TOKEN: 'fine-grained-token',
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_HOSTING_SITE: 'site',
      GITHUB_REPOSITORY: 'owner/private-source',
      PARALITH_INTERNAL_BUILD_NUMBER: '1024',
      GCP_WORKLOAD_IDENTITY_PROVIDER: 'provider',
      GCP_SERVICE_ACCOUNT: 'account',
    }
    expect(missingPublishKeys(env)).toEqual([])
    expect(invalidPublishConfiguration(env, { version: '0.4.1-1001', schemaVersion: 22 })).toEqual([])
    expect(missingPublishKeys({ ...env, PARALITH_UPDATES_TOKEN: '', PARALITH_UPDATES_DEPLOY_KEY: 'key' })).toEqual([])
    expect(missingPublishKeys({ ...env, PARALITH_UPDATES_TOKEN: '', PARALITH_UPDATES_DEPLOY_KEY: '' }))
      .toContain('PARALITH_UPDATES_TOKEN or PARALITH_UPDATES_DEPLOY_KEY')
  })

  it('builds public release and channel URLs without exposing the source repository', () => {
    expect(base).toBe(`https://github.com/${repository}/releases/download/${tag}`)
    expect(channelManifestUrl(repository, 'preview')).toBe(`https://raw.githubusercontent.com/${repository}/main/channels/preview/latest.json`)
  })

  it('canonicalizes filenames exactly as GitHub Release asset storage does', () => {
    expect(githubReleaseAssetName(`PARALITH Preview_${version}_x64-setup.exe`))
      .toBe(`PARALITH.Preview_${version}_x64-setup.exe`)
    expect(validatePublicArtifactNames(artifacts.map((artifact) => artifact.name))).toEqual([])
    expect(validatePublicArtifactNames([
      ...artifacts.map((artifact) => artifact.name),
      `PARALITH Preview_${version}_x64-setup.exe`,
    ])).toContainEqual(expect.stringContaining('canonical GitHub Release filename'))
  })

  it('serializes Preview and Stable manifest publication through the shared workflow lock', async () => {
    expect(PUBLICATION_CONCURRENCY_GROUP).toBe('paralith-update-publication')
    for (const workflow of ['release-internal.yml', 'release-windows.yml']) {
      expect(await readFile(join(repositoryRoot, '.github', 'workflows', workflow), 'utf8'))
        .toContain(`group: ${PUBLICATION_CONCURRENCY_GROUP}`)
    }
  })

  it('writes the deploy key as LF UTF-8 without a BOM and restores cleanup access', async () => {
    const script = await readFile(join(process.cwd(), 'scripts', 'release', 'push-publication-handoff.ps1'), 'utf8')
    expect(script).toContain('-replace "`r`n", "`n"')
    expect(script).toContain('[System.Text.UTF8Encoding]::new($false)')
    expect(script).toContain('"${account}:(F)"')
  })

  it('rejects databases, credentials, nested files, and missing signed installers', () => {
    expect(validatePublicArtifactNames(['state.db', '../secret.json', 'credentials.txt'])).toEqual(expect.arrayContaining([
      expect.stringContaining('not permitted'),
      expect.stringContaining('flat filename'),
      expect.stringContaining('MSI artifact'),
      expect.stringContaining('NSIS artifact'),
    ]))
  })

  it('rejects malformed channel identity and private-repository asset URLs', () => {
    const wrong = manifest({
      platforms: {
        ...manifest().platforms,
        'windows-x86_64': { url: 'https://github.com/private/source/releases/download/tag/app.exe', signature: 'sig' },
      },
      paralith: { edition: 'stable', channel: 'stable', schemaVersion: 22 },
    })
    expect(validateGithubManifest(wrong, { repository, tag, channel: 'preview', version })).toEqual(expect.arrayContaining([
      expect.stringContaining('channel'),
      expect.stringContaining('edition'),
      expect.stringContaining('does not reference release'),
    ]))
  })

  it('stages only a validated public release handoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-handoff-'))
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    await mkdir(source)
    for (const artifact of [...artifacts, { name: 'latest.json', bytes: Buffer.from(JSON.stringify(manifest())) }]) {
      await writeFile(join(source, artifact.name), artifact.bytes)
    }
    const request = await stagePublicationHandoff({
      repository,
      tag,
      channel: 'preview',
      version,
      sourceDirectory: source,
      destinationDirectory: destination,
    })
    expect(request).toMatchObject({ schemaVersion: 1, repository, tag, channel: 'preview', version, prerelease: true })
    expect(request.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(await readFile(join(destination, 'request.json'), 'utf8'))).toEqual(request)
  })

  it('waits for and anonymously verifies the public handoff result', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(manifest()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('', {
        status: 200,
        headers: { 'content-length': '100' },
      }))
    await expect(verifyAnonymousPublication({
      repository,
      channel: 'preview',
      version,
      fetchImpl,
      attempts: 2,
      delay: vi.fn(),
    })).resolves.toMatchObject({ version })
  })
})

describe('GitHub artifact publication ordering', () => {
  it('uploads and anonymously verifies payloads before optimistic manifest activation', async () => {
    const client = fakeClient({
      current: { sha: 'current-sha', manifest: { ...manifest(), version: '0.4.1-1023' } },
    })
    await publish(client)
    expect(client.calls.indexOf('verify:artifacts')).toBeLessThan(client.calls.indexOf('activate:preview:current-sha'))
    expect(client.calls.at(-1)).toBe('verify:manifest')
    expect(client.getChannelManifest).toHaveBeenCalledWith('preview')
    expect(client.getChannelManifest).not.toHaveBeenCalledWith('stable')
  })

  it('does not activate a manifest after a failed upload', async () => {
    const client = fakeClient({ uploadFailure: 'checksums.sha256' })
    await expect(publish(client)).rejects.toThrow('upload failed')
    expect(client.activateChannelManifest).not.toHaveBeenCalled()
    expect(client.verifyAnonymousArtifacts).not.toHaveBeenCalled()
  })

  it('surfaces optimistic activation conflicts instead of overwriting a concurrent release', async () => {
    const client = fakeClient({
      current: { sha: 'stale-sha', manifest: { ...manifest(), version: '0.4.1-1023' } },
      activationFailure: true,
    })
    await expect(publish(client)).rejects.toThrow('stale manifest SHA')
    expect(client.verifyAnonymousManifest).not.toHaveBeenCalled()
  })

  it('refuses a wrong edition or non-advancing channel version before creating a draft', async () => {
    const wrongEditionClient = fakeClient()
    await expect(publish(wrongEditionClient, manifest({
      paralith: { edition: 'stable', channel: 'stable', schemaVersion: 22 },
    }))).rejects.toThrow(/channel|edition/)
    expect(wrongEditionClient.createDraftRelease).not.toHaveBeenCalled()

    const downgradeClient = fakeClient({
      current: { sha: 'sha', manifest: { ...manifest(), version: '0.4.1-1025' } },
    })
    await expect(publish(downgradeClient)).rejects.toThrow('non-advancing')
    expect(downgradeClient.createDraftRelease).not.toHaveBeenCalled()
  })
})
