import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertJsonOnlyBridge,
  stageFirebaseManifestBridge,
  validateBridgeManifest,
  verifyFirebaseManifestBridge,
} from './firebase-manifest-bridge.mjs'

const repository = 'dasindusithmira2025-ops/paralith-updates'
const endpoint = 'https://corelith-paralith-updates.web.app/preview/latest.json'
const stableEndpoint = 'https://corelith-paralith-updates.web.app/stable/latest.json'
const version = '0.4.1-1024'
const asset = `https://github.com/${repository}/releases/download/internal-v${version}/PARALITH.exe`
const manifest = {
  version,
  notes: 'Migrated Preview release',
  platforms: {
    'windows-x86_64': { url: asset, signature: 'sig' },
    'windows-x86_64-nsis': { url: asset, signature: 'sig' },
    'windows-x86_64-msi': { url: `${asset}.msi`, signature: 'sig' },
  },
  paralith: { edition: 'preview', channel: 'preview', schemaVersion: 22 },
}

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json', 'content-length': '100' },
})

describe('JSON-only Firebase compatibility bridge', () => {
  it('stages only the Preview manifest and preserves an existing Stable manifest byte-for-byte', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-bridge-'))
    try {
      const source = join(root, 'latest.json')
      const destination = join(root, 'site')
      const stableBytes = Buffer.from('{"stable":"preserved"}\n')
      await writeFile(source, JSON.stringify(manifest))
      const result = await stageFirebaseManifestBridge({
        manifestPath: source,
        bridgeEndpoint: endpoint,
        destination,
        statePath: join(root, 'state.json'),
        expectedVersion: version,
        publicRepository: repository,
        fetchImpl: async (url) => url === stableEndpoint
          ? new Response(stableBytes, { status: 200 })
          : new Response('', { status: 404 }),
      })
      expect(await assertJsonOnlyBridge(destination)).toHaveLength(2)
      expect(await readFile(join(destination, 'preview', 'latest.json'), 'utf8')).toContain(version)
      expect(await readFile(join(destination, 'stable', 'latest.json'))).toEqual(stableBytes)
      expect(result.stable.sha256).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects executable payloads from the Firebase bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paralith-bridge-'))
    try {
      await mkdir(join(root, 'preview'), { recursive: true })
      await writeFile(join(root, 'preview', 'latest.json'), '{}')
      await writeFile(join(root, 'preview', 'PARALITH.exe'), 'payload')
      await expect(assertJsonOnlyBridge(root)).rejects.toThrow('JSON manifests only')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects malformed, wrong-channel, or non-public-repository manifests', () => {
    expect(validateBridgeManifest({ ...manifest, platforms: undefined }, { expectedVersion: version, publicRepository: repository })).toEqual(expect.arrayContaining([
      'manifest.platforms is missing',
    ]))
    expect(validateBridgeManifest({
      ...manifest,
      paralith: { edition: 'stable', channel: 'stable' },
      platforms: {
        ...manifest.platforms,
        'windows-x86_64': { url: 'https://firebase.example/PARALITH.exe', signature: 'sig' },
      },
    }, { expectedVersion: version, publicRepository: repository })).toEqual(expect.arrayContaining([
      expect.stringContaining('channel'),
      expect.stringContaining('public artifact repository'),
    ]))
  })

  it('anonymously verifies the bridge, public payload, and Stable preservation', async () => {
    const stableBytes = Buffer.from('{"stable":"preserved"}')
    const { createHash } = await import('node:crypto')
    const stable = { status: 200, endpoint: stableEndpoint, sha256: createHash('sha256').update(stableBytes).digest('hex') }
    const verified = await verifyFirebaseManifestBridge({
      bridgeEndpoint: endpoint,
      expectedVersion: version,
      publicRepository: repository,
      stable,
      attempts: 1,
      fetchImpl: async (url, options = {}) => {
        if (String(url).startsWith(endpoint)) return jsonResponse(manifest)
        if (url === stableEndpoint) return new Response(stableBytes, { status: 200 })
        if (options.method === 'HEAD') return new Response('', { status: 200, headers: { 'content-length': '1024' } })
        throw new Error(`unexpected ${url}`)
      },
    })
    expect(verified.version).toBe(version)
  })
})
