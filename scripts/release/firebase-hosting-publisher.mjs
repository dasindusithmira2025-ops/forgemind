import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { comparePrecedence, validateManifest } from './verify-published-manifest.mjs'

export const FIREBASE_CLI_VERSION = '13.35.1'
export const FIREBASE_DEPLOYMENT_CONCURRENCY_GROUP = 'firebase-hosting-update-site'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const endpointFor = (previewEndpoint, path) => new URL(path, previewEndpoint).toString()

export function firebaseHostingConfig(baseConfig, site) {
  if (!site || !String(site).trim()) throw new Error('FIREBASE_HOSTING_SITE is required')
  const config = structuredClone(baseConfig)
  if (!config.hosting || Array.isArray(config.hosting)) throw new Error('firebase.json must define one hosting object')
  config.hosting.site = String(site).trim()
  return config
}

export function firebaseDeployInvocation({ projectId, configPath }) {
  if (!projectId || !configPath) throw new Error('Firebase project and generated config are required')
  return ['firebase', 'deploy', '--only', 'hosting', '--project', projectId, '--config', configPath, '--non-interactive']
}

export function assertDeploySucceeded(exitCode) {
  if (exitCode !== 0) throw new Error(`Firebase Hosting deployment failed with exit code ${exitCode}`)
}

async function preserveLiveManifest(endpoint, label, fetchImpl) {
  const response = await fetchImpl(endpoint, { redirect: 'follow' })
  if (response.status === 404) return { status: 404, endpoint, bytes: null }
  if (response.status !== 200) throw new Error(`${label} manifest ${endpoint} returned HTTP ${response.status}; refusing to deploy without preserving it`)
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: 200, endpoint, sha256: sha256(bytes), bytes }
}

export async function stageFirebaseHostingSite({ previewSourceDirectory, previewEndpoint, destination, statePath, fetchImpl = fetch }) {
  const stable = await preserveLiveManifest(endpointFor(previewEndpoint, '/stable/latest.json'), 'Stable', fetchImpl)
  const previousPreview = await preserveLiveManifest(previewEndpoint, 'Preview', fetchImpl)

  await rm(destination, { recursive: true, force: true })
  await cp(previewSourceDirectory, join(destination, 'preview'), {
    recursive: true,
    filter: (source) => basename(source) !== 'latest.json',
  })
  if (previousPreview.status === 200) await writeFile(join(destination, 'preview', 'latest.json'), previousPreview.bytes)
  if (stable.status === 200) {
    await mkdir(join(destination, 'stable'), { recursive: true })
    await writeFile(join(destination, 'stable', 'latest.json'), stable.bytes)
  }
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({ stable: { ...stable, bytes: undefined }, previousPreview: { ...previousPreview, bytes: undefined } }, null, 2)}\n`)
  return { stable, previousPreview }
}

export async function activatePreviewManifest({ previewManifestPath, destination }) {
  await mkdir(join(destination, 'preview'), { recursive: true })
  await writeFile(join(destination, 'preview', 'latest.json'), await readFile(previewManifestPath))
}

export async function writeFirebaseDeployConfig({ baseConfigPath, outputPath, site }) {
  const base = JSON.parse(await readFile(baseConfigPath, 'utf8'))
  const config = firebaseHostingConfig(base, site)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`)
  return config
}

async function fetchArtifact(url, fetchImpl) {
  let response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' })
  if ([405, 501].includes(response.status) || !response.headers.get('content-length')) {
    response = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' })
  }
  if (![200, 206].includes(response.status)) throw new Error(`updater artifact ${url} returned HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') || response.headers.get('content-range')?.split('/').pop())
  if (!Number.isFinite(length) || length <= 0) throw new Error(`updater artifact ${url} has no plausible non-zero size`)
}

export async function verifyReleaseArtifacts({ manifestPath, expectedVersion, fetchImpl = fetch }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const errors = validateManifest(manifest, { expectedVersion, edition: 'preview' })
  if (!String(manifest.notes || '').trim()) errors.push('manifest release notes are missing')
  if (errors.length) throw new Error(errors.join('; '))
  await fetchArtifact(manifest.platforms['windows-x86_64'].url, fetchImpl)
  return manifest
}

export async function verifyFirebaseDeployment({ previewEndpoint, expectedVersion, previousVersion = '0.4.1-1001', stable, fetchImpl = fetch, attempts = 4, delay = async () => {} }) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const preview = await fetchImpl(previewEndpoint, { redirect: 'follow' })
      if (preview.status !== 200) throw new Error(`Published preview manifest ${previewEndpoint} returned HTTP ${preview.status}, expected 200`)
      const contentType = preview.headers.get('content-type') || ''
      if (!/^application\/json(?:;|$)/i.test(contentType)) throw new Error(`Published preview manifest has unexpected content type ${contentType || '(missing)'}`)
      const text = await preview.text()
      if (/^\s*<!doctype html|^\s*<html/i.test(text)) throw new Error('Published preview manifest returned HTML instead of JSON')
      const manifest = JSON.parse(text)
      const errors = validateManifest(manifest, { expectedVersion, edition: 'preview', previousVersion })
      if (!String(manifest.notes || '').trim()) errors.push('manifest release notes are missing')
      if (errors.length) throw new Error(errors.join('; '))
      await fetchArtifact(manifest.platforms['windows-x86_64'].url, fetchImpl)

      const stableResponse = await fetchImpl(stable.endpoint, { redirect: 'follow' })
      if (stable.status === 404 && stableResponse.status !== 404) throw new Error(`Stable manifest changed from HTTP 404 to HTTP ${stableResponse.status}`)
      if (stable.status === 200) {
        if (stableResponse.status !== 200) throw new Error(`Stable manifest changed from HTTP 200 to HTTP ${stableResponse.status}`)
        const stableBytes = Buffer.from(await stableResponse.arrayBuffer())
        if (sha256(stableBytes) !== stable.sha256) throw new Error('Stable manifest hash changed during Preview deployment')
      }
      return manifest
    } catch (error) {
      lastError = error
      if (attempt < attempts) await delay(attempt)
    }
  }
  throw new Error(`Firebase Hosting verification failed after ${attempts} attempts: ${lastError.message}`)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'stage') {
    const [previewSourceDirectory, previewEndpoint, destination, statePath] = args
    await stageFirebaseHostingSite({ previewSourceDirectory, previewEndpoint, destination, statePath })
    return
  }
  if (command === 'activate') {
    const [previewManifestPath, destination] = args
    await activatePreviewManifest({ previewManifestPath, destination })
    return
  }
  if (command === 'config') {
    const [site, baseConfigPath, outputPath] = args
    await writeFirebaseDeployConfig({ site, baseConfigPath, outputPath })
    return
  }
  if (command === 'version') {
    const [version, installedVersion] = args
    if (comparePrecedence(version, installedVersion) <= 0) throw new Error(`Generated version ${version} is not newer than installed Preview ${installedVersion}`)
    return
  }
  if (command === 'verify-artifacts') {
    const [manifestPath, expectedVersion] = args
    await verifyReleaseArtifacts({ manifestPath, expectedVersion })
    return
  }
  if (command === 'verify') {
    const [previewEndpoint, expectedVersion, statePath] = args
    const { stable } = JSON.parse(await readFile(statePath, 'utf8'))
    await verifyFirebaseDeployment({ previewEndpoint, expectedVersion, stable, attempts: Number(process.env.FIREBASE_DEPLOY_VERIFY_ATTEMPTS || 4), delay: () => new Promise((resolve) => setTimeout(resolve, Number(process.env.FIREBASE_DEPLOY_VERIFY_DELAY_MS || 3000))) })
    return
  }
  throw new Error('usage: firebase-hosting-publisher <stage|activate|config|version|verify-artifacts|verify> ...')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
