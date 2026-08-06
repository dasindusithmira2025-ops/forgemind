import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import process from 'node:process'
import { githubReleaseAssetName } from './github-artifacts-publisher.mjs'

const edition = process.env.PARALITH_EDITION || process.argv[2]
if (!['stable', 'preview'].includes(edition)) throw new Error('Set PARALITH_EDITION to stable or preview')
const root = process.cwd()
const canonical = JSON.parse(await readFile(join(root, 'release', 'version.json'), 'utf8'))
const changelog = JSON.parse(await readFile(join(root, 'release', 'generated', 'current-release.json'), 'utf8'))
const version = canonical.version
const commit = process.env.PARALITH_GIT_COMMIT || process.env.GITHUB_SHA || (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const buildTimestamp = process.env.PARALITH_BUILD_TIMESTAMP || new Date().toISOString()
const artifactBase = (process.env.PARALITH_UPDATE_ARTIFACT_BASE_URL || `http://127.0.0.1:4179/${edition}`).replace(/\/$/, '')
const flatArtifactLayout = process.env.PARALITH_UPDATE_PUBLISH_PROVIDER === 'github-artifacts'
const rolloutPercent = Number(process.env.PARALITH_ROLLOUT_PERCENT || 100)
if (!Number.isInteger(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
  throw new Error('PARALITH_ROLLOUT_PERCENT must be an integer from 0 through 100')
}
if (edition === 'stable' && rolloutPercent !== 100) {
  throw new Error('Stable releases must target 100% of eligible installations')
}
const bundleRoot = process.env.PARALITH_BUNDLE_DIR || join(root, 'src-tauri', 'target', 'release', 'bundle')
const output = join(root, '.artifacts', 'release', edition, version)
const siteVersion = join(root, '.artifacts', 'update-site', edition, version)
await mkdir(output, { recursive: true })
await mkdir(siteVersion, { recursive: true })

const walk = async (dir) => (await readdir(dir, { withFileTypes: true })).flatMap((entry) => entry.isDirectory() ? [] : [join(dir, entry.name)])
const editionPrefix = edition === 'stable' ? 'PARALITH_' : 'PARALITH Preview_'
const candidates = [...await walk(join(bundleRoot, 'msi')), ...await walk(join(bundleRoot, 'nsis'))]
  .filter((path) => basename(path).startsWith(editionPrefix))
const installers = candidates.filter((path) => path.endsWith('.msi') || path.endsWith('-setup.exe'))
if (installers.length !== 2) throw new Error(`Expected exactly one MSI and one NSIS installer, found ${installers.length}`)

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
const files = []
for (const source of candidates.filter((path) => installers.includes(path) || path.endsWith('.sig'))) {
  const sourceName = basename(source)
  const name = flatArtifactLayout ? githubReleaseAssetName(sourceName) : sourceName
  await cp(source, join(output, name))
  await cp(source, join(siteVersion, name))
  files.push({ name, size: (await stat(source)).size, sha256: await sha256(source) })
}

const msi = files.find((file) => file.name.endsWith('.msi'))
const nsis = files.find((file) => file.name.endsWith('-setup.exe'))
const msiSig = files.find((file) => file.name === `${msi?.name}.sig`)
const nsisSig = files.find((file) => file.name === `${nsis?.name}.sig`)
if (!msi || !nsis || !msiSig || !nsisSig) throw new Error('Signed MSI/NSIS updater artifacts are incomplete')
const signature = async (file) => (await readFile(join(output, file.name), 'utf8')).trim()
// Static update sites keep payloads under <channel>/<version>/. GitHub Release assets are flat
// under releases/download/<tag>/ and cannot contain path separators.
const url = (file) => `${artifactBase}/${flatArtifactLayout ? '' : `${version}/`}${encodeURIComponent(file.name)}`

const releaseManifest = {
  formatVersion: 1,
  product: 'PARALITH',
  edition,
  channel: edition,
  version,
  commit,
  buildTimestamp,
  schemaVersion: canonical.schemaVersion,
  target: 'windows',
  architecture: 'x86_64',
  files,
  previousInstallerUrl: process.env.PARALITH_PREVIOUS_INSTALLER_URL || null,
}
const latest = {
  version,
  notes: [...changelog.highlights, ...changelog.fixes].join('\n\n'),
  pub_date: buildTimestamp,
  platforms: {
    'windows-x86_64': { url: url(nsis), signature: await signature(nsisSig) },
    'windows-x86_64-nsis': { url: url(nsis), signature: await signature(nsisSig) },
    'windows-x86_64-msi': { url: url(msi), signature: await signature(msiSig) },
  },
  paralith: {
    edition,
    channel: edition,
    schemaVersion: canonical.schemaVersion,
    minSchemaVersion: Number(process.env.PARALITH_MIN_SCHEMA_VERSION || 1),
    maxSchemaVersion: Number(process.env.PARALITH_MAX_SCHEMA_VERSION || canonical.schemaVersion),
    rolloutPercent,
    commit,
    buildTimestamp,
    previousInstallerUrl: releaseManifest.previousInstallerUrl,
  },
}

const notes = [
  `# PARALITH ${edition === 'stable' ? 'Stable' : 'Preview'} ${version}`,
  '', `Channel: ${edition}`, `Date: ${changelog.date}`, `Git commit: ${commit}`, `Database schema: ${canonical.schemaVersion}`,
  '', '## Highlights', ...changelog.highlights.map((item) => `- ${item}`),
  '', '## Fixes', ...(changelog.fixes.length ? changelog.fixes : ['None']).map((item) => `- ${item}`),
  '', '## Database changes', ...changelog.databaseChanges.map((item) => `- ${item}`),
  '', '## Known issues', ...(changelog.knownIssues.length ? changelog.knownIssues : ['None']).map((item) => `- ${item}`),
  '', '## Required manual actions', ...(changelog.requiredManualActions.length ? changelog.requiredManualActions : ['None']).map((item) => `- ${item}`),
  '', '## SHA-256', ...files.map((file) => `- \`${file.sha256}  ${file.name}\``), ''
].join('\n')
const checksums = `${files.map((file) => `${file.sha256}  ${file.name}`).join('\n')}\n`
const schema = { schemaVersion: canonical.schemaVersion, supportedUpgradeFrom: { minimum: 1, maximum: canonical.schemaVersion }, downgradeSupported: false }
const metadata = { product: 'PARALITH', edition, version, channel: edition, commit, buildTimestamp, schemaVersion: canonical.schemaVersion, target: 'windows', architecture: 'x86_64' }

for (const [name, value] of [
  ['release-manifest.json', releaseManifest], ['build-metadata.json', metadata], ['database-schema.json', schema], ['latest.json', latest]
]) await writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`)
await writeFile(join(output, 'release-notes.md'), notes)
await writeFile(join(output, 'checksums.sha256'), checksums)
await cp(join(output, 'latest.json'), join(root, '.artifacts', 'update-site', edition, 'latest.json'))
await cp(join(output, 'release-manifest.json'), join(siteVersion, 'release-manifest.json'))
await cp(join(output, 'checksums.sha256'), join(siteVersion, 'checksums.sha256'))
console.log(relative(root, output))
