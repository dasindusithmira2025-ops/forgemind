import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarPreferences } from '../../native/types'

const getSidebarPreferences = vi.hoisted(() => vi.fn())
const setSidebarPreferences = vi.hoisted(() => vi.fn())

vi.mock('../../native/commands', () => ({
  native: {
    getSidebarPreferences: (...args: unknown[]) => getSidebarPreferences(...args),
    setSidebarPreferences: (...args: unknown[]) => setSidebarPreferences(...args),
  },
}))

const {
  clearLegacySidebarPreferences,
  currentSidebarPreferences,
  flushSidebarPreferences,
  hydrateSidebarPreferences,
  readLegacySidebarPreferences,
  useSidebarStore,
} = await import('./sidebarStore')

const DEFAULTS: SidebarPreferences = { groupBy: 'project', sortMode: 'manual', collapsedGroups: [] }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setSidebarPreferences.mockResolvedValue(undefined)
  getSidebarPreferences.mockResolvedValue(DEFAULTS)
  useSidebarStore.setState({
    groupBy: 'project',
    sortMode: 'manual',
    collapsedGroups: {},
    preferencesHydrated: false,
    frozenOrder: [],
    sortEpoch: 0,
    filterQuery: '',
  })
})

describe('currentSidebarPreferences', () => {
  it('persists only the collapsed sections', () => {
    // An expanded section is the default, so recording it would accumulate entries for sections
    // that no longer exist.
    expect(
      currentSidebarPreferences({
        groupBy: 'flat',
        sortMode: 'attention',
        collapsedGroups: { 'project:a': true, 'project:b': false },
      }),
    ).toEqual({ groupBy: 'flat', sortMode: 'attention', collapsedGroups: ['project:a'] })
  })
})

describe('readLegacySidebarPreferences', () => {
  it('is undefined when the renderer never held anything', () => {
    expect(readLegacySidebarPreferences()).toBeUndefined()
  })

  it('reads the values the old renderer-local storage held', () => {
    localStorage.setItem('paralith.sidebar.groupBy', 'flat')
    localStorage.setItem('paralith.sidebar.sortMode', 'attention')
    localStorage.setItem(
      'paralith.sidebar.collapsedGroups',
      JSON.stringify({ 'project:a': true, 'project:b': false }),
    )
    expect(readLegacySidebarPreferences()).toEqual({
      groupBy: 'flat',
      sortMode: 'attention',
      collapsedGroups: ['project:a'],
    })
  })

  it('falls back to the defaults on junk rather than propagating it', () => {
    localStorage.setItem('paralith.sidebar.groupBy', 'tree')
    localStorage.setItem('paralith.sidebar.collapsedGroups', 'not json')
    expect(readLegacySidebarPreferences()).toEqual(DEFAULTS)
  })
})

describe('hydrateSidebarPreferences', () => {
  it('carries renderer-local values over to the settings authority, then clears them', () => {
    localStorage.setItem('paralith.sidebar.sortMode', 'attention')
    return hydrateSidebarPreferences().then(() => {
      expect(useSidebarStore.getState().sortMode).toBe('attention')
      expect(setSidebarPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ sortMode: 'attention' }),
      )
      expect(localStorage.getItem('paralith.sidebar.sortMode')).toBeNull()
    })
  })

  it('lets the stored value win once a preference has been set through the new authority', async () => {
    // A stale localStorage entry must never override a real choice made since the move.
    getSidebarPreferences.mockResolvedValue({ groupBy: 'flat', sortMode: 'manual', collapsedGroups: [] })
    localStorage.setItem('paralith.sidebar.groupBy', 'project')
    localStorage.setItem('paralith.sidebar.sortMode', 'attention')
    await hydrateSidebarPreferences()
    expect(useSidebarStore.getState().groupBy).toBe('flat')
    expect(useSidebarStore.getState().sortMode).toBe('manual')
    expect(setSidebarPreferences).not.toHaveBeenCalled()
    // The legacy keys still go, or the migration would reconsider them on every launch.
    expect(localStorage.getItem('paralith.sidebar.groupBy')).toBeNull()
  })

  it('applies collapsed sections from storage', async () => {
    getSidebarPreferences.mockResolvedValue({
      groupBy: 'project',
      sortMode: 'manual',
      collapsedGroups: ['project:a'],
    })
    await hydrateSidebarPreferences()
    expect(useSidebarStore.getState().collapsedGroups).toEqual({ 'project:a': true })
    expect(useSidebarStore.getState().preferencesHydrated).toBe(true)
  })

  it('reconciles an unknown persisted mode to the default rather than rendering it', async () => {
    getSidebarPreferences.mockResolvedValue({
      groupBy: 'tree',
      sortMode: 'smart',
      collapsedGroups: [],
    } as unknown as SidebarPreferences)
    await hydrateSidebarPreferences()
    expect(useSidebarStore.getState().groupBy).toBe('project')
    expect(useSidebarStore.getState().sortMode).toBe('manual')
  })
})

describe('preference write-back', () => {
  it('does not write before hydration', async () => {
    // A first paint must never overwrite the durable value it has not read yet.
    useSidebarStore.getState().setGroupBy('flat')
    await flushSidebarPreferences()
    expect(setSidebarPreferences).not.toHaveBeenCalled()
  })

  it('coalesces a burst of changes into one write', async () => {
    await hydrateSidebarPreferences()
    setSidebarPreferences.mockClear()
    const store = useSidebarStore.getState()
    store.setGroupCollapsed('project:a', true)
    store.setGroupCollapsed('project:b', true)
    store.setSortMode('attention')
    await flushSidebarPreferences()
    expect(setSidebarPreferences).toHaveBeenCalledTimes(1)
    expect(setSidebarPreferences).toHaveBeenCalledWith({
      groupBy: 'project',
      sortMode: 'attention',
      collapsedGroups: ['project:a', 'project:b'],
    })
  })
})

describe('sort epoch', () => {
  it('asks for a fresh order when the order mode changes', () => {
    const before = useSidebarStore.getState().sortEpoch
    useSidebarStore.getState().setSortMode('attention')
    expect(useSidebarStore.getState().sortEpoch).toBe(before + 1)
  })

  it('asks for a fresh order when the filter changes what the list contains', () => {
    // Rows the filter just revealed have no position in the pinned order and would otherwise all
    // pile up at the end.
    const before = useSidebarStore.getState().sortEpoch
    useSidebarStore.getState().setFilterQuery('ap')
    expect(useSidebarStore.getState().sortEpoch).toBe(before + 1)
  })
})

describe('clearLegacySidebarPreferences', () => {
  it('removes every legacy key', () => {
    localStorage.setItem('paralith.sidebar.groupBy', 'flat')
    localStorage.setItem('paralith.sidebar.sortMode', 'attention')
    localStorage.setItem('paralith.sidebar.collapsedGroups', '{}')
    clearLegacySidebarPreferences()
    expect(localStorage.length).toBe(0)
  })
})
