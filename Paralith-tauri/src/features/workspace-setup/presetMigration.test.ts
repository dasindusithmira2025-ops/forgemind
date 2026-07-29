import { beforeEach, describe, expect, it } from 'vitest'
import {
  SETUP_PRESET_VERSION,
  loadSetupPresets,
  migratePreset,
  migratePresets,
  panesToAllocations,
} from './presetMigration'

describe('panesToAllocations', () => {
  it('reduces a pane-by-pane list into count-based allocations', () => {
    const allocations = panesToAllocations([
      { provider: 'claude', shellProfileId: undefined },
      { provider: 'claude', shellProfileId: undefined },
      { provider: 'codex', shellProfileId: undefined },
      { provider: 'powershell', shellProfileId: 'ps1' },
    ])
    expect(allocations).toEqual({ claude: 2, codex: 1, 'shell:ps1': 1 })
  })

  it('groups shells without a profile id by provider', () => {
    expect(panesToAllocations([{ provider: 'command_prompt', shellProfileId: undefined }])).toEqual({ command_prompt: 1 })
  })
})

describe('migratePreset', () => {
  it('migrates a legacy count-only preset', () => {
    const migrated = migratePreset({ id: 'p1', name: 'Squad', count: 4 })
    expect(migrated).toMatchObject({ schemaVersion: SETUP_PRESET_VERSION, terminalCount: 4, layoutId: '4', agentAllocations: {} })
  })

  it('migrates a legacy pane-based preset into counts', () => {
    const migrated = migratePreset({ id: 'p2', name: 'Old', panes: [{ provider: 'claude' }, { provider: 'claude' }, { provider: 'codex' }, { provider: 'powershell', shellProfileId: 'ps1' }] })
    expect(migrated).toMatchObject({ terminalCount: 4, agentAllocations: { claude: 2, codex: 1, 'shell:ps1': 1 } })
  })

  it('is idempotent for already-current presets', () => {
    const once = migratePreset({ id: 'p3', name: 'Pair', count: 2 })!
    const twice = migratePreset(once)
    expect(twice).toEqual(once)
  })

  it('drops unrecognisable entries', () => {
    expect(migratePreset({ nonsense: true })).toBeUndefined()
    expect(migratePresets([{ id: 'p', name: 'n', count: 1 }, 42, null])).toHaveLength(1)
  })
})

describe('loadSetupPresets', () => {
  beforeEach(() => localStorage.clear())

  it('migrates legacy storage, backs up the original, and rewrites the upgraded value', () => {
    const legacy = JSON.stringify([{ id: 'a', name: 'Solo', count: 1 }])
    localStorage.setItem('forgemind.layout-presets', legacy)
    const presets = loadSetupPresets()
    expect(presets[0]).toMatchObject({ schemaVersion: SETUP_PRESET_VERSION, terminalCount: 1 })
    expect(localStorage.getItem('forgemind.layout-presets.backup.v1')).toBe(legacy)
    const rewritten = JSON.parse(localStorage.getItem('forgemind.layout-presets')!)
    expect(rewritten[0].schemaVersion).toBe(SETUP_PRESET_VERSION)
  })

  it('returns an empty list when nothing is stored', () => {
    expect(loadSetupPresets()).toEqual([])
  })
})
