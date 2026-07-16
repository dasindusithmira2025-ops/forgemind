import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const checkOnly = process.argv.includes('--check')
const root = new URL('../../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n')

const canonical = await readJson('release/version.json')
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(canonical.version)) {
  throw new Error(`release/version.json contains an invalid semantic version: ${canonical.version}`)
}
if (!Number.isInteger(canonical.schemaVersion) || canonical.schemaVersion < 1) {
  throw new Error('release/version.json schemaVersion must be a positive integer')
}
const migrationsSource = await readFile(new URL('src-tauri/src/database/migrations.rs', root), 'utf8')
const runtimeSchema = migrationsSource.match(/CURRENT_SCHEMA_VERSION:\s*i64\s*=\s*(\d+)/)
if (!runtimeSchema) throw new Error('Could not locate CURRENT_SCHEMA_VERSION in database/migrations.rs')
if (Number(runtimeSchema[1]) !== canonical.schemaVersion) {
  throw new Error(
    'release/version.json schemaVersion ' + canonical.schemaVersion
      + ' does not match runtime schema ' + runtimeSchema[1],
  )
}

const packageJson = await readJson('package.json')
packageJson.version = canonical.version
const tauri = await readJson('src-tauri/tauri.conf.json')
tauri.version = canonical.version

const cargoUrl = new URL('src-tauri/Cargo.toml', root)
const cargoOriginal = await readFile(cargoUrl, 'utf8')
const cargo = cargoOriginal.replace(/(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+("\s*)/, `$1${canonical.version}$2`)
if (cargo === cargoOriginal && !cargoOriginal.includes(`version = "${canonical.version}"`)) {
  throw new Error('Could not locate [package].version in src-tauri/Cargo.toml')
}

const changelogUrl = new URL(`release/changelog/${canonical.version}.json`, root)
const changelog = JSON.parse(await readFile(changelogUrl, 'utf8'))
if (changelog.version !== canonical.version) throw new Error('Changelog version does not match release/version.json')
for (const field of ['channel', 'date', 'highlights', 'fixes', 'databaseChanges', 'knownIssues', 'requiredManualActions']) {
  if (!(field in changelog)) throw new Error(`Changelog is missing ${field}`)
}
if (!['stable', 'preview'].includes(changelog.channel)) throw new Error('Changelog channel must be stable or preview')
if (changelog.channel === 'stable' && canonical.version.includes('-')) throw new Error('Stable changelogs cannot use a prerelease version')
if (changelog.channel === 'preview' && !canonical.version.includes('-')) throw new Error('Preview changelogs require a semantic prerelease version')

const outputs = [
  ['package.json', stableJson(packageJson)],
  ['src-tauri/tauri.conf.json', stableJson(tauri)],
  ['src-tauri/Cargo.toml', cargo],
  ['release/generated/current-release.json', stableJson(changelog)],
]

let drift = false
for (const [path, expected] of outputs) {
  const url = new URL(path, root)
  const actual = await readFile(url, 'utf8')
  if (normalizeNewlines(actual) === expected) continue
  drift = true
  if (!checkOnly) await writeFile(url, expected)
  else console.error(`Generated release metadata is stale: ${path}`)
}
if (checkOnly && drift) process.exitCode = 1
else console.log(`${checkOnly ? 'Verified' : 'Synchronized'} PARALITH ${canonical.version} (schema ${canonical.schemaVersion})`)
