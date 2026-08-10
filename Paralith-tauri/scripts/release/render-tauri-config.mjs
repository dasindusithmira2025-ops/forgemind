import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const [edition = 'stable', mode = 'local'] = process.argv.slice(2)
if (!['stable', 'preview'].includes(edition)) throw new Error('Edition must be stable or preview')
if (!['local', 'release', 'test'].includes(mode)) throw new Error('Mode must be local, release, or test')

const root = new URL('../../', import.meta.url)
const base = JSON.parse(await readFile(new URL(`src-tauri/tauri.${edition}.conf.json`, root), 'utf8'))
const publicKeyPath = edition === 'stable' ? 'release/updater.stable.pubkey' : 'release/updater.pubkey'
const publicKey = (await readFile(new URL(publicKeyPath, root), 'utf8')).trim()
const effectivePublicKey = (process.env.PARALITH_UPDATER_PUBLIC_KEY || publicKey).trim()
const endpointName = edition === 'stable' ? 'PARALITH_STABLE_UPDATE_ENDPOINT' : 'PARALITH_PREVIEW_UPDATE_ENDPOINT'
const endpoint = process.env[endpointName] || process.env.PARALITH_UPDATE_ENDPOINT || `https://updates.invalid/paralith/${edition}/latest.json`

if (mode === 'release' && publicKey.startsWith('REPLACE_WITH_')) {
  throw new Error(`Production updater public key is not provisioned in ${publicKeyPath}`)
}
if (mode === 'release' && !endpoint.startsWith('https://')) {
  throw new Error(`${endpointName} must use HTTPS for production releases`)
}

base.bundle = { ...base.bundle, createUpdaterArtifacts: mode === 'release' || mode === 'test' }
base.plugins = {
  ...base.plugins,
  updater: {
    ...base.plugins?.updater,
    endpoints: [endpoint],
    pubkey: effectivePublicKey,
  },
}
if (process.env.PARALITH_WINDOWS_SIGN_COMMAND) {
  base.bundle.windows = { ...base.bundle.windows, signCommand: process.env.PARALITH_WINDOWS_SIGN_COMMAND }
}
if (mode === 'test') {
  base.plugins.updater.dangerousInsecureTransportProtocol = true
}

const outDir = new URL('.artifacts/config/', root)
await mkdir(outDir, { recursive: true })
const out = new URL(`tauri.${edition}.${mode}.json`, outDir)
await writeFile(out, `${JSON.stringify(base, null, 2)}\n`)
// The caller passes this straight to `tauri build --config`, so it must be a real filesystem
// path. `URL.pathname` is percent-encoded and would corrupt any checkout whose path contains a
// space (or any other reserved character); fileURLToPath decodes and applies platform separators.
console.log(fileURLToPath(out))
