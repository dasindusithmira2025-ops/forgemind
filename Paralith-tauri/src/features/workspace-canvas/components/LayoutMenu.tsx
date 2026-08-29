import { useState } from 'react'
import { Columns2, LayoutGrid, PanelsTopLeft, Rows2, Sparkles, Square } from 'lucide-react'
import { LAYOUT_PRESETS, tidyPresetFor, type LayoutPresetId } from '../layoutPresets'

const PRESET_ICON: Record<LayoutPresetId, typeof Square> = {
  tidy: Sparkles,
  focus: Square,
  pair: Columns2,
  workbench: PanelsTopLeft,
  review: Rows2,
  swarm: LayoutGrid,
}

interface LayoutMenuProps {
  paneCount: number
  onApply: (preset: LayoutPresetId) => void
}

/**
 * The workspace composition control. Tidy is promoted to its own button because it is the action
 * a crowded workspace almost always wants; the named shapes sit behind one popover so the title
 * bar stays quiet. Presets that cannot differ from `focus` at the current pane count are shown
 * disabled rather than hidden, so the control's shape does not change as panes come and go.
 */
export function LayoutMenu({ paneCount, onApply }: LayoutMenuProps) {
  const [open, setOpen] = useState(false)
  const tidyTarget = tidyPresetFor(paneCount)
  const named = LAYOUT_PRESETS.filter((preset) => preset.id !== 'tidy')

  const choose = (preset: LayoutPresetId) => {
    setOpen(false)
    onApply(preset)
  }

  return (
    <div className="layout-menu-wrap">
      <button
        type="button"
        className="layout-tidy"
        disabled={paneCount < 2}
        title={paneCount < 2 ? 'Tidy needs more than one pane' : `Rearrange ${paneCount} panes (${tidyTarget})`}
        onClick={() => choose('tidy')}
      >
        <Sparkles size={14} aria-hidden />
        Tidy
      </button>
      <button
        type="button"
        className="layout-presets-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Workspace layout"
        title="Workspace layout"
        disabled={paneCount < 1}
        onClick={() => setOpen((value) => !value)}
      >
        <LayoutGrid size={14} aria-hidden />
      </button>
      {open && (
        <>
          <button className="context-scrim" aria-label="Close layout menu" onClick={() => setOpen(false)} />
          <div className="context-popover layout-popover" role="menu">
            <span className="layout-popover-label">Composition</span>
            {named.map((preset) => {
              const Icon = PRESET_ICON[preset.id]
              const unavailable = paneCount < preset.minPanes
              return (
                <button
                  key={preset.id}
                  role="menuitem"
                  className="layout-preset-item"
                  disabled={unavailable}
                  onClick={() => choose(preset.id)}
                >
                  <Icon size={15} aria-hidden />
                  <span>
                    <strong>{preset.label}</strong>
                    <em>{unavailable ? `Needs ${preset.minPanes}+ panes` : preset.description}</em>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
