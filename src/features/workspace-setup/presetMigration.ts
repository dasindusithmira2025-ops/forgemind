import type { PaneAssignment } from '../../native/types'
import { SHELL_ID_PREFIX, isCodingProvider } from './agentRegistry'
import { layoutForCount, type CustomAgentAllocation } from './setupTypes'

// Count-based setup presets, versioned so old pane/count presets migrate forward safely and
// idempotently. Migration never destroys the original payload: the pre-migration blob is backed
// up before the upgraded value is written.

export const SETUP_PRESET_VERSION = 2
const PRESET_STORAGE_KEY = 'forgemind.layout-presets'
const PRESET_BACKUP_KEY = 'forgemind.layout-presets.backup.v1'

export interface SetupPreset {
  schemaVersion: number
  id: string
  name: string
  terminalCount: number
  layoutId: string
  agentAllocations: Record<string, number>
  customCommands: CustomAgentAllocation[]
}

/**
 * Reduce a pane-by-pane assignment list into count-based allocations. Coding agents are keyed by
 * provider; shells are keyed by their profile id (falling back to provider when absent). Unknown
 * or empty providers are skipped rather than corrupting the result.
 */
export function panesToAllocations(panes: Pick<PaneAssignment, 'provider' | 'shellProfileId'>[]): Record<string, number> {
  const allocations: Record<string, number> = {}
  for (const pane of panes) {
    if (!pane.provider) continue
    const key = isCodingProvider(pane.provider)
      ? pane.provider
      : pane.shellProfileId
        ? `${SHELL_ID_PREFIX}${pane.shellProfileId}`
        : pane.provider
    allocations[key] = (allocations[key] ?? 0) + 1
  }
  return allocations
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Migrate a single stored preset of any historical shape into the current SetupPreset. */
export function migratePreset(raw: unknown): SetupPreset | undefined {
  if (!isRecord(raw)) return undefined
  const id = typeof raw.id === 'string' ? raw.id : crypto.randomUUID()
  const name = typeof raw.name === 'string' ? raw.name : 'Preset'

  // Already-current preset: pass through unchanged (idempotency).
  if (raw.schemaVersion === SETUP_PRESET_VERSION && isRecord(raw.agentAllocations)) {
    return {
      schemaVersion: SETUP_PRESET_VERSION,
      id,
      name,
      terminalCount: typeof raw.terminalCount === 'number' ? raw.terminalCount : 1,
      layoutId: typeof raw.layoutId === 'string' ? raw.layoutId : layoutForCount(1).id,
      agentAllocations: sanitizeAllocations(raw.agentAllocations),
      customCommands: sanitizeCustom(raw.customCommands),
    }
  }

  // Legacy pane-based preset: { panes: PaneAssignment[] }.
  if (Array.isArray(raw.panes)) {
    const panes = raw.panes.filter(isRecord) as Array<Pick<PaneAssignment, 'provider' | 'shellProfileId'>>
    const terminalCount = panes.length || 1
    return {
      schemaVersion: SETUP_PRESET_VERSION,
      id,
      name,
      terminalCount,
      layoutId: layoutForCount(terminalCount).id,
      agentAllocations: panesToAllocations(panes),
      customCommands: [],
    }
  }

  // Legacy count-only preset: { count: number }.
  if (typeof raw.count === 'number' && Number.isFinite(raw.count)) {
    const terminalCount = Math.max(1, Math.round(raw.count))
    return {
      schemaVersion: SETUP_PRESET_VERSION,
      id,
      name,
      terminalCount,
      layoutId: layoutForCount(terminalCount).id,
      agentAllocations: {},
      customCommands: [],
    }
  }

  return undefined
}

function sanitizeAllocations(value: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) result[key] = Math.round(count)
  }
  return result
}

function sanitizeCustom(value: unknown): CustomAgentAllocation[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).flatMap((entry) => {
    const label = typeof entry.label === 'string' ? entry.label : ''
    const command = typeof entry.command === 'string' ? entry.command : ''
    const count = typeof entry.count === 'number' ? Math.max(0, Math.round(entry.count)) : 0
    if (!command.trim()) return []
    return [{ id: typeof entry.id === 'string' ? entry.id : crypto.randomUUID(), label: label || command, command, count }]
  })
}

export function migratePresets(rawList: unknown): SetupPreset[] {
  if (!Array.isArray(rawList)) return []
  return rawList.flatMap((raw) => {
    const migrated = migratePreset(raw)
    return migrated ? [migrated] : []
  })
}

/** Load presets from storage, migrating legacy shapes once and preserving a one-time backup. */
export function loadSetupPresets(): SetupPreset[] {
  let rawText: string | null = null
  try {
    rawText = localStorage.getItem(PRESET_STORAGE_KEY)
  } catch {
    return []
  }
  if (!rawText) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return []
  }
  const presets = migratePresets(parsed)
  // Persist the migration result if anything actually changed shape, backing up the original first.
  const needsUpgrade = !Array.isArray(parsed) || parsed.some((item) => !isRecord(item) || item.schemaVersion !== SETUP_PRESET_VERSION)
  if (needsUpgrade) {
    try {
      if (!localStorage.getItem(PRESET_BACKUP_KEY)) localStorage.setItem(PRESET_BACKUP_KEY, rawText)
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets))
    } catch {
      /* storage may be unavailable; presets still load in-memory */
    }
  }
  return presets
}

export function saveSetupPresets(presets: SetupPreset[]): void {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets))
  } catch {
    /* ignore storage failures */
  }
}
