import { useState } from 'react'
import { Bot, ChevronDown, CopyPlus, Plus, SquareTerminal, TriangleAlert } from 'lucide-react'
import { SESSION_PRESSURE_THRESHOLD } from '../paneCreation'

/**
 * One thing the workspace can create. `kind` only groups the menu and picks an icon — adding a
 * future surface (browser, diff, test output) means contributing another option, not another
 * control, so the creation system grows without the title bar growing with it.
 */
export interface NewPaneOption {
  id: string
  label: string
  hint: string
  kind: 'agent' | 'shell' | 'surface'
}

interface NewPaneMenuProps {
  options: NewPaneOption[]
  /** The option the primary button and Ctrl+Shift+T create; undefined disables the fast path. */
  defaultOptionId?: string
  liveSessions: number
  idleSessions: number
  busy?: boolean
  /** True while agent/shell detection is still running, so "none available" is not yet a fact. */
  detecting?: boolean
  onCreate: (optionId: string) => void
  onDuplicateContext: () => void
  onInspectSessions: () => void
}

const KIND_ICON = { agent: Bot, shell: SquareTerminal, surface: SquareTerminal } as const
const GROUPS: Array<{ kind: NewPaneOption['kind']; label: string }> = [
  { kind: 'shell', label: 'Terminals' },
  { kind: 'agent', label: 'Agents' },
  { kind: 'surface', label: 'Surfaces' },
]

/**
 * The workspace creation control: a split button whose primary half makes a standard terminal in
 * one click and whose caret opens the full set. Creation is the most frequent thing a developer
 * does to a workspace, so the common case costs no menu, no modal and no navigation — the new
 * pane simply appears beside the focused context.
 */
export function NewPaneMenu({
  options,
  defaultOptionId,
  liveSessions,
  idleSessions,
  busy = false,
  detecting = false,
  onCreate,
  onDuplicateContext,
  onInspectSessions,
}: NewPaneMenuProps) {
  const [open, setOpen] = useState(false)
  const defaultOption = options.find((option) => option.id === defaultOptionId)
  const pressured = liveSessions >= SESSION_PRESSURE_THRESHOLD

  const choose = (run: () => void) => {
    setOpen(false)
    run()
  }

  return (
    <div className="new-pane-wrap">
      <button
        type="button"
        className="new-pane-primary"
        disabled={busy || !defaultOption}
        title={defaultOption ? `New ${defaultOption.label} pane (Ctrl+Shift+T)` : detecting ? 'Detecting available agents and shells…' : 'No shell or agent is available'}
        onClick={() => defaultOption && onCreate(defaultOption.id)}
      >
        <Plus size={14} aria-hidden />
        Terminal
      </button>
      <button
        type="button"
        className="new-pane-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="New pane options"
        title="New pane options"
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <>
          <button className="context-scrim" aria-label="Close new pane menu" onClick={() => setOpen(false)} />
          <div className="context-popover new-pane-popover" role="menu">
            {GROUPS.map((group) => {
              const groupOptions = options.filter((option) => option.kind === group.kind)
              if (groupOptions.length === 0) return null
              const Icon = KIND_ICON[group.kind]
              return (
                <div key={group.kind} className="new-pane-group">
                  <span className="new-pane-label">{group.label}</span>
                  {groupOptions.map((option) => (
                    <button
                      key={option.id}
                      role="menuitem"
                      className="new-pane-item"
                      onClick={() => choose(() => onCreate(option.id))}
                    >
                      <Icon size={15} aria-hidden />
                      <span>
                        <strong>{option.label}</strong>
                        <em>{option.hint}</em>
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}
            <span className="menu-separator" />
            <button role="menuitem" className="new-pane-item" onClick={() => choose(onDuplicateContext)}>
              <CopyPlus size={15} aria-hidden />
              <span>
                <strong>Duplicate context</strong>
                <em>Same directory and worktree, new independent session</em>
              </span>
            </button>
            <span className="menu-separator" />
            <button
              role="menuitem"
              className={`new-pane-sessions ${pressured ? 'is-pressured' : ''}`}
              onClick={() => choose(onInspectSessions)}
            >
              {pressured && <TriangleAlert size={14} aria-hidden />}
              <span>
                {liveSessions} live · {idleSessions} idle
                {pressured && ' — this many live sessions can slow the machine'}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
