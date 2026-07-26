import { beforeEach, describe, expect, it } from 'vitest'
import indexCss from '../index.css?raw'
import {
  REQUIRED_CSS_VARS, monacoThemeName, toCssVars, toMonacoColors, toTerminalTheme,
} from './tokens'
import { CONCRETE_THEME_ORDER } from './themes'
import {
  DEFAULT_THEME_ID, allConcreteThemes, coerceThemeId, isValidThemeId, listThemes,
  missingCssVars, resolveSystemConcreteId, resolveTheme,
} from './registry'
import { applyTheme, cachedThemeId, STORAGE_KEYS } from './applyTheme'

describe('theme registry', () => {
  it('exposes every concrete theme plus a System option, all with unique ids', () => {
    const listed = listThemes()
    const ids = listed.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('system')
    for (const theme of allConcreteThemes()) expect(ids).toContain(theme.id)
  })

  it('ships the six required themes', () => {
    const ids = listThemes().map((entry) => entry.id)
    expect(ids).toEqual(
      expect.arrayContaining(['system', 'paralith-dark', 'graphite', 'obsidian', 'ember', 'arctic-light']),
    )
  })

  it('every concrete theme produces the complete required token set with non-empty values', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(missingCssVars(theme)).toEqual([])
      const vars = toCssVars(theme)
      for (const name of REQUIRED_CSS_VARS) {
        expect(vars[name]?.trim().length ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('defines every required token in the index.css bootstrap :root so nothing renders unstyled before applyTheme runs', () => {
    // The app paints from the :root block on first frame (flash-free bootstrap) and only then
    // swaps in the persisted theme. A token added to the theme model but not to that block would
    // resolve to nothing for that frame, so the two lists have to stay in lockstep.
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(indexCss)
    expect(root).not.toBeNull()
    const declared = new Set(
      Array.from(root![1].matchAll(/^\s*(--[\w-]+)\s*:/gm), (match) => match[1]),
    )
    expect(REQUIRED_CSS_VARS.filter((name) => !declared.has(name))).toEqual([])
  })

  it('validates and coerces theme ids, falling back to the default for unknown values', () => {
    expect(isValidThemeId('graphite')).toBe(true)
    expect(isValidThemeId('system')).toBe(true)
    expect(isValidThemeId('does-not-exist')).toBe(false)
    expect(isValidThemeId(undefined)).toBe(false)
    expect(coerceThemeId('does-not-exist')).toBe(DEFAULT_THEME_ID)
    expect(coerceThemeId(null)).toBe(DEFAULT_THEME_ID)
    expect(coerceThemeId('ember')).toBe('ember')
  })

  it('resolves a corrupt saved id to the default theme rather than leaving the app unstyled', () => {
    expect(resolveTheme('garbage', true).id).toBe(DEFAULT_THEME_ID)
    expect(resolveTheme(undefined, false).id).toBe(DEFAULT_THEME_ID)
  })

  it('resolves System to an appropriate concrete theme for each OS appearance', () => {
    expect(resolveTheme('system', true).category).toBe('dark')
    expect(resolveTheme('system', false).category).toBe('light')
    expect(resolveSystemConcreteId(true)).toBe('paralith-dark')
    expect(resolveSystemConcreteId(false)).toBe('arctic-light')
  })

  it('keeps every theme id lowercase-kebab and backend-acceptable', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(theme.id).toMatch(/^[a-z0-9-]+$/)
      expect(theme.version).toBeGreaterThan(0)
    }
  })
})

describe('terminal + editor mapping', () => {
  it('converts a theme into a full xterm palette (16 ANSI colours + core colours)', () => {
    const term = toTerminalTheme(CONCRETE_THEME_ORDER[0])
    for (const key of [
      'background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground',
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
      'brightMagenta', 'brightCyan', 'brightWhite',
    ]) {
      expect(term[key], `missing ${key}`).toBeTruthy()
    }
  })

  it('names Monaco themes deterministically and maps editor colours + base', () => {
    for (const theme of CONCRETE_THEME_ORDER) {
      expect(monacoThemeName(theme.id)).toBe(`paralith-${theme.id}`)
      const colors = toMonacoColors(theme)
      expect(colors['editor.background']).toBe(theme.editor.background)
      expect(colors['editor.foreground']).toBe(theme.editor.foreground)
      expect(['vs', 'vs-dark']).toContain(theme.editor.base)
    }
    // Light theme uses the light Monaco base; dark themes use the dark base.
    const light = allConcreteThemes().find((theme) => theme.category === 'light')!
    expect(light.editor.base).toBe('vs')
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme')
  })

  it('writes CSS variables, the data-theme attribute, color-scheme, and the bootstrap cache', () => {
    const theme = resolveTheme('graphite', true)
    applyTheme(theme, 'graphite')
    const root = document.documentElement
    expect(root.getAttribute('data-theme')).toBe('graphite')
    expect(root.style.getPropertyValue('--bg')).toBe(theme.colors.background.canvas)
    expect(root.style.colorScheme).toBe('dark')
    expect(localStorage.getItem(STORAGE_KEYS.id)).toBe('graphite')
    expect(localStorage.getItem(STORAGE_KEYS.scheme)).toBe('dark')
    expect(cachedThemeId()).toBe('graphite')
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.vars) ?? '{}')
    expect(cached['--bg']).toBe(theme.colors.background.canvas)
  })

  it('stores the user selection (system), not the resolved id, so the choice survives restart', () => {
    applyTheme(resolveTheme('system', false), 'system')
    expect(localStorage.getItem(STORAGE_KEYS.id)).toBe('system')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
