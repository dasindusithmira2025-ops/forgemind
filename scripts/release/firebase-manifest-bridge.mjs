import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { validateManifest } from './verify-published-manifest.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const siblingEndpoint = (previewEndpoint, channel) => new URL(`/${channel}/latest.json`, previewEndpoint).toString()

async function readOptionalLiveManifest(endpoint, fetchImpl) {
  const response = await fetchImpl(endpoint, { redirect: 'follow', cache: 'no-store' })
  if (response.status === 404) return { status: 404, endpoint }
  if (response.status !== 200) {
    throw new Error(`existing bridge manifest ${endpoint} returned HTTP ${response.status}; refusing to replace the site`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: 200, endpoint, bytes, sha256: sha256(bytes) }
}

export function validateBridgeManifest(manifest, { expectedVersion, publicRepository }) {
  const problems = validateManifest(manifest, { expectedVersion, edition: 'preview' })
  const allowedPrefix = `https://github.com/${publicRepository}/releases/download/`
  for (const [platform, entry] of Object.entries(manifest?.platforms || {})) {
    if (entry?.url && !String(entry.url).startsWith(allowedPrefix)) {
      problems.push(`bridge platform "${platform}" does not reference the public artifact repository`)
    }
  }
  return problems
}

export async function stageFirebaseManifestBridge({
  manifestPath,
  bridgeEndpoint,
  destination,
  statePath,
  expectedVersion,
  publicRepository,
  fetchImpl = fetch,
}) {
  const manifestBytes = await readFile(manifestPath)
  let manifest
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'))
  } catch (error) {
    throw new Error(`bridge latest.json is malformed: ${error.message}`)
  }
  const problems = validateBridgeManifest(manifest, { expectedVersion, publicRepository })
  if (problems.length) throw new Error(problems.join('; '))

  const stable = await readOptionalLiveManifest(siblingEndpoint(bridgeEndpoint, 'stable'), fetchImpl)
  await rm(destination, { recursive: true, force: true })
  await mkdir(join(destination, 'preview'), { recursive: true })
  await writeFile(join(destination, 'preview', 'latest.json'), manifestBytes)
  if (stable.status === 200) {
    await mkdir(join(destination, 'stable'), { recursive: true })
    await writeFile(join(destination, 'stable', 'latest.json'), stable.bytes)
  }
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({ stable: { ...stable, bytes: undefined } }, null, 2)}\n`)
  return { manifest, stable }
}

async function listFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else files.push(path)
  }
  return files
}

export async function assertJsonOnlyBridge(directory) {
  const files = await listFiles(directory)
  if (files.length === 0) throw new Error('Firebase compatibility bridge is empty')
  const unexpected = files.filter((path) => basename(path) !== 'latest.json' || !path.endsWith('.json'))
  if (unexpected.length) {
    throw new Error(`Firebase compatibility bridge must contain JSON manifests only: ${unexpected.join(', ')}`)
  }
  return files
}

async function fetchArtifact(url, fetchImpl) {
  let response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' })
  if ([405, 501].includes(response.status) || !response.headers.get('content-length')) {
    response = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' })
  }
  if (![200, 206].includes(response.status)) throw new Error(`bridge artifact ${url} returned HTTP ${response.status}`)
}

export async function verifyFirebaseManifestBridge({
  bridgeEndpoint,
  expectedVersion,
  publicRepository,
  stable,
  fetchImpl = fetch,
  attempts = 5,
  delay = (attempt) => new Promise((resolve) => setTimeout(resolve, attempt * 2000)),
}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${bridgeEndpoint}?release=${encodeURIComponent(expectedVersion)}&attempt=${attempt}`, {
        redirect: 'follow',
        cache: 'no-store',
      })
      if (response.status !== 200) throw new Error(`Firebase Preview bridge returned HTTP ${response.status}`)
      const manifest = await response.json()
      const problems = validateBridgeManifest(manifest, { expectedVersion, publicRepository })
      if (problems.length) throw new Error(problems.join('; '))
      await fetchArtifact(manifest.platforms['windows-x86_64'].url, fetchImpl)

      const stableResponse = await fetchImpl(stable.endpoint, { redirect: 'follow', cache: 'no-store' })
      if (stable.status === 404 && stableResponse.status !== 404) {
        throw new Error(`Stable bridge changed from HTTP 404 to HTTP ${stableResponse.status}`)
      }
      if (stable.status === 200) {
        if (stableResponse.status !== 200) throw new Error(`Stable bridge changed from HTTP 200 to HTTP ${stableResponse.status}`)
        if (sha256(Buffer.from(await stableResponse.arrayBuffer())) !== stable.sha256) {
          throw new Error('Stable bridge manifest changed during Preview publication')
        }
      }
      return manifest
    } catch (error) {
      lastError = error
      if (attempt < attempts) await delay(attempt)
    }
  }
  throw new Error(`Firebase Preview bridge verification failed after ${attempts} attempts: ${lastError.message}`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'stage') {
    const [manifestPath, bridgeEndpoint, destination, statePath, expectedVersion, publicRepository] = args
    await stageFirebaseManifestBridge({ manifestPath, bridgeEndpoint, destination, statePath, expectedVersion, publicRepository })
    await assertJsonOnlyBridge(destination)
    return
  }
  if (command === 'assert-json-only') {
    await assertJsonOnlyBridge(args[0])
    return
  }
  if (command === 'verify') {
    const [bridgeEndpoint, expectedVersion, publicRepository, statePath] = args
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    await verifyFirebaseManifestBridge({ bridgeEndpoint, expectedVersion, publicRepository, stable: state.stable })
    return
  }
  throw new Error('usage: firebase-manifest-bridge <stage|assert-json-only|verify> ...')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
