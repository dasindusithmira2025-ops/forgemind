import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setThemePreference: vi.fn(() => Promise.resolve()),
  getThemePreference: vi.fn(() => Promise.resolve('ember')),
  onThemeChanged: vi.fn((_handler: (id: string) => void) => Promise.resolve(() => {})),
  lastThemeHandler: undefined as ((id: string) => void) | undefined,
}))

vi.mock('../native/commands', () => ({
  native: {
    setThemePreference: mocks.setThemePreference,
    getThemePreference: mocks.getThemePreference,
  },
}))

vi.mock('../native/events', () => ({
  onThemeChanged: (handler: (id: string) => void) => {
    mocks.lastThemeHandler = handler
    return mocks.onThemeChanged(handler)
  },
}))

import { __resetThemeRuntimeForTests, initThemeRuntime, useThemeStore } from './themeStore'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.setThemePreference.mockClear()
    mocks.getThemePreference.mockClear()
    mocks.onThemeChanged.mockClear()
    mocks.lastThemeHandler = undefined
    useThemeStore.setState({ selectedId: 'paralith-dark', prefersDark: true, persistError: undefined })
    useThemeStore.getState().applySelection('paralith-dark')
  })

  afterEach(() => __resetThemeRuntimeForTests())

  it('applies and persists a user selection, and broadcasts it exactly once', () => {
    useThemeStore.getState().setTheme('graphite')
    expect(useThemeStore.getState().selectedId).toBe('graphite')
    expect(document.documentElement.getAttribute('data-theme')).toBe('graphite')
    expect(mocks.setThemePreference).toHaveBeenCalledExactlyOnceWith('graphite')
  })

  it('ignores a no-op reselection of the current theme', () => {
    useThemeStore.getState().setTheme('paralith-dark')
    expect(mocks.setThemePreference).not.toHaveBeenCalled()
  })

  it('applies an external theme-changed broadcast without re-persisting (no feedback loop)', async () => {
    initThemeRuntime()
    await flush()
    mocks.setThemePreference.mockClear()
    expect(mocks.lastThemeHandler).toBeTypeOf('function')
    mocks.lastThemeHandler!('obsidian')
    expect(useThemeStore.getState().selectedId).toBe('obsidian')
    expect(document.documentElement.getAttribute('data-theme')).toBe('obsidian')
    expect(mocks.setThemePreference).not.toHaveBeenCalled()
  })

  it('reconciles against the persisted preference on init', async () => {
    initThemeRuntime()
    await flush()
    expect(mocks.getThemePreference).toHaveBeenCalledOnce()
    expect(useThemeStore.getState().selectedId).toBe('ember')
    expect(useThemeStore.getState().ready).toBe(true)
  })

  it('subscribes to the theme-changed event only once even if init runs twice (no duplicate listeners)', () => {
    initThemeRuntime()
    initThemeRuntime()
    expect(mocks.onThemeChanged).toHaveBeenCalledOnce()
  })

  it('re-resolves on OS appearance change only while following System', () => {
    useThemeStore.getState().setTheme('system')
    mocks.setThemePreference.mockClear()
    useThemeStore.getState().handleSystemChange(false)
    expect(useThemeStore.getState().resolved.category).toBe('light')
    // System resolution is local; it must not persist or broadcast.
    expect(mocks.setThemePreference).not.toHaveBeenCalled()

    useThemeStore.getState().setTheme('graphite')
    useThemeStore.getState().handleSystemChange(true)
    expect(useThemeStore.getState().resolved.id).toBe('graphite')
  })

  it('records a persistence failure without rolling the applied theme back', async () => {
    mocks.setThemePreference.mockImplementationOnce(() => Promise.reject(new Error('disk full')))
    useThemeStore.getState().setTheme('obsidian')
    await flush()
    expect(useThemeStore.getState().selectedId).toBe('obsidian')
    expect(useThemeStore.getState().persistError).toBeTruthy()
  })
})
