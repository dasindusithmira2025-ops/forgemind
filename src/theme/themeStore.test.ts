import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setThemePreference: vi.fn(() => Promise.resolve()),
  getThemePreference: vi.fn(() => Promise.resolve('ember')),
  applyWindowChrome: vi.fn((_chrome: { caption: string; text: string; border: string }) => Promise.resolve()),
  onThemeChanged: vi.fn((_handler: (id: string) => void) => Promise.resolve(() => {})),
  lastThemeHandler: undefined as ((id: string) => void) | undefined,
}))

vi.mock('../native/commands', () => ({
  native: {
    setThemePreference: mocks.setThemePreference,
    getThemePreference: mocks.getThemePreference,
    applyWindowChrome: mocks.applyWindowChrome,
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
    mocks.applyWindowChrome.mockClear()
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

  it('repaints the native window frame with opaque colours on every theme change', () => {
    // The OS draws the frame, so it can only be updated by pushing colours to the backend — and
    // the platform APIs take a solid colour, so an alpha or color-mix token would be rejected and
    // silently leave the caption in the system accent.
    mocks.applyWindowChrome.mockClear()
    useThemeStore.getState().setTheme('arctic-light')
    expect(mocks.applyWindowChrome).toHaveBeenCalledOnce()
    const chrome = mocks.applyWindowChrome.mock.calls[0][0]
    for (const key of ['caption', 'text', 'border'] as const) {
      expect(chrome[key], `${key} must be an opaque hex`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('keeps the theme applied when the native frame cannot be repainted', async () => {
    // A frame repaint failing (older Windows, or a window that has already closed) is cosmetic.
    mocks.applyWindowChrome.mockImplementationOnce(() => Promise.reject(new Error('no dwm')))
    useThemeStore.getState().setTheme('ember')
    await flush()
    expect(useThemeStore.getState().selectedId).toBe('ember')
    expect(document.documentElement.getAttribute('data-theme')).toBe('ember')
  })
})
