import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { listThemes, previewTheme, type ThemeListEntry } from './registry'
import { toCssVars, type ThemeId } from './tokens'
import { useThemeStore } from './themeStore'

/**
 * The Appearance theme picker: a responsive grid of theme cards, each showing a miniature abstract
 * application window rendered from the theme's *real* tokens (so a preview can never disagree with
 * what gets applied). Selection is a radiogroup with roving focus; navigating browses without
 * changing the app, and Enter/Space (or a click) applies instantly with no Save step.
 */
export function ThemeGallery() {
  const entries = listThemes()
  const selectedId = useThemeStore((state) => state.selectedId)
  const prefersDark = useThemeStore((state) => state.prefersDark)
  const ready = useThemeStore((state) => state.ready)
  const persistError = useThemeStore((state) => state.persistError)
  const setTheme = useThemeStore((state) => state.setTheme)
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusCard = (index: number) => {
    const clamped = (index + entries.length) % entries.length
    cardRefs.current[clamped]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, id: ThemeId) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault(); focusCard(index + 1); break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault(); focusCard(index - 1); break
      case 'Home':
        event.preventDefault(); focusCard(0); break
      case 'End':
        event.preventDefault(); focusCard(entries.length - 1); break
      case ' ':
      case 'Enter':
        event.preventDefault(); setTheme(id); break
      default:
        break
    }
  }

  // Focus starts on the active card; every other card is removed from the tab order (roving tabindex).
  const focusableIndex = Math.max(0, entries.findIndex((entry) => entry.id === selectedId))

  return (
    <div className="theme-gallery">
      {persistError && <p className="theme-gallery-note attention" role="status">{persistError}</p>}
      {!ready && <p className="theme-gallery-note" role="status">Loading your saved theme…</p>}
      <div className="theme-grid" role="radiogroup" aria-label="Application theme">
        {entries.map((entry, index) => {
          const selected = entry.id === selectedId
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${entry.name}. ${entry.description}`}
              tabIndex={index === focusableIndex ? 0 : -1}
              ref={(node) => { cardRefs.current[index] = node }}
              className={`theme-card ${selected ? 'selected' : ''}`}
              onClick={() => setTheme(entry.id)}
              onKeyDown={(event) => onKeyDown(event, index, entry.id)}
            >
              <ThemePreview entry={entry} prefersDark={prefersDark} />
              <span className="theme-card-meta">
                <span className="theme-card-head">
                  <strong>{entry.name}</strong>
                  {selected && <span className="theme-active-pill">Active</span>}
                </span>
                <span className="theme-card-desc">{entry.description}</span>
              </span>
              <span className={`theme-card-check ${selected ? 'on' : ''}`} aria-hidden="true">
                <Check size={13} strokeWidth={3} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A miniature app window painted entirely from the theme's tokens (scoped via inline CSS vars). */
function ThemePreview({ entry, prefersDark }: { entry: ThemeListEntry; prefersDark: boolean }) {
  const theme = previewTheme(entry.id, prefersDark)
  const vars = toCssVars(theme) as CSSProperties
  return (
    <span className="theme-preview" style={vars} aria-hidden="true">
      <span className="tp-window">
        <span className="tp-titlebar">
          <span className="tp-dot" /><span className="tp-dot" /><span className="tp-dot" />
        </span>
        <span className="tp-body">
          <span className="tp-sidebar">
            <span className="tp-nav is-active" />
            <span className="tp-nav" />
            <span className="tp-nav" />
            <span className="tp-nav" />
          </span>
          <span className="tp-main">
            <span className="tp-row" />
            <span className="tp-row short" />
            <span className="tp-chip" />
            <span className="tp-terminal">
              <span className="tp-term-line prompt" />
              <span className="tp-term-line" />
            </span>
          </span>
        </span>
      </span>
    </span>
  )
}
