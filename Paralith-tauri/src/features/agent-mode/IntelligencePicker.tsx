import { useEffect, useMemo, useRef } from 'react'
import { Check, ChevronDown, Info } from 'lucide-react'
import type { AgentRuntimeOption } from '../../native/types'
import { AUTOMATIC } from './agentModeStore'

/**
 * The composer's intelligence selector.
 *
 * Two rules make this trustworthy rather than decorative. First, the list is *discovered*: every
 * row comes from what the machine actually has installed and signed in, and a runtime that is
 * unavailable is shown with the real reason instead of being hidden or silently offered. Second,
 * the choice is scoped: by default it applies to the next message only, and making it the
 * conversation's default is a separate, explicit action — so a one-off never quietly becomes a
 * standing preference, and neither ever rewrites the Agent's own identity.
 */
export function IntelligencePicker({
  runtimes, open, messageOverride, conversationPreference, agentPreference, onOpenChange, onPickMessage, onPickConversation,
}: {
  runtimes: AgentRuntimeOption[]
  open: boolean
  messageOverride?: string
  conversationPreference?: string
  agentPreference?: string
  onOpenChange: (open: boolean) => void
  onPickMessage: (runtimeId?: string) => void
  onPickConversation: (runtimeId?: string) => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => {
    const byProvider = new Map<string, AgentRuntimeOption[]>()
    for (const runtime of runtimes) {
      const bucket = byProvider.get(runtime.providerId)
      if (bucket) bucket.push(runtime)
      else byProvider.set(runtime.providerId, [runtime])
    }
    return [...byProvider.values()]
  }, [runtimes])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onOpenChange(false) } }
    window.addEventListener('keydown', close, true)
    panel.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    return () => window.removeEventListener('keydown', close, true)
  }, [onOpenChange, open])

  if (!open) return null
  const selected = messageOverride ?? conversationPreference ?? (agentPreference && agentPreference !== AUTOMATIC ? agentPreference : undefined)
  const connected = runtimes.some((runtime) => runtime.available)
  return <>
    <button type="button" className="agent-picker-scrim" aria-label="Close intelligence picker" onClick={() => onOpenChange(false)} />
    <div className="agent-intelligence-panel" role="dialog" aria-label="Choose intelligence" ref={panel}>
      <header>
        <span>INTELLIGENCE</span>
        <small>Applies to the next message. The teammate stays the same.</small>
      </header>
      <div className="agent-intelligence-list">
        <button type="button" className={`agent-runtime-row ${!selected ? 'is-selected' : ''}`} onClick={() => { onPickMessage(undefined); onPickConversation(undefined); onOpenChange(false) }}>
          <span className="agent-runtime-copy"><strong>Automatic</strong><small>Paralith picks a connected runtime for the task.</small></span>
          {!selected && <Check size={13} />}
        </button>
        {groups.map((group) => <section key={group[0].providerId}>
          <h3>{group[0].providerName}{!group[0].available && <em>{group[0].installed ? 'Not signed in' : 'Not installed'}</em>}</h3>
          {group.map((runtime) => <button
            key={runtime.id}
            type="button"
            className={`agent-runtime-row ${selected === runtime.id ? 'is-selected' : ''}`}
            disabled={!runtime.available}
            title={runtime.unavailableReason ?? runtime.description}
            onClick={() => { onPickMessage(runtime.id); onOpenChange(false) }}
          >
            <span className="agent-runtime-copy"><strong>{runtime.displayName}</strong><small>{runtime.available ? runtime.description : runtime.unavailableReason}</small></span>
            {selected === runtime.id && <Check size={13} />}
          </button>)}
        </section>)}
        {!connected && <p className="agent-intelligence-empty"><Info size={13} />No runtime is connected yet. Install and sign in to Claude Code or the Codex CLI, then reopen this menu.</p>}
      </div>
      <footer>
        {messageOverride
          ? <button type="button" className="agent-text-button" onClick={() => { onPickConversation(messageOverride); onPickMessage(undefined); onOpenChange(false) }}>Use for this conversation</button>
          : <span>Choosing here never changes the teammate.</span>}
        {conversationPreference && <button type="button" className="agent-text-button" onClick={() => { onPickConversation(undefined); onOpenChange(false) }}>Clear conversation default</button>}
      </footer>
    </div>
  </>
}

export function IntelligenceTrigger({ label, explicit, disabled, onClick }: { label: string; explicit: boolean; disabled?: boolean; onClick: () => void }) {
  return <button
    type="button"
    className={`agent-intelligence-trigger ${explicit ? 'is-explicit' : ''}`}
    aria-haspopup="dialog"
    disabled={disabled}
    onClick={onClick}
  >{label}<ChevronDown size={12} /></button>
}
