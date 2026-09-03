import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, ChevronLeft, GripVertical, MoreHorizontal, Paperclip, Pin, Plus, Search, Send, Square, UserRoundPlus, X } from 'lucide-react'
import type { AgentConversationEntry, AgentMessageAttachment, AgentWork, AgentWorkStatus, CreateOrganizationalAgentInput, OrganizationalAgent, Project, Workspace } from '../../native/types'
import { asNativeError, native } from '../../native/commands'
import { AgentAvatar } from './AgentIdentity'
import { AgentSettingsPanel, ApprovalCard } from './AgentGovernance'
import { IntelligencePicker, IntelligenceTrigger } from './IntelligencePicker'
import { composerRuntimeLabel, useAgentModeStore } from './agentModeStore'
import './agentMode.css'

type Template = 'chief' | 'product' | 'engineering' | 'research' | 'finance' | 'operations' | 'custom'
const templates: Array<{ id: Template; label: string; name: string; role: string; responsibility: string }> = [
  { id: 'chief', label: 'Chief of Staff', name: 'Atlas', role: 'Chief of Staff', responsibility: 'Coordinate priorities, delegate bounded work, surface blockers, and prepare decisions.' },
  { id: 'product', label: 'Product Manager', name: 'Mira', role: 'Product Manager', responsibility: 'Turn product direction into clear plans, acceptance criteria, and decisions.' },
  { id: 'engineering', label: 'Engineering Lead', name: 'Forge', role: 'Engineering Lead', responsibility: 'Own implementation quality, verification, and reviewable engineering delivery.' },
  { id: 'research', label: 'Researcher', name: 'Scout', role: 'Researcher', responsibility: 'Investigate bounded questions and return sourced, decision-ready findings.' },
  { id: 'finance', label: 'Financial Manager', name: 'Ledger', role: 'Financial Manager', responsibility: 'Maintain financial context, controls, and decision-ready reporting.' },
  { id: 'operations', label: 'Operations', name: 'Relay', role: 'Operations Lead', responsibility: 'Own recurring operations, handoffs, and blocker resolution.' },
  { id: 'custom', label: 'Custom', name: '', role: '', responsibility: '' },
]

function stateLabel(state: OrganizationalAgent['workState']) {
  return ({ idle: 'Available', working: 'Working', waiting: 'Waiting', needs_approval: 'Needs approval', blocked: 'Blocked', failed: 'Failed', complete: 'Complete' } as const)[state]
}

/** One vocabulary for work status, shared by the rail, the work row and the timeline. */
const workStatusLabel: Record<AgentWorkStatus, string> = {
  queued: 'Queued', preparing: 'Preparing', working: 'Working', waiting_user: 'Waiting for you',
  needs_approval: 'Needs approval', blocked: 'Blocked', provider_limit: 'Paused · provider limit',
  verifying: 'Verifying', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}
const liveWorkStatuses: AgentWorkStatus[] = ['queued', 'preparing', 'working', 'waiting_user', 'needs_approval', 'verifying']

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function AgentModeSurface({ visible, project, workspace, onOpenCode }: { visible: boolean; project: Project; workspace: Workspace; onOpenCode: (target: AgentWork | { workspaceId?: string }) => void }) {
  const snapshot = useAgentModeStore((state) => state.snapshot)
  const hydrated = useAgentModeStore((state) => state.hydrated)
  const busy = useAgentModeStore((state) => state.busy)
  const error = useAgentModeStore((state) => state.error)
  const hydrate = useAgentModeStore((state) => state.hydrate)
  const selectAgent = useAgentModeStore((state) => state.selectAgent)
  const setPinned = useAgentModeStore((state) => state.setPinned)
  const reorderAgents = useAgentModeStore((state) => state.reorderAgents)
  const [creating, setCreating] = useState(false)
  const [dragging, setDragging] = useState<string>()

  useEffect(() => { void hydrate() }, [hydrate])
  const selected = snapshot.agents.find((agent) => agent.id === snapshot.productState.selectedAgentId) ?? snapshot.agents[0]
  useEffect(() => { if (hydrated && !snapshot.productState.selectedAgentId && snapshot.agents[0]) selectAgent(snapshot.agents[0].id) }, [hydrated, selectAgent, snapshot.agents, snapshot.productState.selectedAgentId])

  const moveBefore = (targetId: string) => {
    if (!dragging || dragging === targetId) return
    const ordered = snapshot.agents.map((agent) => agent.id).filter((id) => id !== dragging)
    ordered.splice(ordered.indexOf(targetId), 0, dragging)
    setDragging(undefined); void reorderAgents(ordered)
  }

  return <section className={`agent-mode-overlay ${visible ? 'is-visible' : ''}`} aria-hidden={!visible} inert={!visible ? true : undefined}>
    <aside className="agent-rail" aria-label="Team roster">
      <header><span>TEAM</span><button type="button" onClick={() => setCreating(true)} aria-label="New agent" title="New teammate"><Plus size={14} /></button></header>
      <div className="agent-roster">
        {(['pinned', 'team'] as const).map((group) => {
          const agents = snapshot.agents.filter((agent) => group === 'pinned' ? agent.pinned : !agent.pinned)
          if (!agents.length) return null
          return <section key={group}><h2>{group.toUpperCase()}</h2>{agents.map((agent) => <div key={agent.id} className={`agent-row ${selected?.id === agent.id ? 'is-selected' : ''}`} draggable onDragStart={() => setDragging(agent.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveBefore(agent.id)}>
            <GripVertical className="agent-row-grip" size={12} />
            <button type="button" className="agent-row-main" onClick={() => selectAgent(agent.id)}>
              <AgentAvatar agent={agent} size={24} />
              <span className="agent-row-copy"><strong>{agent.name}</strong><small>{agent.workState === 'idle' ? agent.role : agent.workStateDetail ?? stateLabel(agent.workState)}</small></span>
              {agent.workState !== 'idle' && <i className={`agent-state-dot is-${agent.workState}`} title={stateLabel(agent.workState)} />}
            </button>
            <button type="button" className="agent-pin" aria-label={agent.pinned ? `Unpin ${agent.name}` : `Pin ${agent.name}`} onClick={() => void setPinned(agent.id, !agent.pinned)}><Pin size={12} fill={agent.pinned ? 'currentColor' : 'none'} /></button>
          </div>)}</section>
        })}
        {hydrated && snapshot.agents.length === 0 && <p className="agent-rail-empty">Your teammates will appear here.</p>}
      </div>
      <button type="button" className="agent-new-row" onClick={() => setCreating(true)}><Plus size={13} /> New teammate</button>
    </aside>
    <main className="agent-workspace">
      {!hydrated ? <div className="agent-loading" aria-label="Loading team"><span /><span /><span /></div>
        : creating ? <CreateAgent project={project} workspace={workspace} onClose={() => setCreating(false)} />
        : !selected ? <AgentOnboarding onCreate={(template) => { setCreating(true); sessionStorage.setItem('paralith-agent-template', template) }} />
        : <AgentPage agent={selected} project={project} workspace={workspace} visible={visible} onOpenCode={onOpenCode} />}
      {error && <div className="agent-error" role="alert"><span>{error}</span><button type="button" onClick={useAgentModeStore.getState().clearError} aria-label="Dismiss"><X size={13} /></button></div>}
      {busy && <div className="agent-busy-line" />}
    </main>
  </section>
}

function AgentOnboarding({ onCreate }: { onCreate: (template: Template) => void }) {
  return <section className="agent-onboarding"><div className="agent-onboarding-mark">P</div><h1>Build your team.</h1><p>Persistent teammates can own responsibilities and execute work across Paralith.</p><div><button type="button" className="agent-primary" onClick={() => onCreate('chief')}>Create Chief of Staff</button><button type="button" className="agent-text-button" onClick={() => onCreate('custom')}>Create another role</button></div></section>
}

function CreateAgent({ project, workspace, onClose }: { project: Project; workspace: Workspace; onClose: () => void }) {
  const initial = (sessionStorage.getItem('paralith-agent-template') as Template | null) ?? 'chief'
  sessionStorage.removeItem('paralith-agent-template')
  const [stage, setStage] = useState<'prompt' | 'review'>('prompt')
  const [template, setTemplate] = useState<Template>(initial)
  const [ownership, setOwnership] = useState(templates.find((item) => item.id === initial)?.responsibility ?? '')
  const [draft, setDraft] = useState<CreateOrganizationalAgentInput>(() => suggestion(initial, ownership, project, workspace))
  const createAgent = useAgentModeStore((state) => state.createAgent)
  const busy = useAgentModeStore((state) => state.busy)

  const continueToReview = () => { setDraft(suggestion(template, ownership, project, workspace)); setStage('review') }
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await createAgent(draft); onClose() } catch { /* inline store error */ } }
  if (stage === 'prompt') return <section className="agent-create"><header><button type="button" onClick={onClose}><ChevronLeft size={14} /> Team</button><span>NEW TEAMMATE</span></header><div className="agent-create-body"><h1>What should this person own?</h1><p>Describe the outcome in plain language. You can review every field before creation.</p><textarea autoFocus rows={5} value={ownership} onChange={(event) => setOwnership(event.target.value)} placeholder="Manage our products and turn ideas into clear implementation plans." /><div className="agent-template-list">{templates.map((item) => <button type="button" key={item.id} className={template === item.id ? 'is-selected' : ''} onClick={() => { setTemplate(item.id); if (item.responsibility) setOwnership(item.responsibility) }}>{item.label}</button>)}</div><div className="agent-form-actions"><button type="button" className="agent-primary" disabled={!ownership.trim()} onClick={continueToReview}>Review teammate</button></div></div></section>
  return <form className="agent-create" onSubmit={submit}><header><button type="button" onClick={() => setStage('prompt')}><ChevronLeft size={14} /> Responsibility</button><span>REVIEW TEAMMATE</span></header><div className="agent-create-body agent-review-grid"><label><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label><label><span>Role</span><input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} required /></label><label className="is-wide"><span>Brief</span><textarea rows={4} value={draft.brief} onChange={(e) => setDraft({ ...draft, brief: e.target.value })} required /></label><label><span>Intelligence</span><select value={draft.intelligencePreference} onChange={(e) => setDraft({ ...draft, intelligencePreference: e.target.value })}><option value="automatic">Automatic</option><option value="claude">Prefer Claude</option><option value="codex">Prefer Codex</option></select><small>A default only. Any conversation or message can use another runtime.</small></label><label><span>{project.name} access</span><select value={draft.projectAccess} onChange={(e) => setDraft({ ...draft, projectAccess: e.target.value as CreateOrganizationalAgentInput['projectAccess'] })}><option value="none">None</option><option value="read">Read</option><option value="read_write">Read / write</option></select><small>Service connection and teammate access remain separate.</small></label><div className="agent-form-actions is-wide"><button type="button" className="agent-text-button" onClick={onClose}>Cancel</button><button type="submit" className="agent-primary" disabled={busy}>{busy ? 'Creating…' : 'Create teammate'}</button></div></div></form>
}

function suggestion(templateId: Template, ownership: string, project: Project, workspace: Workspace): CreateOrganizationalAgentInput {
  const lower = ownership.toLowerCase()
  const inferred: Template = templateId !== 'custom' ? templateId
    : /engineer|implement|code|repository|tests?/.test(lower) ? 'engineering'
      : /product|roadmap|requirements?|ideas?/.test(lower) ? 'product'
        : /research|investigate|sources?/.test(lower) ? 'research'
          : /finance|budget|revenue|cost/.test(lower) ? 'finance'
            : /operations?|process|handoff/.test(lower) ? 'operations'
              : /coordinate|priorit|delegate|company/.test(lower) ? 'chief' : 'custom'
  const selected = templates.find((item) => item.id === inferred) ?? templates[6]
  const role = selected.role || 'Team specialist'
  return { name: selected.name || 'New teammate', role, brief: ownership.trim(), responsibilities: ownership.trim() ? [ownership.trim()] : [], intelligencePreference: 'automatic', projectId: project.id, workspaceId: workspace.id, projectAccess: inferred === 'engineering' ? 'read_write' : 'none' }
}

function AgentPage({ agent, project, workspace, visible, onOpenCode }: { agent: OrganizationalAgent; project: Project; workspace: Workspace; visible: boolean; onOpenCode: (target: AgentWork | { workspaceId?: string }) => void }) {
  const snapshot = useAgentModeStore((state) => state.snapshot)
  const selectConversation = useAgentModeStore((state) => state.selectConversation)
  const createConversation = useAgentModeStore((state) => state.createConversation)
  const reorderConversations = useAgentModeStore((state) => state.reorderConversations)
  const [delegating, setDelegating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draggingConversation, setDraggingConversation] = useState<string>()
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyResults, setHistoryResults] = useState<AgentConversationEntry[]>()
  const [historyError, setHistoryError] = useState<string>()
  const conversations = useMemo(() => snapshot.conversations.filter((item) => item.agentId === agent.id && (!item.projectId || item.projectId === project.id)).sort((a, b) => a.position - b.position), [agent.id, project.id, snapshot.conversations])
  const activeConversation = conversations.find((item) => item.id === snapshot.productState.selectedConversationId) ?? conversations[0]
  const entries = snapshot.entries.filter((item) => item.conversationId === activeConversation?.id)
  const assigned = snapshot.delegations.filter((item) => item.ownerAgentId === agent.id || item.recipientAgentId === agent.id)
  const approvals = useAgentModeStore((state) => state.approvals).filter((item) => item.agentId === agent.id)
  const moveConversationBefore = (targetId: string) => { if (!draggingConversation || draggingConversation === targetId) return; const ordered = conversations.map((item) => item.id).filter((id) => id !== draggingConversation); ordered.splice(ordered.indexOf(targetId), 0, draggingConversation); setDraggingConversation(undefined); void reorderConversations(agent.id, ordered) }
  const searchHistory = async (event: FormEvent) => {
    event.preventDefault()
    const query = historyQuery.trim()
    if (!query) { setHistoryResults(undefined); setHistoryError(undefined); return }
    setHistoryError(undefined)
    try { setHistoryResults(await native.searchAgentHistory(agent.id, project.id, query)) }
    catch (caught) { setHistoryResults(undefined); setHistoryError(asNativeError(caught).message) }
  }

  // Follow a streaming answer, but only while the reader is already at the end. Scrolling back to
  // re-read something must not be yanked forward by the next token.
  const transcript = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const lastEntry = entries[entries.length - 1]
  useEffect(() => {
    const element = transcript.current
    if (!element || !pinned.current) return
    element.scrollTop = element.scrollHeight
  }, [entries.length, lastEntry?.body, lastEntry?.state, activeConversation?.id])

  useEffect(() => {
    if (activeConversation && activeConversation.id !== snapshot.productState.selectedConversationId) {
      selectConversation(activeConversation.id)
    }
  }, [activeConversation, selectConversation, snapshot.productState.selectedConversationId])

  // Alt+Up / Alt+Down move between this teammate's conversations. Alt keeps it clear of both the
  // Code surface's Ctrl shortcuts and a terminal's own key handling.
  useEffect(() => {
    if (!visible || conversations.length < 2) return
    const handle = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      const index = conversations.findIndex((item) => item.id === activeConversation?.id)
      const delta = event.key === 'ArrowDown' ? 1 : -1
      selectConversation(conversations[(index + delta + conversations.length) % conversations.length].id)
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [activeConversation?.id, conversations, selectConversation, visible])

  return <section className="agent-page">
    <header className="agent-page-header">
      <AgentAvatar agent={agent} size={38} />
      <div className="agent-page-identity">
        <h1>{agent.name}</h1>
        <p>{agent.role}</p>
      </div>
      <span className={`agent-work-state is-${agent.workState}`}><i />{agent.workStateDetail ?? stateLabel(agent.workState)}</span>
      <form className="agent-history-search" onSubmit={(event) => void searchHistory(event)}><Search size={13} /><input value={historyQuery} onChange={(event) => { setHistoryQuery(event.target.value); if (!event.target.value) setHistoryResults(undefined) }} placeholder="Search history" aria-label={`Search ${agent.name}'s history`} /></form>
      <button type="button" className="agent-header-action" onClick={() => setDelegating(true)}>Delegate work</button>
      <button type="button" className="agent-header-icon" aria-label={`${agent.name} settings`} title="Access, Skills and Routines" onClick={() => setSettingsOpen(true)}><MoreHorizontal size={15} /></button>
    </header>
    <nav className="agent-chat-tabs" aria-label={`${agent.name} conversations`}>{conversations.map((conversation) => <button type="button" draggable key={conversation.id} className={activeConversation?.id === conversation.id ? 'is-selected' : ''} onDragStart={() => setDraggingConversation(conversation.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveConversationBefore(conversation.id)} onClick={() => selectConversation(conversation.id)}>{conversation.title}</button>)}<button type="button" className="agent-chat-new" aria-label="New conversation" title="New conversation" onClick={() => void createConversation(agent.id, project.id, `Conversation ${conversations.length + 1}`)}><Plus size={13} /></button></nav>
    <div className="agent-conversation">
      <div
        className="agent-transcript"
        ref={transcript}
        onScroll={(event) => {
          const element = event.currentTarget
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
        }}
      >
        <div className="agent-thread">
          {historyError && <p className="agent-history-error" role="alert">History search failed: {historyError}</p>}
          {historyResults
            ? <><div className="agent-history-heading"><strong>History results</strong><span>{historyResults.length} match{historyResults.length === 1 ? '' : 'es'} across {agent.name}'s conversations</span></div>{historyResults.map((entry) => <div className="agent-history-result" key={entry.id}><Message entry={entry} agent={agent} showDate /><button type="button" onClick={() => { setHistoryResults(undefined); setHistoryQuery(''); selectConversation(entry.conversationId) }}>Open conversation</button></div>)}</>
            : <>
              {entries.length === 0 && <ConversationStarter agent={agent} project={project} delegations={assigned.length} />}
              {entries.map((entry) => <Message key={entry.id} entry={entry} agent={agent} />)}
              {assigned.map((delegation) => {
                const work = snapshot.work.find((item) => item.delegationId === delegation.id)
                return work
                  ? <WorkRow key={delegation.id} work={work} owner={snapshot.agents.find((item) => item.id === delegation.ownerAgentId)?.name} recipient={snapshot.agents.find((item) => item.id === delegation.recipientAgentId)?.name} onOpenCode={onOpenCode} />
                  : <article key={delegation.id} className="agent-event-row is-delegation">
                    <span className="agent-event-mark" aria-hidden />
                    <div>
                      <p><strong>{snapshot.agents.find((item) => item.id === delegation.ownerAgentId)?.name} → {snapshot.agents.find((item) => item.id === delegation.recipientAgentId)?.name}</strong> · {delegation.status.replace('_', ' ')} · not executed</p>
                      <p className="agent-event-detail">{delegation.objective}</p>
                    </div>
                    {delegation.statusReason && <span className="agent-work-reason">{delegation.statusReason}</span>}
                  </article>
              })}
              {/* Work with no delegation: assigned to this teammate directly, or by a Routine. */}
              {snapshot.work.filter((item) => item.agentId === agent.id && !item.delegationId).map((work) =>
                <WorkRow key={work.id} work={work} recipient={agent.name} onOpenCode={onOpenCode} />)}
              {/* Anything this teammate's work has stopped in front of. Read from the backend, so
                  a decision pending since before the last restart is still here. */}
              {approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} />)}
            </>}
        </div>
      </div>
      {activeConversation && <Composer agent={agent} conversationId={activeConversation.id} conversationRuntime={activeConversation.runtimePreference} projectId={project.id} entries={entries} visible={visible} />}
    </div>
    {delegating && <DelegationPanel owner={agent} project={project} workspace={workspace} conversationId={activeConversation?.id} onClose={() => setDelegating(false)} />}
    {settingsOpen && <AgentSettingsPanel agent={agent} project={project} onClose={() => setSettingsOpen(false)} />}
  </section>
}

/**
 * A newly created teammate has an empty conversation and an enormous canvas. This fills it with
 * the little that is actually true right now — the teammate's own brief and what they own — and
 * nothing invented. It scrolls away as soon as there is a conversation to read; it is not a
 * dashboard and never gains metrics.
 */
function ConversationStarter({ agent, project, delegations }: { agent: OrganizationalAgent; project: Project; delegations: number }) {
  return <section className="agent-starter">
    <h2>{agent.name} is your {agent.role.toLowerCase()}.</h2>
    {agent.brief && <p className="agent-starter-brief">{agent.brief}</p>}
    {agent.responsibilities.length > 0 && <ul>{agent.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>}
    <dl className="agent-starter-facts">
      <div><dt>Project</dt><dd>{project.name}</dd></div>
      <div><dt>State</dt><dd>{stateLabel(agent.workState)}</dd></div>
      <div><dt>Delegations</dt><dd>{delegations === 0 ? 'None yet' : `${delegations} recorded`}</dd></div>
    </dl>
  </section>
}

/**
 * One unit of real work in the thread.
 *
 * Everything shown here comes from canonical work state — the status, the runtime that took it,
 * the result and the timeline are all read from the Run, never guessed from what the UI last did.
 * The detail stays closed by default: a conversation should read as a conversation, and the
 * evidence is one click away rather than in the way.
 */
function WorkRow({ work, owner, recipient, onOpenCode }: { work: AgentWork; owner?: string; recipient?: string; onOpenCode: (target: AgentWork) => void }) {
  const runtimes = useAgentModeStore((state) => state.runtimes)
  const events = useAgentModeStore((state) => state.workEvents[work.id])
  const cancelWork = useAgentModeStore((state) => state.cancelWork)
  const continueWork = useAgentModeStore((state) => state.continueWork)
  const loadWorkEvents = useAgentModeStore((state) => state.loadWorkEvents)
  const [open, setOpen] = useState(false)
  const live = liveWorkStatuses.includes(work.status)
  const runtime = work.providerId ? runtimes.find((item) => item.providerId === work.providerId && item.modelId === work.modelId) : undefined
  // Only a genuinely connected alternative is offered. A quota stop must never become a silent
  // switch to something the user has not signed in to, or to a billable API.
  const alternative = work.status === 'provider_limit'
    ? runtimes.find((item) => item.available && (item.providerId !== work.providerId || item.modelId !== work.modelId))
    : work.status === 'interrupted'
      ? runtimes.find((item) => item.available && (item.providerId !== work.providerId || item.modelId !== work.modelId)) ?? runtimes.find((item) => item.available)
      : undefined

  const toggle = () => { setOpen((value) => { if (!value && !events) void loadWorkEvents(work.id); return !value }) }

  return <article className={`agent-work-row is-${work.status}`}>
    <span className={`agent-work-mark ${live ? 'is-live' : ''}`} aria-hidden />
    <div className="agent-work-body">
      <p className="agent-work-heading">
        <strong>{owner ? `${owner} → ${recipient}` : recipient}</strong>
        <span className="agent-work-status">{workStatusLabel[work.status]}</span>
        {runtime && <span className="agent-provenance" title={`Running on ${runtime.providerName} ${runtime.displayName}`}>{runtime.providerName} {runtime.displayName}</span>}
      </p>
      <p className="agent-event-detail">{work.objective}</p>
      {work.resultSummary && <p className="agent-work-result">{work.resultSummary}</p>}
      {work.statusReason && work.status !== 'working' && <p className="agent-work-reason">{work.statusReason}</p>}
      {work.status === 'completed' && !work.authority.commit && !work.authority.commitRequiresApproval && <p className="agent-work-boundary">No commit or push was performed.</p>}
      {work.status === 'needs_approval' && <p className="agent-work-boundary">Finished and waiting on your decision below.</p>}
      {open && <ol className="agent-work-timeline">
        {events === undefined ? <li>Loading evidence…</li>
          : events.length === 0 ? <li>No steps were recorded.</li>
            : events.map((event) => <li key={event.id} className={`is-${event.level}`}><time>{timeOf(event.createdAt)}</time><span>{event.summary}</span></li>)}
      </ol>}
    </div>
    <div className="agent-work-actions">
      {live && <button type="button" className="agent-event-action" onClick={() => void cancelWork(work.id)}><Square size={10} /> Stop</button>}
      {alternative && <button type="button" className="agent-event-action is-primary" onClick={() => void continueWork(work.id, alternative.id)}>Continue on {alternative.providerName}</button>}
      <button type="button" className="agent-event-action" aria-expanded={open} onClick={toggle}>{open ? 'Hide evidence' : 'Evidence'}</button>
      {work.executionWorkspaceId && <button type="button" className="agent-event-action" onClick={() => onOpenCode(work)}>Open in Code <ArrowUpRight size={12} /></button>}
    </div>
  </article>
}

/**
 * One row in the thread. Human and Agent turns read as conversation; everything else — a join, a
 * delegation, a runtime transition — is a compact timeline event, visually secondary, so the
 * transcript does not become a wall of bordered cards.
 */
function Message({ entry, agent, showDate }: { entry: AgentConversationEntry; agent: OrganizationalAgent; showDate?: boolean }) {
  const cancelTurn = useAgentModeStore((state) => state.cancelTurn)
  // A delegated result is written into the *delegating* Agent's conversation by the teammate who
  // did the work, so the row is attributed to its author rather than to whoever owns the page.
  const author = useAgentModeStore((state) => entry.authorAgentId && entry.authorAgentId !== agent.id
    ? state.snapshot.agents.find((item) => item.id === entry.authorAgentId)?.name
    : undefined)
  if (entry.kind === 'event') {
    return <article className="agent-event-row"><span className="agent-event-mark" aria-hidden /><div><p>{entry.body}</p></div><time>{timeOf(entry.createdAt)}</time></article>
  }
  const pending = entry.state === 'preparing' || entry.state === 'streaming'
  const provenance = entry.runtimeProvider ? [entry.runtimeProvider, entry.runtimeModel].filter(Boolean).join(' ') : undefined
  return <article className={`agent-message is-${entry.kind} state-${entry.state}`}>
    <header>
      <strong>{entry.kind === 'user' ? 'You' : author ?? agent.name}</strong>
      <time>{showDate ? new Date(entry.createdAt).toLocaleDateString() : timeOf(entry.createdAt)}</time>
      {provenance && !pending && <span className="agent-provenance" title={`Answered on ${provenance}`}>{provenance}</span>}
      {pending && <span className="agent-turn-status">{entry.state === 'preparing' ? 'Preparing…' : 'Responding…'}</span>}
      {pending && <button type="button" className="agent-turn-stop" onClick={() => void cancelTurn(entry.id)} aria-label="Stop this response"><Square size={10} /> Stop</button>}
    </header>
    {entry.body ? <MessageBody body={entry.body} /> : pending ? <p className="agent-turn-placeholder"><span /><span /><span /></p> : null}
    {entry.state === 'blocked' && <p className="agent-turn-blocked">Runtime limit reached — choose another connected runtime in the composer to continue.</p>}
    {entry.state === 'failed' && <p className="agent-turn-failed">{entry.errorCode === 'interrupted' ? 'Interrupted when Paralith closed.' : 'This turn did not complete.'}</p>}
  </article>
}

function MessageBody({ body }: { body: string }) {
  return <div className="agent-message-body">{body.split('```').map((block, index) => {
    if (index % 2 === 1) {
      const [first, ...rest] = block.replace(/^\n/, '').split('\n')
      const hasLanguage = /^[a-z0-9_+#.-]+$/i.test(first.trim()) && rest.length > 0
      return <pre key={index} data-language={hasLanguage ? first.trim() : undefined}><code>{hasLanguage ? rest.join('\n').replace(/\n$/, '') : block.trim()}</code></pre>
    }
    return block.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).map((paragraph, paragraphIndex) => <p key={`${index}-${paragraphIndex}`}>{paragraph.split('`').map((part, partIndex) => partIndex % 2 ? <code key={partIndex}>{part}</code> : part)}</p>)
  })}</div>
}

function Composer({ agent, conversationId, conversationRuntime, projectId, entries, visible }: { agent: OrganizationalAgent; conversationId: string; conversationRuntime?: string; projectId: string; entries: AgentConversationEntry[]; visible: boolean }) {
  const runtimes = useAgentModeStore((state) => state.runtimes)
  const messageRuntime = useAgentModeStore((state) => state.messageRuntime[conversationId])
  const sendMessage = useAgentModeStore((state) => state.sendMessage)
  const setMessageRuntime = useAgentModeStore((state) => state.setMessageRuntime)
  const setConversationRuntime = useAgentModeStore((state) => state.setConversationRuntime)
  const loadRuntimes = useAgentModeStore((state) => state.loadRuntimes)
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<AgentMessageAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string>()
  const [picking, setPicking] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const attachmentField = useRef<HTMLInputElement>(null)
  const streaming = entries.some((entry) => entry.state === 'preparing' || entry.state === 'streaming')
  const runtime = composerRuntimeLabel(runtimes, messageRuntime, conversationRuntime, agent.intelligencePreference)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const body = message.trim()
    if (!body || streaming) return
    setMessage('')
    const selectedAttachments = attachments
    setAttachments([])
    void sendMessage(conversationId, body, projectId, selectedAttachments)
  }

  const attachFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setAttachmentError(undefined)
    const available = Math.max(0, 5 - attachments.length)
    const selected = Array.from(files).slice(0, available)
    try {
      const next = await Promise.all(selected.map(async (file) => {
        if (file.size > 64 * 1024) throw new Error(`${file.name} is larger than 64 KiB.`)
        const content = await file.text()
        if (!content.trim()) throw new Error(`${file.name} has no readable text.`)
        return { name: file.name, mediaType: file.type || 'text/plain', content, size: file.size }
      }))
      const total = [...attachments, ...next].reduce((sum, item) => sum + item.size, 0)
      if (total > 128 * 1024) throw new Error('Attachments may contain at most 128 KiB in total.')
      setAttachments((current) => [...current, ...next])
    } catch (caught) {
      setAttachmentError(caught instanceof Error ? caught.message : 'The selected file could not be attached.')
    } finally {
      if (attachmentField.current) attachmentField.current.value = ''
    }
  }

  // Ctrl+L focuses the composer and Ctrl+Shift+I opens the intelligence picker. Both are bound
  // only while Agent Mode is the visible surface, so neither reaches a terminal in Code Mode.
  useEffect(() => {
    if (!visible) return
    const handle = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      if (event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault(); void loadRuntimes(true); setPicking((value) => !value); return
      }
      if (!event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); field.current?.focus() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [loadRuntimes, visible])

  return <form className="agent-composer" onSubmit={submit}>
    <input ref={attachmentField} className="agent-attachment-input" type="file" multiple accept="text/*,.md,.json,.yaml,.yml,.toml,.csv,.xml,.html,.css,.js,.jsx,.ts,.tsx,.rs,.py,.go,.java,.kt,.swift,.sql,.sh,.ps1" onChange={(event) => void attachFiles(event.target.files)} />
    {attachments.length > 0 && <ul className="agent-attachments" aria-label="Attached files">{attachments.map((attachment, index) => <li key={`${attachment.name}-${index}`}><Paperclip size={11} /><span>{attachment.name}</span><small>{Math.ceil(attachment.size / 1024)} KiB</small><button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${attachment.name}`}><X size={11} /></button></li>)}</ul>}
    {attachmentError && <p className="agent-attachment-error" role="alert">{attachmentError}</p>}
    <textarea
      ref={field}
      rows={2}
      value={message}
      onChange={(event) => setMessage(event.target.value)}
      placeholder={`Message ${agent.name}…`}
      aria-label={`Message ${agent.name}`}
      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}
    />
    <footer>
      <div className="agent-composer-tools">
        <button type="button" className="agent-composer-icon" title="Attach text files" aria-label="Attach text files" onClick={() => attachmentField.current?.click()}><Paperclip size={14} /></button>
        <span className="agent-composer-scope" title="Context compiled for this turn">{projectId ? 'Project context' : 'No project context'}</span>
      </div>
      <div className="agent-composer-actions">
        <IntelligenceTrigger label={runtime.label} explicit={runtime.explicit} onClick={() => { void loadRuntimes(true); setPicking((value) => !value) }} />
        {streaming
          ? <button type="button" className="agent-send is-stop" onClick={() => { const live = entries.find((entry) => entry.state === 'preparing' || entry.state === 'streaming'); if (live) void useAgentModeStore.getState().cancelTurn(live.id) }} aria-label="Stop response"><Square size={13} /></button>
          : <button type="submit" className="agent-send" disabled={!message.trim()} aria-label="Send message"><Send size={14} /></button>}
      </div>
      <IntelligencePicker
        runtimes={runtimes}
        open={picking}
        messageOverride={messageRuntime}
        conversationPreference={conversationRuntime}
        agentPreference={agent.intelligencePreference}
        onOpenChange={(open) => { setPicking(open); if (!open) field.current?.focus() }}
        onPickMessage={(runtimeId) => setMessageRuntime(conversationId, runtimeId)}
        onPickConversation={(runtimeId) => void setConversationRuntime(conversationId, runtimeId)}
      />
    </footer>
  </form>
}

function DelegationPanel({ owner, project, workspace, conversationId, onClose }: { owner: OrganizationalAgent; project: Project; workspace: Workspace; conversationId?: string; onClose: () => void }) {
  const snapshot = useAgentModeStore((state) => state.snapshot)
  const runtimes = useAgentModeStore((state) => state.runtimes)
  const createDelegation = useAgentModeStore((state) => state.createDelegation)
  const recipients = snapshot.agents.filter((item) => item.id !== owner.id)
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? '')
  const [objective, setObjective] = useState('')
  const [expected, setExpected] = useState('')
  const [constraints, setConstraints] = useState('Do not commit or push.')
  const [linkWorkspace, setLinkWorkspace] = useState(true)
  const [execute, setExecute] = useState(true)
  const [runtimeId, setRuntimeId] = useState('')
  const recipient = recipients.find((item) => item.id === recipientId)
  // Execution needs a Project to run in and a recipient who already has access to it. Saying so
  // before the user commits is better than a delegation that is recorded and then refused.
  const grant = snapshot.authorities.find((item) => item.agentId === recipientId && item.projectId === project.id)
  const executable = linkWorkspace && Boolean(grant)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await createDelegation({
        ownerAgentId: owner.id,
        recipientAgentId: recipientId,
        objective,
        relevantContext: `Originated in ${owner.name}'s Agent workspace.`,
        constraints,
        expectedResult: expected,
        authorityBoundary: linkWorkspace ? `Only approved access to ${project.name}.` : 'No Project access requested.',
        projectId: linkWorkspace ? project.id : undefined,
        workspaceId: linkWorkspace ? workspace.id : undefined,
        execute: execute && executable,
        runtimeId: runtimeId || undefined,
        originConversationId: conversationId,
      })
      onClose()
    } catch { /* inline store error */ }
  }

  return <div className="agent-panel-scrim" onMouseDown={onClose}><form className="agent-delegation-panel" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span>BOUNDED DELEGATION</span><h2>Assign work</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={14} /></button></header>
    {recipients.length === 0 ? <div className="agent-panel-empty"><UserRoundPlus size={18} /><p>Create another teammate before delegating work.</p></div> : <div className="agent-panel-fields">
      <label><span>Recipient</span><select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>{recipients.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} — {agent.role}</option>)}</select></label>
      <label><span>Objective</span><textarea autoFocus rows={4} value={objective} onChange={(e) => setObjective(e.target.value)} required /></label>
      <label><span>Expected result</span><input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="A reviewable implementation and evidence" /></label>
      <label><span>Constraints</span><textarea rows={3} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="Scope, exclusions, approval requirements" /><small>Constraints can only narrow what {recipient?.name ?? 'the recipient'} may do. They never grant access.</small></label>
      <label className="agent-check"><input type="checkbox" checked={linkWorkspace} onChange={(e) => setLinkWorkspace(e.target.checked)} /><span>Associate with {workspace.name}<small>The recipient must already have explicit access.</small></span></label>
      <label className="agent-check"><input type="checkbox" checked={execute && executable} disabled={!executable} onChange={(e) => setExecute(e.target.checked)} /><span>Execute now<small>{executable ? `${recipient?.name ?? 'The recipient'} starts the work immediately and reports the result back here.` : `${recipient?.name ?? 'This teammate'} has no access to ${project.name}. The delegation will be recorded but nothing will run.`}</small></span></label>
      {execute && executable && <label><span>Intelligence</span><select value={runtimeId} onChange={(e) => setRuntimeId(e.target.value)}><option value="">{recipient?.name ?? 'Recipient'} default</option>{runtimes.filter((item) => item.available).map((item) => <option key={item.id} value={item.id}>{item.providerName} {item.displayName}</option>)}</select><small>The runtime answers this work only. It never becomes the teammate&apos;s identity.</small></label>}
      <footer><button type="button" className="agent-text-button" onClick={onClose}>Cancel</button><button type="submit" className="agent-primary" disabled={!recipientId || !objective.trim()}>{execute && executable ? 'Delegate and start' : 'Create delegation'}</button></footer>
    </div>}
  </form></div>
}
