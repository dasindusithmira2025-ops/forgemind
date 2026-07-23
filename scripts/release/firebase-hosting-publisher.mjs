import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { comparePrecedence, validateManifest } from './verify-published-manifest.mjs'

export const FIREBASE_CLI_VERSION = '13.35.1'
export const FIREBASE_DEPLOYMENT_CONCURRENCY_GROUP = 'firebase-hosting-update-site'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const endpointFor = (previewEndpoint, path) => new URL(path, previewEndpoint).toString()

// firebase-tools resolves `hosting.public` as path.join(<config file's directory>, public) — it is
// ALWAYS relative to the --config file's directory, never the process CWD, and (because it uses
// path.join, not path.resolve) it CANNOT accept an absolute public value: an absolute path is
// concatenated onto the config directory into a nonexistent path. So the generated config must keep
// `public` as a plain relative path whose join against the config directory lands exactly on the
// staged Hosting directory. `publicDir` (the staged directory) is optional so the base
// `firebase.json` transform stays inspectable in isolation; when supplied together with the config
// output path we derive the correct relative value below.
export function firebaseHostingConfig(baseConfig, site, publicPath) {
  if (!site || !String(site).trim()) throw new Error('FIREBASE_HOSTING_SITE is required')
  const config = structuredClone(baseConfig)
  if (!config.hosting || Array.isArray(config.hosting)) throw new Error('firebase.json must define one hosting object')
  config.hosting.site = String(site).trim()
  if (publicPath && String(publicPath).trim()) config.hosting.public = String(publicPath).trim()
  return config
}

/**
 * Relative `public` value that firebase-tools will join back onto the staged directory. Uses forward
 * slashes (firebase config convention) and refuses a directory that escapes the config directory,
 * because firebase itself rejects a `public` outside the project directory.
 */
export function relativePublicForConfig(outputPath, publicDir) {
  const configDir = dirname(resolve(outputPath))
  const relativePath = relative(configDir, resolve(publicDir))
  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error(`Hosting public directory ${resolve(publicDir)} must live inside the deploy config directory ${configDir}`)
  }
  return relativePath.split(sep).join('/')
}

/**
 * Mirror of firebase-tools' own resolution (path.join of the config file's directory and the raw
 * `public` value) so the pre-deploy assertion validates the SAME path the Firebase CLI will read,
 * and never diverges by (for example) treating an absolute value as resolvable when firebase can't.
 */
export function resolveConfigPublicDirectory(configPath, publicValue) {
  return normalize(join(dirname(resolve(configPath)), String(publicValue)))
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

export async function writeFirebaseDeployConfig({ baseConfigPath, outputPath, site, publicDir }) {
  const base = JSON.parse(await readFile(baseConfigPath, 'utf8'))
  const publicPath = publicDir ? relativePublicForConfig(outputPath, publicDir) : undefined
  const config = firebaseHostingConfig(base, site, publicPath)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`)
  return config
}

async function listFilesRecursively(directory) {
  const found = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await listFilesRecursively(full)))
    else found.push(full)
  }
  return found
}

/**
 * Fail-fast gate that must run immediately before `firebase deploy`. It proves the staged Hosting
 * site is coherent with the generated config so a path/staging defect surfaces here — with safe,
 * greppable diagnostics — instead of deep inside the Firebase CLI. It never logs credentials,
 * signatures, tokens, or service-account data: only the normalized directory, filenames, sizes,
 * manifest presence, and config path.
 */
export async function assertDeployReady({ publicDir, sourceManifestPath, configPath, log = console.log }) {
  const errors = []
  const resolvedPublic = resolve(publicDir)

  const publicStat = await stat(resolvedPublic).catch(() => null)
  if (!publicStat?.isDirectory()) errors.push(`Hosting public directory does not exist: ${resolvedPublic}`)

  const previewDir = join(resolvedPublic, 'preview')
  const previewStat = await stat(previewDir).catch(() => null)
  if (!previewStat?.isDirectory()) errors.push(`Preview payload directory does not exist: ${previewDir}`)

  const files = previewStat?.isDirectory() ? await listFilesRecursively(previewDir) : []
  const installers = files.filter((file) => file.endsWith('.msi') || file.endsWith('-setup.exe'))
  const signatures = files.filter((file) => file.endsWith('.sig'))
  if (installers.length === 0) errors.push('No signed installer payload (.msi / -setup.exe) is staged under preview/')
  if (signatures.length === 0) errors.push('No updater signature (.sig) is staged under preview/')

  const manifestStat = await stat(sourceManifestPath).catch(() => null)
  if (!manifestStat?.isFile()) errors.push(`Preview manifest staging state is missing: ${resolve(sourceManifestPath)}`)

  let configPublic = null
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    const publicValue = config?.hosting?.public
    if (!publicValue) errors.push(`Firebase config has no hosting.public: ${resolve(configPath)}`)
    else {
      configPublic = resolveConfigPublicDirectory(configPath, publicValue)
      if (configPublic !== resolvedPublic) {
        errors.push(`Firebase config public directory (${configPublic}) does not match the staged Hosting directory (${resolvedPublic})`)
      }
    }
  } catch (error) {
    errors.push(`Firebase config could not be read: ${resolve(configPath)} (${error.message})`)
  }

  log(`[assert-deploy-ready] hosting public dir: ${resolvedPublic} (${publicStat?.isDirectory() ? 'present' : 'MISSING'})`)
  log(`[assert-deploy-ready] firebase config: ${resolve(configPath)} -> public ${configPublic ?? '(unresolved)'}`)
  log(`[assert-deploy-ready] preview manifest staging state: ${manifestStat?.isFile() ? 'present' : 'MISSING'} (${resolve(sourceManifestPath)})`)
  log(`[assert-deploy-ready] staged payload files: ${files.length} (installers=${installers.length}, signatures=${signatures.length})`)
  for (const file of files) {
    const fileStat = await stat(file).catch(() => null)
    log(`  - ${file.slice(resolvedPublic.length + 1)}  ${fileStat ? fileStat.size : '?'} bytes`)
  }

  if (errors.length) throw new Error(`Firebase deploy preflight failed before the Firebase CLI ran:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
  return { publicDir: resolvedPublic, configPublic, installers, signatures, files }
}

/**
 * Idempotent internal-release publication plan. A re-run of the same commit reuses the same unique
 * internal version (and therefore the same tag), so blindly creating the release would fail on a
 * duplicate tag. When the tag already exists we supersede the prior — undiscoverable — prerelease
 * instead of creating a duplicate. Only ever applies to internal prereleases; Stable is untouched.
 */
export function planReleasePublication({ existingTags, tag }) {
  if (!tag || !String(tag).trim()) throw new Error('release tag is required')
  const normalized = String(tag).trim()
  return { tag: normalized, supersede: (existingTags || []).map(String).includes(normalized) }
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
    const [site, baseConfigPath, outputPath, publicDir] = args
    await writeFirebaseDeployConfig({ site, baseConfigPath, outputPath, publicDir })
    return
  }
  if (command === 'assert-deploy-ready') {
    const [publicDir, sourceManifestPath, configPath] = args
    await assertDeployReady({ publicDir, sourceManifestPath, configPath })
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
  throw new Error('usage: firebase-hosting-publisher <stage|activate|config|assert-deploy-ready|version|verify-artifacts|verify> ...')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
