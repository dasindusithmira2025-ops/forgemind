import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MANIFEST_NAME,
  invalidMirrorTarget,
  isSafeRemoteSegment,
  mirrorUploadPlan,
  normalizeRemoteRoot,
  sftpBatchScript,
} from './mirror-publisher.mjs'

const tag = 'stable-v0.5.0'
const version = '0.5.0'
const remoteRoot = '/srv/paralith'
const names = [
  MANIFEST_NAME,
  `PARALITH_${version}_x64-setup.exe`,
  `PARALITH_${version}_x64-setup.exe.sig`,
  `PARALITH_${version}_x64_en-US.msi`,
  `PARALITH_${version}_x64_en-US.msi.sig`,
  'checksums.sha256',
  'release-notes.md',
  'release-manifest.json',
]
const plan = (overrides = {}) => mirrorUploadPlan({ channel: 'stable', tag, names, remoteRoot, ...overrides })

describe('upload ordering', () => {
  it('activates the manifest only after every installer has landed', () => {
    const script = sftpBatchScript(plan({ mode: 'full' }), '/local/release')
    const lines = script.trim().split('\n')

    const lastPayload = lines.findLastIndex((line) => line.startsWith('put') && !line.includes(MANIFEST_NAME))
    const manifestPut = lines.findIndex((line) => line.includes(`.${MANIFEST_NAME}.incoming`) && line.startsWith('put'))
    const rename = lines.findIndex((line) => line.startsWith('rename'))

    expect(lastPayload).toBeGreaterThan(-1)
    expect(manifestPut).toBeGreaterThan(lastPayload)
    expect(rename).toBeGreaterThan(manifestPut)
    expect(lines.at(-1)).toBe('bye')
  })

  it('never writes the live manifest path directly, so a poll cannot read a partial file', () => {
    const script = sftpBatchScript(plan({ mode: 'full' }), '/local/release')
    const live = `${remoteRoot}/channels/stable/${MANIFEST_NAME}`

    expect(script).toContain(`put "/local/release/${MANIFEST_NAME}" ${remoteRoot}/channels/stable/.${MANIFEST_NAME}.incoming`)
    expect(script).not.toContain(`put "/local/release/${MANIFEST_NAME}" ${live}\n`)
    expect(script).toContain(`rename ${remoteRoot}/channels/stable/.${MANIFEST_NAME}.incoming ${live}`)
  })

  it('creates every directory it writes into before writing', () => {
    const full = plan({ mode: 'full' })
    const script = sftpBatchScript(full, '/local/release')
    const lines = script.trim().split('\n')

    for (const target of [...full.payload.map((artifact) => artifact.remote), full.manifest.staged]) {
      const directory = target.slice(0, target.lastIndexOf('/'))
      const mkdir = lines.findIndex((line) => line === `-mkdir ${directory}`)
      const write = lines.findIndex((line) => line.includes(target))
      expect(mkdir, `missing mkdir for ${directory}`).toBeGreaterThan(-1)
      expect(mkdir).toBeLessThan(write)
    }
  })

  it('clears the destination before renaming, because SFTP rename does not replace', () => {
    const script = sftpBatchScript(plan({ mode: 'full' }), '/local/release')
    const lines = script.trim().split('\n')

    expect(lines.findIndex((line) => line.startsWith('-rm'))).toBeLessThan(lines.findIndex((line) => line.startsWith('rename')))
  })
})

describe('mirror modes', () => {
  it('uploads only the manifest in manifest mode, since installers stay on the origin', () => {
    const manifestOnly = plan({ mode: 'manifest' })

    expect(manifestOnly.payload).toEqual([])
    expect(manifestOnly.manifest.remote).toBe(`${remoteRoot}/channels/stable/${MANIFEST_NAME}`)
    expect(sftpBatchScript(manifestOnly, '/local/release')).not.toContain('x64-setup.exe')
  })

  it('uploads installers, signatures, and checksums under the release tag in full mode', () => {
    const uploaded = plan({ mode: 'full' }).payload.map((artifact) => artifact.remote)

    expect(uploaded).toContain(`${remoteRoot}/releases/${tag}/PARALITH_${version}_x64-setup.exe`)
    expect(uploaded).toContain(`${remoteRoot}/releases/${tag}/PARALITH_${version}_x64-setup.exe.sig`)
    expect(uploaded).toContain(`${remoteRoot}/releases/${tag}/PARALITH_${version}_x64_en-US.msi`)
    expect(uploaded).toContain(`${remoteRoot}/releases/${tag}/checksums.sha256`)
    expect(uploaded.every((remote) => !remote.endsWith(MANIFEST_NAME))).toBe(true)
  })

  it('refuses a release directory with no manifest to activate', () => {
    expect(() => plan({ names: names.filter((name) => name !== MANIFEST_NAME) })).toThrow(/latest\.json is required/)
  })

  it('refuses an unknown mode rather than guessing what to upload', () => {
    expect(() => plan({ mode: 'partial' })).toThrow(/Unsupported mirror mode/)
  })
})

describe('remote path safety', () => {
  it('rejects names and tags that could escape the release directory', () => {
    for (const hostile of ['..', '.', '../../etc/passwd', 'a/b', 'a\\b', 'a b', 'a"b', 'a`b', 'a$b', 'a\nrm x', '']) {
      expect(isSafeRemoteSegment(hostile), `${JSON.stringify(hostile)} must be rejected`).toBe(false)
    }
    expect(isSafeRemoteSegment(`PARALITH_${version}_x64-setup.exe.sig`)).toBe(true)
  })

  it('refuses a hostile tag before building any remote path', () => {
    expect(() => plan({ tag: '../../../etc' })).toThrow(/unsafe for a remote mirror path/)
  })

  it('refuses a hostile artifact name before building any remote path', () => {
    expect(() => plan({ names: [...names, '../escape.exe'] })).toThrow(/unsafe artifact name/)
  })

  it('requires an absolute remote root that cannot climb out', () => {
    expect(normalizeRemoteRoot('/srv/paralith/')).toBe('/srv/paralith')
    expect(() => normalizeRemoteRoot('srv/paralith')).toThrow(/absolute path/)
    expect(() => normalizeRemoteRoot('/srv/../../etc')).toThrow(/must not contain/)
  })
})

describe('mirror target configuration', () => {
  const complete = {
    PARALITH_MIRROR_SSH_HOST: 'updates.example.com',
    PARALITH_MIRROR_SSH_USER: 'paralith',
    PARALITH_MIRROR_REMOTE_ROOT: remoteRoot,
    PARALITH_MIRROR_SSH_KEY: 'key',
    PARALITH_MIRROR_SSH_HOST_KEY: 'updates.example.com ssh-ed25519 AAAA',
  }

  it('accepts a fully configured target', () => {
    expect(invalidMirrorTarget(complete)).toEqual([])
    expect(invalidMirrorTarget({ ...complete, PARALITH_MIRROR_SSH_PORT: '2222' })).toEqual([])
  })

  it('requires a pinned host key rather than trusting whatever answers the address', () => {
    expect(invalidMirrorTarget({ ...complete, PARALITH_MIRROR_SSH_HOST_KEY: '' })).toEqual([
      expect.stringContaining('PARALITH_MIRROR_SSH_HOST_KEY is required'),
    ])
  })

  it('names every missing setting at once, without echoing any value', () => {
    const problems = invalidMirrorTarget({})

    expect(problems).toEqual(expect.arrayContaining([
      'PARALITH_MIRROR_SSH_HOST is required',
      'PARALITH_MIRROR_SSH_USER is required',
      'PARALITH_MIRROR_REMOTE_ROOT is required',
      'PARALITH_MIRROR_SSH_KEY is required',
    ]))
  })

  it('never echoes a configured value back into CI output', () => {
    const secret = 'BEGIN-OPENSSH-PRIVATE-KEY-MATERIAL'
    const report = invalidMirrorTarget({
      ...complete,
      PARALITH_MIRROR_SSH_KEY: secret,
      PARALITH_MIRROR_SSH_USER: `bad user ${secret}`,
      PARALITH_MIRROR_SSH_HOST: `bad host ${secret}`,
      PARALITH_MIRROR_SSH_PORT: secret,
    }).join(' ')

    expect(report).not.toContain(secret)
    expect(report).toContain('PARALITH_MIRROR_SSH_USER contains unsupported characters')
  })

  it('rejects malformed hosts, users, and ports', () => {
    expect(invalidMirrorTarget({ ...complete, PARALITH_MIRROR_SSH_PORT: 'ssh' })).toContain('PARALITH_MIRROR_SSH_PORT must be a TCP port')
    expect(invalidMirrorTarget({ ...complete, PARALITH_MIRROR_SSH_PORT: '70000' })).toContain('PARALITH_MIRROR_SSH_PORT must be a TCP port')
    expect(invalidMirrorTarget({ ...complete, PARALITH_MIRROR_SSH_USER: 'root; rm -rf /' })).toContain('PARALITH_MIRROR_SSH_USER contains unsupported characters')
    expect(invalidMirrorTarget({ ...complete, PARALITH_MIRROR_SSH_HOST: 'host && curl evil' })).toContain('PARALITH_MIRROR_SSH_HOST must be a hostname or IP address')
  })
})

describe('runner script', () => {
  it('pins the host key, disables interactive fallback, and always destroys the key material', async () => {
    const script = await readFile(join(resolve(process.cwd()), 'scripts', 'release', 'push-mirror-publication.ps1'), 'utf8')

    expect(script).toContain('StrictHostKeyChecking=yes')
    expect(script).toContain('UserKnownHostsFile=')
    expect(script).toContain('BatchMode=yes')
    expect(script).toContain('IdentitiesOnly=yes')
    expect(script).toContain('Remove-Item Env:\\PARALITH_MIRROR_SSH_KEY')
    expect(script).toContain('[System.Text.UTF8Encoding]::new($false)')
    expect(script).toMatch(/} finally {/)
  })
})
