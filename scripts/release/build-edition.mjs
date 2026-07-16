import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, copyFile, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import process from 'node:process'

const edition = process.argv[2]
if (!['stable', 'preview'].includes(edition)) throw new Error('Edition must be stable or preview')

const identifier = edition === 'stable' ? 'com.corelith.paralith' : 'com.corelith.paralith.preview'
const env = {
  ...process.env,
  PARALITH_EDITION: edition,
  PARALITH_RELEASE_CHANNEL: edition,
  PARALITH_APP_IDENTIFIER: identifier,
  PARALITH_UPDATE_ENDPOINT: process.env.PARALITH_UPDATE_ENDPOINT || `https://updates.invalid/paralith/${edition}/latest.json`,
}
const configOutput = execFileSync(process.execPath, ['scripts/release/render-tauri-config.mjs', edition, 'local'], {
  cwd: process.cwd(), env, encoding: 'utf8',
}).trim().split(/\r?\n/).at(-1)
if (!configOutput) throw new Error('Edition configuration was not generated')

const npmEntry = process.env.npm_execpath
if (!npmEntry) throw new Error('npm_execpath is unavailable; run this command through npm')
const build = spawnSync(process.execPath, [npmEntry, 'run', 'tauri', '--', 'build', '--bundles', 'msi,nsis', '--config', configOutput], {
  cwd: process.cwd(), env, stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

const product = edition === 'stable' ? 'PARALITH' : 'PARALITH Preview'
const version = JSON.parse(await readFile('release/version.json', 'utf8')).version
const sources = [
  join('src-tauri', 'target', 'release', 'bundle', 'msi', `${product}_${version}_x64_en-US.msi`),
  join('src-tauri', 'target', 'release', 'bundle', 'nsis', `${product}_${version}_x64-setup.exe`),
]
const destination = join('.artifacts', 'installers', edition)
await mkdir(destination, { recursive: true })
for (const source of sources) await copyFile(source, join(destination, basename(source)))
console.log(`PARALITH ${edition} installers: ${destination}`)
