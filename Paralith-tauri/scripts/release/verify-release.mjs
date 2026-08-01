import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const [edition, tag] = process.argv.slice(2)
const { version } = JSON.parse(await readFile(new URL('../../release/version.json', import.meta.url), 'utf8'))
const expected = `${edition}-v${version}`
if (tag !== expected) throw new Error(`Release tag must exactly match ${expected}`)
if (execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim() !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()) {
  throw new Error('Protected release tag does not point at the checked-out commit')
}
if (edition === 'preview' && !version.includes('-')) throw new Error('Preview releases require a semantic prerelease version')
if (edition === 'stable' && version.includes('-')) throw new Error('Stable releases cannot use a prerelease version')
console.log(`Verified ${edition} release ${version}`)
