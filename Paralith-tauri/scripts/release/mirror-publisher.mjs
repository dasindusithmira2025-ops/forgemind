// Pushing a release to a mirror we upload to, rather than one that pulls from us.
//
// A pull-through mirror is self-correcting: it fetches whatever the origin has, so a partial or
// out-of-order publication cannot happen. A push mirror has no such protection, and the ordering is
// the entire correctness story:
//
//   1. installers and their signatures go up first, under releases/<tag>/
//   2. the manifest goes up LAST, and only by renaming a fully-uploaded temporary file
//
// Reverse that and there is a window where a client reads a manifest naming files that do not exist
// yet, which surfaces to the user as a failed download on a release that "succeeded". Upload the
// manifest non-atomically and the window shrinks but never closes — a client can read a half-written
// latest.json. Both are avoided here, not mitigated.
//
// Nothing in this module talks to the network. It produces a plan and an `sftp -b` batch script that
// push-mirror-publication.ps1 executes, so the ordering and path safety are unit-testable.

import { readdir, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { normalizeBaseUrl } from './update-distribution.mjs'

/** Files that belong on the mirror. Everything else in a release directory stays private. */
const MIRROR_METADATA = new Set(['checksums.sha256', 'release-notes.md', 'release-manifest.json', 'build-metadata.json', 'database-schema.json'])

export const MANIFEST_NAME = 'latest.json'

/** A path segment safe to interpolate into a remote path and an sftp batch line. */
export function isSafeRemoteSegment(value) {
  const text = String(value ?? '')
  if (text === '' || text === '.' || text === '..') return false
  if (text !== basename(text)) return false
  if (/[\\/"'`$\r\n]/.test(text)) return false
  return /^[A-Za-z0-9._-]+$/.test(text)
}

/** Absolute remote root, without a trailing slash, rejecting anything that could escape it. */
export function normalizeRemoteRoot(root) {
  const text = String(root ?? '').trim().replace(/\/+$/, '')
  if (!text.startsWith('/')) throw new Error('PARALITH_MIRROR_REMOTE_ROOT must be an absolute path')
  if (text.split('/').some((segment) => segment === '..')) throw new Error('PARALITH_MIRROR_REMOTE_ROOT must not contain ".."')
  return text
}

/**
 * Ordered upload plan for one release.
 *
 * @param {{ channel: string, tag: string, names: string[], mode?: string, remoteRoot: string }} input
 * @returns {{ directories: string[], payload: {name: string, remote: string}[], manifest: {name: string, remote: string, staged: string}, mode: string }}
 */
export function mirrorUploadPlan({ channel, tag, names, mode = 'manifest', remoteRoot }) {
  if (!['stable', 'preview'].includes(channel)) throw new Error(`Unsupported mirror channel "${channel}"`)
  if (!isSafeRemoteSegment(tag)) throw new Error(`Release tag "${tag}" is unsafe for a remote mirror path`)
  if (!['manifest', 'full'].includes(mode)) throw new Error(`Unsupported mirror mode "${mode}"`)
  if (!names.includes(MANIFEST_NAME)) throw new Error(`${MANIFEST_NAME} is required to publish to a mirror`)

  const root = normalizeRemoteRoot(remoteRoot)
  const unsafe = names.filter((name) => !isSafeRemoteSegment(name))
  if (unsafe.length) throw new Error(`unsafe artifact name(s) for a remote mirror path: ${unsafe.join(', ')}`)

  const releaseDirectory = `${root}/releases/${tag}`
  const channelDirectory = `${root}/channels/${channel}`
  const directories = [root, `${root}/releases`, `${root}/channels`, channelDirectory]

  // In manifest mode the installers keep their canonical GitHub URLs, so shipping them to the
  // mirror would upload gigabytes nothing ever reads.
  const payload = mode === 'full'
    ? names
      .filter((name) => name !== MANIFEST_NAME && (MIRROR_METADATA.has(name) || isPublishedPayload(name)))
      .sort()
      .map((name) => ({ name, remote: `${releaseDirectory}/${name}` }))
    : []
  if (mode === 'full') directories.push(releaseDirectory)

  return {
    mode,
    directories,
    payload,
    manifest: {
      name: MANIFEST_NAME,
      remote: `${channelDirectory}/${MANIFEST_NAME}`,
      // Renamed into place only after the bytes have fully landed, so a poll never reads a partial
      // manifest and never sees a new manifest before its installers exist.
      staged: `${channelDirectory}/.${MANIFEST_NAME}.incoming`,
    },
  }
}

function isPublishedPayload(name) {
  return name.endsWith('.msi') || name.endsWith('-setup.exe') || name.endsWith('.sig')
}

/**
 * Render the plan as an `sftp -b` batch script. `sftp` aborts the batch on the first failing
 * command, which is what makes the ordering above enforceable rather than advisory.
 */
export function sftpBatchScript(plan, localDirectory) {
  const lines = ['@echo off']
  // -mkdir tolerates an existing directory; every other command must succeed.
  for (const directory of plan.directories) lines.push(`-mkdir ${directory}`)
  for (const artifact of plan.payload) lines.push(`put "${localDirectory}/${artifact.name}" ${artifact.remote}`)
  lines.push(`put "${localDirectory}/${plan.manifest.name}" ${plan.manifest.staged}`)
  // Overwriting requires clearing the destination first: SFTP rename is not defined to replace.
  lines.push(`-rm ${plan.manifest.remote}`)
  lines.push(`rename ${plan.manifest.staged} ${plan.manifest.remote}`)
  lines.push('bye')
  return `${lines.join('\n')}\n`
}

/** Names of mirror settings that are missing or malformed. Never reports a value. */
export function invalidMirrorTarget(env) {
  const problems = []
  for (const key of ['PARALITH_MIRROR_SSH_HOST', 'PARALITH_MIRROR_SSH_USER', 'PARALITH_MIRROR_REMOTE_ROOT']) {
    if (!String(env[key] ?? '').trim()) problems.push(`${key} is required`)
  }
  if (!String(env.PARALITH_MIRROR_SSH_KEY ?? '').trim()) problems.push('PARALITH_MIRROR_SSH_KEY is required')
  // Without a pinned host key the first connection trusts whatever answers. For a step that decides
  // what millions of installed clients will download, trust-on-first-use is not good enough.
  if (!String(env.PARALITH_MIRROR_SSH_HOST_KEY ?? '').trim()) {
    problems.push('PARALITH_MIRROR_SSH_HOST_KEY is required (run: ssh-keyscan -p <port> <host>)')
  }
  const port = String(env.PARALITH_MIRROR_SSH_PORT ?? '22').trim()
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) problems.push('PARALITH_MIRROR_SSH_PORT must be a TCP port')
  const user = String(env.PARALITH_MIRROR_SSH_USER ?? '').trim()
  if (user && !/^[A-Za-z0-9._-]+$/.test(user)) problems.push('PARALITH_MIRROR_SSH_USER contains unsupported characters')
  const host = String(env.PARALITH_MIRROR_SSH_HOST ?? '').trim()
  if (host && !/^[A-Za-z0-9.-]+$/.test(host)) problems.push('PARALITH_MIRROR_SSH_HOST must be a hostname or IP address')
  try {
    if (String(env.PARALITH_MIRROR_REMOTE_ROOT ?? '').trim()) normalizeRemoteRoot(env.PARALITH_MIRROR_REMOTE_ROOT)
  } catch (error) {
    problems.push(error.message)
  }
  return problems
}

/**
 * The mirror root a pushed release will be readable at, derived from the same variable the endpoint
 * is derived from, so the upload target and the polled URL cannot drift apart.
 */
export function mirrorPublicRoot(env) {
  return normalizeBaseUrl(env.PARALITH_UPDATE_MIRROR_BASE_URL)
}

async function main() {
  const [command, channel, tag, sourceDirectory, batchPath] = process.argv.slice(2)
  if (command !== 'plan' || !channel || !tag || !sourceDirectory || !batchPath) {
    throw new Error('usage: mirror-publisher plan <stable|preview> <tag> <release-directory> <batch-output-path>')
  }
  const problems = invalidMirrorTarget(process.env)
  if (problems.length > 0) {
    console.error('Mirror publication configuration FAILED (values not shown):')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  const names = (await readdir(sourceDirectory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
  const plan = mirrorUploadPlan({
    channel,
    tag,
    names,
    mode: process.env.PARALITH_UPDATE_MIRROR_MODE || 'manifest',
    remoteRoot: process.env.PARALITH_MIRROR_REMOTE_ROOT,
  })
  await writeFile(batchPath, sftpBatchScript(plan, sourceDirectory.replaceAll('\\', '/')))
  console.log(`Mirror plan (${plan.mode}): ${plan.payload.length} payload file(s), then ${plan.manifest.remote} via atomic rename.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
