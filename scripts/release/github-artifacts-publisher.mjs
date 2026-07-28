import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { comparePrecedence, validateManifest } from './verify-published-manifest.mjs'

const API_VERSION = '2022-11-28'
const PUBLIC_METADATA = new Set([
  'build-metadata.json',
  'checksums.sha256',
  'database-schema.json',
  'latest.json',
  'release-manifest.json',
  'release-notes.md',
])

export const PUBLICATION_CONCURRENCY_GROUP = 'paralith-update-publication'

export function releaseAssetBaseUrl(repository, tag) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`
}

export function channelManifestUrl(repository, channel, branch = 'main') {
  return `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/channels/${channel}/latest.json`
}

export function validatePublicArtifactNames(names) {
  const problems = []
  const unique = new Set()
  const installers = names.filter((name) => name.startsWith('PARALITH') && (name.endsWith('.msi') || name.endsWith('-setup.exe')))
  for (const name of names) {
    if (name !== basename(name) || name.includes('/') || name.includes('\\')) {
      problems.push(`artifact "${name}" is not a flat filename`)
      continue
    }
    if (unique.has(name)) problems.push(`artifact "${name}" is duplicated`)
    unique.add(name)
    const allowed = PUBLIC_METADATA.has(name)
      || installers.includes(name)
      || (name.endsWith('.sig') && installers.includes(name.slice(0, -4)))
    if (!allowed) problems.push(`artifact "${name}" is not permitted in the public update repository`)
  }
  for (const required of ['checksums.sha256', 'release-notes.md', 'release-manifest.json']) {
    if (!unique.has(required)) problems.push(`required public artifact "${required}" is missing`)
  }
  if (installers.filter((name) => name.endsWith('.msi')).length !== 1) problems.push('exactly one signed PARALITH MSI artifact is required')
  if (installers.filter((name) => name.endsWith('-setup.exe')).length !== 1) problems.push('exactly one signed PARALITH NSIS artifact is required')
  for (const installer of installers) {
    if (!unique.has(`${installer}.sig`)) problems.push(`updater signature for "${installer}" is missing`)
  }
  return problems
}

export function validateGithubManifest(manifest, { repository, tag, channel, version }) {
  const problems = validateManifest(manifest, { expectedVersion: version, edition: channel })
  if (manifest?.paralith?.edition !== channel) {
    problems.push(`manifest edition "${manifest?.paralith?.edition}" is not "${channel}"`)
  }
  if (!String(manifest?.notes || '').trim()) problems.push('manifest release notes are missing')
  const base = `${releaseAssetBaseUrl(repository, tag)}/`
  for (const [platform, entry] of Object.entries(manifest?.platforms || {})) {
    if (entry?.url && !String(entry.url).startsWith(base)) {
      problems.push(`manifest platform "${platform}" does not reference release ${tag} in ${repository}`)
    }
  }
  return problems
}

export function assertVersionAdvances(currentManifest, nextManifest) {
  if (!currentManifest?.version) return
  if (comparePrecedence(nextManifest.version, currentManifest.version) <= 0) {
    throw new Error(`refusing to replace ${currentManifest.version} with non-advancing ${nextManifest.version}`)
  }
}

export async function stagePublicationHandoff({
  repository,
  tag,
  channel,
  version,
  sourceDirectory,
  destinationDirectory,
}) {
  const artifacts = await loadArtifacts(sourceDirectory)
  const problems = validatePublicArtifactNames(artifacts.map((artifact) => artifact.name))
  if (problems.length) throw new Error(problems.join('; '))

  const manifestArtifact = artifacts.find((artifact) => artifact.name === 'latest.json')
  if (!manifestArtifact) throw new Error('latest.json is required for publication handoff')
  let manifest
  try {
    manifest = JSON.parse(manifestArtifact.bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`latest.json is malformed: ${error.message}`)
  }
  const manifestProblems = validateGithubManifest(manifest, { repository, tag, channel, version })
  if (manifestProblems.length) throw new Error(manifestProblems.join('; '))

  await mkdir(destinationDirectory, { recursive: true })
  for (const artifact of artifacts) {
    await copyFile(join(sourceDirectory, artifact.name), join(destinationDirectory, artifact.name))
  }
  const request = {
    schemaVersion: 1,
    repository,
    tag,
    channel,
    version,
    title: `PARALITH ${channel === 'stable' ? 'Stable' : 'Preview'} ${version}`,
    prerelease: channel === 'preview',
    manifestSha256: createHash('sha256').update(manifestArtifact.bytes).digest('hex'),
  }
  await writeFile(join(destinationDirectory, 'request.json'), `${JSON.stringify(request, null, 2)}\n`)
  return request
}

export async function verifyAnonymousPublication({
  repository,
  channel,
  version,
  fetchImpl = fetch,
  attempts = 60,
  delay = () => new Promise((resolve) => setTimeout(resolve, 10_000)),
}) {
  const endpoint = channelManifestUrl(repository, channel)
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${endpoint}?release=${encodeURIComponent(version)}&attempt=${attempt}`, {
        redirect: 'follow',
        cache: 'no-store',
      })
      await requireResponse(response, [200], 'anonymous channel manifest verification')
      const manifest = await response.json()
      const problems = validateManifest(manifest, { expectedVersion: version, edition: channel })
      if (problems.length) throw new Error(problems.join('; '))
      await fetchArtifact(manifest.platforms['windows-x86_64'].url, fetchImpl)
      return manifest
    } catch (error) {
      lastError = error
      if (attempt < attempts) await delay(attempt)
    }
  }
  throw new Error(`anonymous ${channel} verification failed after ${attempts} attempts: ${lastError.message}`)
}

export async function publishPreparedRelease({
  client,
  repository,
  tag,
  channel,
  version,
  artifacts,
  manifestBytes,
  releaseNotes,
  title,
  prerelease,
}) {
  await client.assertPublicRepository()
  const names = artifacts.map((artifact) => artifact.name)
  const artifactProblems = validatePublicArtifactNames(names)
  if (artifactProblems.length) throw new Error(artifactProblems.join('; '))

  let manifest
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'))
  } catch (error) {
    throw new Error(`latest.json is malformed: ${error.message}`)
  }
  const manifestProblems = validateGithubManifest(manifest, { repository, tag, channel, version })
  if (manifestProblems.length) throw new Error(manifestProblems.join('; '))

  // Capture the exact current blob SHA before uploading. The final Contents API write includes this
  // SHA, so a concurrent publication cannot silently replace a newer channel manifest.
  const current = await client.getChannelManifest(channel)
  assertVersionAdvances(current?.manifest, manifest)

  let release = await client.getRelease(tag)
  if (release?.draft) {
    await client.deleteDraftRelease(release)
    release = null
  }
  if (!release) {
    release = await client.createDraftRelease({ tag, title, releaseNotes, prerelease })
    for (const artifact of artifacts) {
      await client.uploadAsset(release, artifact)
    }
    release = await client.publishRelease(release)
  } else {
    await client.assertPublishedReleaseMatches(release, artifacts)
  }

  // Payload reachability is proved before the discoverable manifest changes. A failed upload or
  // private/inaccessible release therefore leaves the previous channel active.
  await client.verifyAnonymousArtifacts(manifest)
  await client.activateChannelManifest({
    channel,
    manifestBytes,
    currentSha: current?.sha,
    message: `release(${channel}): activate PARALITH ${version}`,
  })
  await client.verifyAnonymousManifest({ channel, version })
  return { release, manifest }
}

function repositoryParts(repository) {
  const parts = String(repository || '').split('/')
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error('PARALITH_UPDATES_REPOSITORY must be owner/repository')
  }
  return parts.map(encodeURIComponent)
}

async function responseMessage(response) {
  const text = await response.text()
  try {
    return JSON.parse(text).message || text
  } catch {
    return text
  }
}

async function requireResponse(response, accepted, operation) {
  if (!accepted.includes(response.status)) {
    throw new Error(`${operation} failed with HTTP ${response.status}: ${await responseMessage(response)}`)
  }
  return response
}

async function fetchArtifact(url, fetchImpl, operation = 'anonymous artifact verification') {
  let response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' })
  if ([405, 501].includes(response.status) || !response.headers.get('content-length')) {
    response = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' })
  }
  await requireResponse(response, [200, 206], operation)
  const length = Number(response.headers.get('content-length') || response.headers.get('content-range')?.split('/').pop())
  if (!Number.isFinite(length) || length <= 0) throw new Error(`${operation} returned no plausible payload size for ${url}`)
}

export function createGitHubPublisherClient({
  repository,
  token,
  branch = 'main',
  fetchImpl = fetch,
  attempts = 5,
  delay = (attempt) => new Promise((resolve) => setTimeout(resolve, attempt * 2000)),
}) {
  const [owner, repo] = repositoryParts(repository)
  if (!String(token || '').trim()) throw new Error('PARALITH_UPDATES_TOKEN is required')
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
  }
  const api = (path, options = {}) => fetchImpl(`${apiBase}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  })

  return {
    async assertPublicRepository() {
      const response = await requireResponse(await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION },
      }), [200], 'public update repository lookup')
      const metadata = await response.json()
      if (metadata.private || metadata.visibility !== 'public') {
        throw new Error(`${repository} must be public before updater artifacts can be published`)
      }
    },

    async getChannelManifest(channel) {
      const path = `/contents/channels/${channel}/latest.json?ref=${encodeURIComponent(branch)}`
      const response = await api(path)
      if (response.status === 404) return null
      await requireResponse(response, [200], `${channel} manifest lookup`)
      const content = await response.json()
      const bytes = Buffer.from(String(content.content || '').replace(/\s/g, ''), 'base64')
      let manifest
      try {
        manifest = JSON.parse(bytes.toString('utf8'))
      } catch (error) {
        throw new Error(`existing ${channel} manifest is malformed: ${error.message}`)
      }
      return { sha: content.sha, manifest, bytes }
    },

    async getRelease(tag) {
      const response = await api('/releases?per_page=100')
      await requireResponse(response, [200], 'release lookup')
      return (await response.json()).find((release) => release.tag_name === tag) || null
    },

    async deleteDraftRelease(release) {
      if (!release.draft) throw new Error('refusing to delete a published update release')
      await requireResponse(await api(`/releases/${release.id}`, { method: 'DELETE' }), [204], 'incomplete draft cleanup')
    },

    async createDraftRelease({ tag, title, releaseNotes, prerelease }) {
      const response = await api('/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_name: tag,
          target_commitish: branch,
          name: title,
          body: releaseNotes,
          draft: true,
          prerelease: Boolean(prerelease),
        }),
      })
      await requireResponse(response, [201], 'draft release creation')
      return response.json()
    },

    async uploadAsset(release, artifact) {
      const uploadBase = String(release.upload_url).replace(/\{.*$/, '')
      const response = await fetchImpl(`${uploadBase}?name=${encodeURIComponent(artifact.name)}`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(artifact.bytes.length),
          'X-GitHub-Api-Version': API_VERSION,
        },
        body: artifact.bytes,
      })
      await requireResponse(response, [201], `upload of ${artifact.name}`)
    },

    async publishRelease(release) {
      const response = await api(`/releases/${release.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: false }),
      })
      await requireResponse(response, [200], 'release publication')
      return response.json()
    },

    async assertPublishedReleaseMatches(release, artifacts) {
      if (release.draft) throw new Error('existing release is still a draft')
      const expectedChecksums = artifacts.find((artifact) => artifact.name === 'checksums.sha256')?.bytes.toString('utf8')
      const response = await fetchImpl(`${releaseAssetBaseUrl(repository, release.tag_name)}/checksums.sha256`, { redirect: 'follow' })
      await requireResponse(response, [200], 'existing release checksum lookup')
      if ((await response.text()).replace(/\r\n/g, '\n') !== expectedChecksums.replace(/\r\n/g, '\n')) {
        throw new Error(`published release ${release.tag_name} exists with different checksums`)
      }
    },

    async verifyAnonymousArtifacts(manifest) {
      const urls = [...new Set(Object.values(manifest.platforms).map((entry) => entry.url))]
      for (const url of urls) await fetchArtifact(url, fetchImpl)
    },

    async activateChannelManifest({ channel, manifestBytes, currentSha, message }) {
      const body = {
        message,
        content: manifestBytes.toString('base64'),
        branch,
      }
      if (currentSha) body.sha = currentSha
      const response = await api(`/contents/channels/${channel}/latest.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if ([409, 422].includes(response.status)) {
        throw new Error(`channel activation rejected a stale manifest SHA (HTTP ${response.status})`)
      }
      await requireResponse(response, [200, 201], `${channel} manifest activation`)
    },

    async verifyAnonymousManifest({ channel, version }) {
      let lastError
      const endpoint = channelManifestUrl(repository, channel, branch)
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await fetchImpl(`${endpoint}?release=${encodeURIComponent(version)}&attempt=${attempt}`, {
            redirect: 'follow',
            cache: 'no-store',
          })
          await requireResponse(response, [200], 'anonymous channel manifest verification')
          const manifest = await response.json()
          const problems = validateManifest(manifest, { expectedVersion: version, edition: channel })
          if (problems.length) throw new Error(problems.join('; '))
          await fetchArtifact(manifest.platforms['windows-x86_64'].url, fetchImpl)
          return manifest
        } catch (error) {
          lastError = error
          if (attempt < attempts) await delay(attempt)
        }
      }
      throw new Error(`anonymous ${channel} verification failed after ${attempts} attempts: ${lastError.message}`)
    },
  }
}

async function loadArtifacts(directory) {
  const artifacts = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(directory, entry.name)
    artifacts.push({ name: entry.name, bytes: await readFile(path), size: (await stat(path)).size })
  }
  return artifacts
}

async function main() {
  const [command, channel, ...args] = process.argv.slice(2)
  if (!['preview', 'stable'].includes(channel)) {
    throw new Error('channel must be preview or stable')
  }
  const repository = process.env.PARALITH_UPDATES_REPOSITORY
  if (command === 'stage') {
    const [tag, sourceDirectory, version, destinationDirectory] = args
    if (!tag || !sourceDirectory || !version || !destinationDirectory) {
      throw new Error('usage: github-artifacts-publisher stage <preview|stable> <tag> <release-directory> <version> <destination-directory>')
    }
    const request = await stagePublicationHandoff({
      repository,
      tag,
      channel,
      version,
      sourceDirectory,
      destinationDirectory,
    })
    console.log(`Staged ${request.channel} ${request.version} for scoped deploy-key publication.`)
    return
  }
  if (command === 'verify') {
    const [version] = args
    if (!version) {
      throw new Error('usage: github-artifacts-publisher verify <preview|stable> <version>')
    }
    await verifyAnonymousPublication({ repository, channel, version })
    console.log(`Anonymously verified ${channel} ${version} through ${repository}.`)
    return
  }
  const [tag, sourceDirectory, version] = args
  if (command !== 'publish' || !tag || !sourceDirectory || !version) {
    throw new Error('usage: github-artifacts-publisher publish <preview|stable> <tag> <release-directory> <version>')
  }
  const token = process.env.PARALITH_UPDATES_TOKEN
  const artifacts = await loadArtifacts(sourceDirectory)
  const manifestBytes = await readFile(join(sourceDirectory, 'latest.json'))
  const releaseNotes = await readFile(join(sourceDirectory, 'release-notes.md'), 'utf8')
  const client = createGitHubPublisherClient({
    repository,
    token,
    branch: process.env.PARALITH_UPDATES_BRANCH || 'main',
  })
  const result = await publishPreparedRelease({
    client,
    repository,
    tag,
    channel,
    version,
    artifacts,
    manifestBytes,
    releaseNotes,
    title: `PARALITH ${channel === 'stable' ? 'Stable' : 'Preview'} ${version}`,
    prerelease: channel === 'preview',
  })
  console.log(`Published and anonymously verified ${channel} ${result.manifest.version} through ${repository}.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
