import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const cleanEnvironment = () => {
  const env = { ...process.env }
  for (const name of [
    'PARALITH_UPDATER_PUBLIC_KEY',
    'PARALITH_UPDATE_ENDPOINT',
    'PARALITH_STABLE_UPDATE_ENDPOINT',
    'PARALITH_PREVIEW_UPDATE_ENDPOINT',
  ]) delete env[name]
  return env
}

const render = async (edition) => {
  const output = execFileSync(
    process.execPath,
    ['scripts/release/render-tauri-config.mjs', edition, 'test'],
    { cwd: process.cwd(), env: cleanEnvironment(), encoding: 'utf8' },
  ).trim().split(/\r?\n/).at(-1)
  return JSON.parse(await readFile(output, 'utf8'))
}

describe('edition updater configuration', () => {
  it('embeds independent Stable and Preview verification keys', async () => {
    const [stable, preview, stableKey, previewKey] = await Promise.all([
      render('stable'),
      render('preview'),
      readFile('release/updater.stable.pubkey', 'utf8'),
      readFile('release/updater.pubkey', 'utf8'),
    ])

    expect(stable.plugins.updater.pubkey).toBe(stableKey.trim())
    expect(preview.plugins.updater.pubkey).toBe(previewKey.trim())
    expect(stable.plugins.updater.pubkey).not.toBe(preview.plugins.updater.pubkey)
    expect(stable.plugins.updater.endpoints).toEqual([
      'https://updates.invalid/paralith/stable/latest.json',
    ])
    expect(preview.plugins.updater.endpoints).toEqual([
      'https://updates.invalid/paralith/preview/latest.json',
    ])
  })
})
