import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ChevronRight, CircleStop, Code2, Eye,
  FileCode2, GitBranch, ListChecks, MessageSquare, Pause, Play,
  Search, Send, ShieldCheck, SquareTerminal, TestTube2, X,
} from 'lucide-react'
import type { SwarmAgent, SwarmDetail, SwarmRole, SwarmTask } from '../../native/types'
import { asNativeError, native } from '../../native/commands'
import { useSwarmStore } from './swarmStore'
import { SWARM_PHASES, isActiveLifecycle, lifecycleLabel, lifecycleTone, phaseIndex, roleLabel, runtimeLabel } from './swarmPresentation'
import { SwarmRowMenu } from './SwarmRowMenu'

type PrimaryView = 'canvas' | 'chat' | 'activity' | 'work'
type WorkTab = 'overview' | 'tasks' | 'terminals' | 'changes' | 'tests' | 'memory' | 'evidence'
const WORK_TABS: WorkTab[] = ['overview', 'tasks', 'terminals', 'changes', 'tests', 'memory', 'evidence']
const ROLE_COLOR: Record<SwarmRole, string> = { coordinator: '#5794df', builder: '#45aeb1', scout: '#62a86f', reviewer: '#c8994f', debugger: '#cf735c', integrator: '#9276c9' }

export function SwarmOverview({ detail }: { detail: SwarmDetail }) {
  const { swarm, activity, agents, tasks, connections, tests } = detail
  const navigate = useNavigate()
  const pause = useSwarmStore((state) => state.pause)
  const start = useSwarmStore((state) => state.start)
  const resume = useSwarmStore((state) => state.resume)
  const stop = useSwarmStore((state) => state.stop)
  const accept = useSwarmStore((state) => state.accept)
  const resolveDecision = useSwarmStore((state) => state.resolveDecision)
  const message = useSwarmStore((state) => state.message)
  const [view, setView] = useState<PrimaryView>('canvas')
  const [workTab, setWorkTab] = useState<WorkTab>('overview')
  const [selectedAgentId, setSelectedAgentId] = useState<string>()
  const [missionOpen, setMissionOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  const [target, setTarget] = useState('@swarm')
  const [instruction, setInstruction] = useState('')
  const [filter, setFilter] = useState('all')
  const draftRef = useRef({ target, instruction })
  draftRef.current = { target, instruction }
  const active = isActiveLifecycle(swarm.lifecycle)
  const pausing = swarm.lifecycle === 'pausing'
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)
  const selectedTask = tasks.find((task) => task.id === selectedAgent?.currentTaskId)
  const currentPhase = phaseIndex(swarm.phase)
  const determinate = tasks.length > 0 && tasks.every((task) => task.progressDeterminate || ['completed', 'cancelled'].includes(task.status))
  const elapsed = formatElapsed(swarm.startedAt, swarm.completedAt)

  useEffect(() => {
    let active = true
    void native.getSwarmCommandDraft(swarm.projectId, swarm.id).then((draft) => {
      if (!active || !draft) return
      setTarget(draft.target)
      setInstruction(draft.body)
    }).catch((error) => useSwarmStore.setState({ error: asNativeError(error).message }))
    return () => { active = false }
  }, [swarm.id, swarm.projectId])

  useEffect(() => {
    const persist = () => { const draft = draftRef.current; void native.saveSwarmCommandDraft(swarm.projectId, swarm.id, draft.target, draft.instruction).catch((error) => useSwarmStore.setState({ error: asNativeError(error).message })) }
    window.addEventListener('blur', persist)
    return () => { window.removeEventListener('blur', persist); persist() }
  }, [swarm.id, swarm.projectId])

  async function send() {
    const body = instruction.trim()
    if (!body) return
    await message(swarm.id, target, body)
    setInstruction('')
  }

  function openWork(tab: WorkTab) { setWorkTab(tab); setView('work') }
  async function openTerminal(agent: SwarmAgent) {
    if (!agent.terminalSessionId) return
    const workspaceId = await native.focusSwarmAgentTerminal(swarm.projectId, swarm.id, agent.id)
    navigate(`/workspace/${workspaceId}`)
  }

  return (
    <div className="swarm-live-shell">
      <header className="swarm-live-header">
        <div className="swarm-live-identity">
          <span className={`swarm-status-dot tone-${lifecycleTone(swarm.lifecycle)}`} />
          <div><h2>{swarm.name}</h2><button type="button" onClick={() => setMissionOpen(true)}>{compactMission(swarm.mission)} <Eye size={12} /></button></div>
        </div>
        <div className="swarm-live-meta"><span>{lifecycleLabel(swarm.lifecycle)}</span><span>{elapsed}</span><span>{activity.activeAgents} active</span></div>
        <div className="swarm-live-actions">
          {swarm.lifecycle === 'draft' ? <button type="button" className="button button-primary" onClick={() => void start(swarm.id).catch(() => undefined)}><Play size={14} /> Validate &amp; launch</button> : pausing || swarm.lifecycle === 'paused' ? <button type="button" className="button button-secondary" onClick={() => void resume(swarm.id).catch(() => undefined)}><Play size={14} /> {pausing ? 'Cancel pause' : 'Resume'}</button> : active ? <button type="button" className="button button-ghost" onClick={() => void pause(swarm.id).catch(() => undefined)}><Pause size={14} /> Pause</button> : null}
          {(active || swarm.lifecycle === 'paused') && <button type="button" className="button button-ghost" onClick={() => void stop(swarm.id, false).catch(() => undefined)}><CircleStop size={14} /> Stop</button>}
          <div className="swarm-header-overflow"><SwarmRowMenu item={{ swarm, activity }} onOpen={() => undefined} onCreated={(swarmId) => navigate(`/swarms/${swarm.projectId}/${swarmId}`)} /></div>
        </div>
      </header>

      {swarm.lifecycle === 'decision_required' && swarm.decision ? <DecisionPanel detail={detail} onResolve={(choice) => resolveDecision(swarm.id, choice)} /> : null}
      {swarm.lifecycle === 'ready_for_review' ? <div className="swarm-ready-banner"><CheckCircle2 size={17} /><div><strong>Ready for review</strong><span>{detail.reviews.length > 0 ? `${detail.reviews.length} independent Reviewer record${detail.reviews.length === 1 ? '' : 's'} persisted.` : 'Verification finished; human acceptance is still required.'}</span></div><button type="button" className="button button-ghost" onClick={() => openWork('changes')}>Review changes</button><button type="button" className="button button-ghost" onClick={() => { setTarget('@reviewer'); setInstruction('Run an additional manual check and attach the observed evidence.') }}>Run manual check</button><button type="button" className="button button-primary" onClick={() => accept(swarm.id)}>Accept result</button></div> : null}
      {swarm.lifecycle === 'completed' && swarm.summary ? <CompletionStrip detail={detail} onWork={openWork} /> : null}

      <section className="swarm-health-strip">
        <ol>{SWARM_PHASES.map((phase, index) => <li key={phase.key} className={index < currentPhase ? 'is-complete' : index === currentPhase ? 'is-active' : 'is-upcoming'}><span>{index < currentPhase ? '✓' : index + 1}</span><strong>{phase.label}</strong></li>)}</ol>
        <div className="swarm-health-metrics">
          <Metric value={activity.tasksDone} label="completed" />
          <Metric value={activity.tasksRunning} label="active tasks" />
          <Metric value={tasks.filter((task) => ['ready', 'queued', 'claimed'].includes(task.status)).length} label="queued" />
          <Metric value={tests.filter((test) => test.status === 'passed').length} label="tests passing" />
          <Metric value={tasks.filter((task) => task.status === 'blocked').length} label="conflicts" attention />
          <div className="swarm-milestone"><span>Milestone</span><strong>{swarm.currentMilestone ?? lifecycleLabel(swarm.lifecycle)}</strong>{!determinate && active ? <em>progress indeterminate</em> : null}</div>
        </div>
      </section>

      <nav className="swarm-view-tabs" aria-label="Swarm views">
        {(['canvas', 'chat', 'activity', 'work'] as PrimaryView[]).map((item) => <button key={item} type="button" className={view === item ? 'is-active' : ''} onClick={() => setView(item)}>{item === 'canvas' ? <Bot size={14} /> : item === 'chat' ? <MessageSquare size={14} /> : item === 'activity' ? <Activity size={14} /> : <ListChecks size={14} />}{item[0].toUpperCase() + item.slice(1)}</button>)}
      </nav>

      <div className={`swarm-live-body ${railOpen ? 'has-rail' : ''}`}>
        <main className="swarm-primary-surface">
          {view === 'canvas' ? <AgentCanvas agents={agents} tasks={tasks} connections={connections} selectedAgentId={selectedAgentId} onSelect={setSelectedAgentId} onOpenTerminal={(agent) => openTerminal(agent)} /> : null}
          {view === 'chat' ? <ChatView detail={detail} filter={filter} setFilter={setFilter} onAgent={setSelectedAgentId} /> : null}
          {view === 'activity' ? <ActivityView detail={detail} onAgent={setSelectedAgentId} onTask={() => openWork('tasks')} /> : null}
          {view === 'work' ? <WorkView detail={detail} tab={workTab} setTab={setWorkTab} onAgent={setSelectedAgentId} onTerminal={(agent) => openTerminal(agent)} /> : null}
        </main>

        {railOpen ? selectedAgent ? (
          <AgentInspector agent={selectedAgent} task={selectedTask} onClose={() => setSelectedAgentId(undefined)} onMessage={() => setTarget(selectedAgent.id)} onTerminal={() => openTerminal(selectedAgent)} onWork={openWork} />
        ) : (
          <HealthRail detail={detail} onCollapse={() => setRailOpen(false)} onAgent={setSelectedAgentId} onWork={openWork} />
        ) : <button type="button" className="swarm-rail-restore" onClick={() => setRailOpen(true)} aria-label="Open context rail"><ChevronRight size={16} /></button>}
      </div>

      <div className="swarm-command-bar">
        <select value={target} onChange={(event) => { const next = event.target.value; setTarget(next); void native.saveSwarmCommandDraft(swarm.projectId, swarm.id, next, instruction).catch((error) => useSwarmStore.setState({ error: asNativeError(error).message })) }} aria-label="Instruction target">
          <option value="@swarm">@swarm</option><option value="@coordinator">@coordinator</option><option value="@scout">@scout</option><option value="@builders">@builders</option><option value="@debugger">@debugger</option><option value="@reviewer">@reviewer</option><option value="@integrator">@integrator</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>@{agent.displayName.toLowerCase().replace(' ', '-')}</option>)}
        </select>
        <input value={instruction} onChange={(event) => setInstruction(event.target.value)} onBlur={() => void native.saveSwarmCommandDraft(swarm.projectId, swarm.id, target, instruction).catch((error) => useSwarmStore.setState({ error: asNativeError(error).message }))} onKeyDown={(event) => { if (event.key === 'Enter') void send().catch(() => undefined) }} placeholder="Give the team a scoped instruction…" />
        <button type="button" className="button button-secondary" onClick={() => void send().catch(() => undefined)} disabled={!instruction.trim()}><Send size={14} /> Send</button>
      </div>

      {missionOpen ? <div className="swarm-drawer-scrim" onMouseDown={() => setMissionOpen(false)}><aside className="swarm-mission-drawer" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="section-label">Full mission</span><h3>{swarm.name}</h3></div><button type="button" onClick={() => setMissionOpen(false)} aria-label="Close mission"><X size={16} /></button></header><p>{swarm.mission}</p>{swarm.instructions && <><h4>Constraints</h4><p>{swarm.instructions}</p></>}<h4>Safeguards</h4>{swarm.safeguards.map((item) => <div className="swarm-drawer-safeguard" key={item.code}><ShieldCheck size={14} /><div><strong>{item.label}</strong><span>{item.reason}</span></div></div>)}</aside></div> : null}
    </div>
  )
}

function AgentCanvas({ agents, tasks, connections, selectedAgentId, onSelect, onOpenTerminal }: { agents: SwarmAgent[]; tasks: SwarmTask[]; connections: SwarmDetail['connections']; selectedAgentId?: string; onSelect: (id: string) => void; onOpenTerminal: (agent: SwarmAgent) => void }) {
  const positions = useMemo(() => layoutAgents(agents), [agents])
  const visibleConnections = connections.slice(0, 24)
  return <section className="swarm-canvas" aria-label="Live agent canvas">
    {agents.length === 0 ? <div className="swarm-canvas-empty"><Bot size={24} /><strong>The roster will appear when the Swarm starts.</strong><span>No static agents are drawn before backend identities exist.</span></div> : <>
      <svg className="swarm-connections" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden>{visibleConnections.map((edge) => { const from = positions.get(edge.sourceAgentId); const destination = edge.destinationAgentId ? positions.get(edge.destinationAgentId) : undefined; if (!from || !destination) return null; return <g key={edge.id}><line x1={from.x} y1={from.y} x2={destination.x} y2={destination.y} /><circle cx={destination.x} cy={destination.y} r="4" /></g> })}</svg>
      {agents.map((agent) => { const position = positions.get(agent.id)!; const task = tasks.find((item) => item.id === agent.currentTaskId); return <button type="button" key={agent.id} className={`swarm-agent-node role-${agent.role} state-${agent.status} ${selectedAgentId === agent.id ? 'is-selected' : ''}`} style={{ left: `${position.x / 10}%`, top: `${position.y / 6}%`, '--role-color': ROLE_COLOR[agent.role] } as CSSProperties} onClick={() => onSelect(agent.id)} onDoubleClick={() => onOpenTerminal(agent)}>
        <span className="swarm-agent-node-icon"><RoleIcon role={agent.role} /></span><span className="swarm-agent-node-main"><strong>{agent.displayName}</strong><em>{runtimeLabel(agent.runtime)} · {agent.status}</em><span>{task?.title ?? agent.lastResult ?? 'Waiting for runnable work'}</span></span><i aria-label={agent.status} />
      </button> })}
    </>}
    <div className="swarm-canvas-key"><span><i className="is-active" /> Active</span><span><i className="is-waiting" /> Waiting</span><span><i className="is-attention" /> Attention</span></div>
  </section>
}

function ChatView({ detail, filter, setFilter, onAgent }: { detail: SwarmDetail; filter: string; setFilter: (value: string) => void; onAgent: (id: string) => void }) {
  const visible = detail.messages.filter((item) => filter === 'all' || item.sourceAgentId === filter || item.target === `@${filter}` || (filter === 'system' && item.senderKind === 'system'))
  return <section className="swarm-structured-view"><header><div><h3>Engineering communication</h3><p>Assignments, findings, handoffs, review requests, blockers, and results.</p></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All</option><option value="system">System</option>{detail.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</select></header><div className="swarm-message-list">{visible.map((item) => { const agent = detail.agents.find((candidate) => candidate.id === item.sourceAgentId); return <article key={item.id}><span className={`swarm-message-kind kind-${item.category}`}>{item.category}</span><button type="button" disabled={!agent} onClick={() => agent && onAgent(agent.id)}>{agent?.displayName ?? (item.senderKind === 'user' ? 'You' : 'Paralith')}</button><p>{item.body}</p><time>{formatTime(item.createdAt)} · {item.target} · {item.deliveryState}</time></article> })}{visible.length === 0 && <EmptyState title="No communication in this filter" body="Persisted engineering messages will appear here." />}</div></section>
}

function ActivityView({ detail, onAgent, onTask }: { detail: SwarmDetail; onAgent: (id: string) => void; onTask: () => void }) {
  const events = detail.events.filter((event) => !['file_read', 'tool_started', 'tool_completed', 'command_started'].includes(event.kind))
  return <section className="swarm-structured-view"><header><div><h3>Meaningful activity</h3><p>Chronological orchestration events; raw terminal output and routine reads are excluded.</p></div></header><div className="swarm-activity-list">{events.map((event) => <button type="button" key={event.id} onClick={() => event.agentId ? onAgent(event.agentId) : event.taskId ? onTask() : undefined}><span className={`level-${event.level}`} /><time>{formatTime(event.createdAt)}</time><div><strong>{event.summary}</strong><em>{event.role ? roleLabel(event.role).replace(/s$/, '') : 'System'} · {event.kind.replaceAll('_', ' ')}</em></div><ChevronRight size={14} /></button>)}{events.length === 0 && <EmptyState title="No activity yet" body="The scheduler has not persisted any meaningful events." />}</div></section>
}

function WorkView({ detail, tab, setTab, onAgent, onTerminal }: { detail: SwarmDetail; tab: WorkTab; setTab: (tab: WorkTab) => void; onAgent: (id: string) => void; onTerminal: (agent: SwarmAgent) => void }) {
  return <section className="swarm-work-view"><nav>{WORK_TABS.map((item) => <button type="button" key={item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav><div className="swarm-work-content">
    {tab === 'overview' && <div className="swarm-work-overview"><WorkSummary icon={<ListChecks />} label="Tasks" value={`${detail.activity.tasksDone}/${detail.activity.tasksTotal}`} /><WorkSummary icon={<SquareTerminal />} label="Live sessions" value={String(detail.runtimeSessions.filter((session) => session.state === 'running').length)} /><WorkSummary icon={<TestTube2 />} label="Passing tests" value={String(detail.tests.filter((test) => test.status === 'passed').length)} /><WorkSummary icon={<ShieldCheck />} label="Evidence" value={String(detail.evidence.length)} /></div>}
    {tab === 'tasks' && <TaskList detail={detail} onAgent={onAgent} />}
    {tab === 'terminals' && <TerminalList detail={detail} onTerminal={onTerminal} />}
    {tab === 'changes' && <ChangeList detail={detail} />}
    {tab === 'tests' && <TestList detail={detail} />}
    {tab === 'memory' && <MemoryList detail={detail} onAgent={onAgent} />}
    {tab === 'evidence' && <EvidenceList detail={detail} />}
  </div></section>
}

function TaskList({ detail, onAgent }: { detail: SwarmDetail; onAgent: (id: string) => void }) { return <div className="swarm-task-list">{detail.tasks.map((task) => { const agent = detail.agents.find((item) => item.id === task.assignedAgentId); return <article key={task.id}><span className={`task-state state-${task.status}`}>{task.status}</span><div><strong>{task.title}</strong><p>{roleLabel(task.role).replace(/s$/, '')}{task.dependsOn.length ? ` · ${task.dependsOn.length} dependencies` : ''}</p></div><button type="button" disabled={!agent} onClick={() => agent && onAgent(agent.id)}>{agent?.displayName ?? 'Unassigned'}</button><span>{task.progressDeterminate ? `${Math.round(task.progress * 100)}%` : task.status === 'completed' ? 'Complete' : 'In progress'}</span></article> })}{detail.tasks.length === 0 && <EmptyState title="No tasks planned" body="The Coordinator has not persisted the adaptive task graph yet." />}</div> }
function TerminalList({ detail, onTerminal }: { detail: SwarmDetail; onTerminal: (agent: SwarmAgent) => void }) { return <div className="swarm-terminal-list">{detail.runtimeSessions.map((session) => { const agent = detail.agents.find((item) => item.id === session.agentId); const live = session.state === 'running' && agent?.terminalSessionId === session.terminalSessionId; return <article key={session.id}><SquareTerminal size={18} /><div><strong>{agent?.displayName ?? 'Recovered agent session'}</strong><span>{runtimeLabel(session.runtime)} · {session.state}{session.failureClass ? ` · ${session.failureClass.replaceAll('_', ' ')}` : ''}</span><code>{session.workingDirectory}</code></div>{live && agent ? <button type="button" className="button button-secondary" onClick={() => onTerminal(agent)}>Open full terminal</button> : <span className="swarm-terminal-ended">{session.endedAt ? `Ended ${formatTime(session.endedAt)}` : 'Detached'}</span>}</article> })}{detail.runtimeSessions.length === 0 && <EmptyState title="No provider terminals yet" body="Terminals start only when useful runnable work is assigned." />}</div> }
function ChangeList({ detail }: { detail: SwarmDetail }) { const changes = detail.agents.flatMap((agent) => agent.changedFiles.map((path) => ({ agent, path }))); return <div className="swarm-change-list">{changes.map(({ agent, path }) => <article key={`${agent.id}:${path}`}><FileCode2 size={15} /><code>{path}</code><span>{agent.displayName}</span><em>{agent.worktree ?? 'Project root'}</em></article>)}{changes.length === 0 && <EmptyState title="No attributed changes recorded" body="Files appear only after structured runtime file-modified events are persisted." />}</div> }
function TestList({ detail }: { detail: SwarmDetail }) {
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()
  const closed = ['completed', 'failed', 'cancelled', 'archived'].includes(detail.swarm.lifecycle)
  async function followUp(testId: string, repair: boolean) {
    setPending(`${testId}:${repair ? 'fix' : 'retry'}`)
    setError(undefined)
    try {
      if (repair) await native.generateSwarmFixTask(detail.swarm.projectId, detail.swarm.id, testId)
      else await native.retrySwarmTest(detail.swarm.projectId, detail.swarm.id, testId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }
  return <div className="swarm-test-list">
    {error && <p className="swarm-inline-error" role="alert">{error}</p>}
    {detail.tests.map((test) => <article key={test.id}>
      <span className={`test-state state-${test.status}`}>{test.status}</span>
      <div><strong>{test.name}</strong><p>{test.summary}</p>{test.command && <code>{test.command}</code>}</div>
      {!closed && ['failed', 'skipped'].includes(test.status) ? <div className="swarm-test-actions">
        <button type="button" className="button button-ghost" disabled={Boolean(pending)} onClick={() => void followUp(test.id, false)}>{pending === `${test.id}:retry` ? 'Queuing…' : 'Retry'}</button>
        {test.status === 'failed' && <button type="button" className="button button-secondary" disabled={Boolean(pending)} onClick={() => void followUp(test.id, true)}>{pending === `${test.id}:fix` ? 'Creating…' : 'Generate fix task'}</button>}
      </div> : null}
    </article>)}
    {detail.tests.length === 0 && <EmptyState title="No test evidence yet" body="Running and completed checks will appear from persisted runtime events." />}
  </div>
}
function MemoryList({ detail, onAgent }: { detail: SwarmDetail; onAgent: (id: string) => void }) { return <div className="swarm-memory-list">{detail.memories.map((memory) => { const agent = detail.agents.find((item) => item.id === memory.agentId); const task = detail.tasks.find((item) => item.id === memory.taskId); return <article key={memory.id}><div><span>{memory.memoryType} · {memory.state}</span><strong>{memory.title}</strong><p>{memory.summary || memory.context}</p></div><dl><dt>Task</dt><dd>{task?.title ?? memory.taskId}</dd><dt>Agent</dt><dd><button type="button" onClick={() => onAgent(memory.agentId)}>{agent?.displayName ?? memory.agentId}</button></dd><dt>Revision</dt><dd><code>{memory.revisionId.slice(0, 12)}</code> · {Math.round(memory.confidence * 100)}% confidence</dd><dt>Sources</dt><dd>{memory.sourceUris.length || 'No linked sources'}</dd></dl></article> })}{detail.memories.length === 0 && <EmptyState title="No Swarm context packs recorded" body="Project Memory remains isolated to this project. A context pack appears only when a real project Memory revision is loaded into an agent task." />}</div> }
function EvidenceList({ detail }: { detail: SwarmDetail }) { const groups = groupEvidence(detail); return <div className="swarm-evidence-list">{groups.map(([criterion, records]) => <section key={criterion}><h4>{criterion}</h4>{records.map((item) => <article key={item.id}><ShieldCheck size={15} className={item.verified ? 'tone-green' : 'tone-amber'} /><div><strong>{item.title}</strong><p>{item.summary}</p></div><span>{item.evidenceType}</span></article>)}</section>)}{detail.evidence.length === 0 && <EmptyState title="No evidence captured" body="Only real commands, tests, diffs, traces, reviews, and approvals are accepted here." />}</div> }

function AgentInspector({ agent, task, onClose, onMessage, onTerminal, onWork }: { agent: SwarmAgent; task?: SwarmTask; onClose: () => void; onMessage: () => void; onTerminal: () => void; onWork: (tab: WorkTab) => void }) { return <aside className="swarm-context-rail swarm-agent-inspector"><header><div className={`swarm-inspector-avatar role-${agent.role}`}><RoleIcon role={agent.role} /></div><div><span>{roleLabel(agent.role).replace(/s$/, '')}</span><h3>{agent.displayName}</h3><p>{runtimeLabel(agent.runtime)} · {agent.runtimeSessionState}</p></div><button type="button" onClick={onClose} aria-label="Close inspector"><X size={15} /></button></header><section><span>Current task</span><strong>{task?.title ?? 'Waiting for runnable work'}</strong>{task && <p>{task.progressDeterminate ? `${Math.round(task.progress * 100)}%` : 'Progress is indeterminate'}</p>}</section><dl><dt>Status</dt><dd>{agent.status}</dd><dt>Working directory</dt><dd title={agent.workingDirectory ?? ''}>{agent.workingDirectory ?? 'Not started'}</dd><dt>Worktree</dt><dd>{agent.worktree ?? 'Project root'}</dd><dt>Changed files</dt><dd>{agent.changedFiles.length}</dd><dt>Tests</dt><dd>{agent.testProgress.passed} passed · {agent.testProgress.failed} failed</dd><dt>Recovery</dt><dd>{agent.recoveryState}</dd></dl>{agent.currentBlocker && <div className="swarm-inspector-blocker"><AlertTriangle size={14} />{agent.currentBlocker}</div>}<div className="swarm-inspector-actions"><button type="button" onClick={onMessage}><MessageSquare size={14} /> Message</button><button type="button" onClick={onTerminal} disabled={!agent.terminalSessionId}><SquareTerminal size={14} /> Open terminal</button><button type="button" onClick={() => onWork('tasks')}><ListChecks size={14} /> View task</button><button type="button" onClick={() => onWork('changes')}><FileCode2 size={14} /> View changes</button><button type="button" onClick={() => onWork('evidence')}><ShieldCheck size={14} /> View evidence</button></div><section><span>Permissions</span>{agent.permissions.map((permission) => <code key={permission}>{permission.replaceAll('_', ' ')}</code>)}</section></aside> }

function HealthRail({ detail, onCollapse, onAgent, onWork }: { detail: SwarmDetail; onCollapse: () => void; onAgent: (id: string) => void; onWork: (tab: WorkTab) => void }) { return <aside className="swarm-context-rail"><header><div><span>Swarm health</span><h3>{detail.swarm.currentMilestone ?? lifecycleLabel(detail.swarm.lifecycle)}</h3></div><button type="button" onClick={onCollapse} aria-label="Collapse context rail"><X size={15} /></button></header><section><span>Mission</span><p>{compactMission(detail.swarm.mission)}</p></section><section><span>Team</span>{detail.agents.map((agent) => <button className="swarm-rail-agent" type="button" key={agent.id} onClick={() => onAgent(agent.id)}><i style={{ background: ROLE_COLOR[agent.role] }} /><strong>{agent.displayName}</strong><em>{agent.status}</em></button>)}</section><section><span>Work health</span><button className="swarm-rail-link" type="button" onClick={() => onWork('tasks')}>{detail.activity.tasksRunning} active · {detail.activity.tasksDone} completed <ChevronRight size={13} /></button><button className="swarm-rail-link" type="button" onClick={() => onWork('tests')}>{detail.tests.filter((test) => test.status === 'passed').length} tests passing <ChevronRight size={13} /></button><button className="swarm-rail-link" type="button" onClick={() => onWork('evidence')}>{detail.evidence.length} evidence records <ChevronRight size={13} /></button></section><section><span>Recent results</span>{detail.events.filter((event) => event.level === 'result').slice(0, 3).map((event) => <p key={event.id}>{event.summary}</p>)}{detail.events.every((event) => event.level !== 'result') && <p>No results yet.</p>}</section></aside> }

function DecisionPanel({ detail, onResolve }: { detail: SwarmDetail; onResolve: (choice: 'recommended' | 'alternative' | 'stop') => Promise<void> }) { const decision = detail.swarm.decision!; return <div className="swarm-decision-overlay" role="alertdialog" aria-label="Decision required"><AlertTriangle size={18} /><div><span className="section-label">Decision required</span><h3>{decision.problem}</h3><p>{decision.reason}</p><strong>Recommended: {decision.recommended}</strong><details><summary>Technical evidence and alternative</summary><p>{decision.recommendationReasons.join(' ')}</p><p>Alternative: {decision.alternative}</p><button type="button" className="swarm-linkbtn" onClick={() => void onResolve('alternative')}>Continue with alternative</button></details></div><button type="button" className="button button-primary" onClick={() => void onResolve('recommended')}>Continue with recommendation</button><button type="button" className="button button-ghost" onClick={() => void onResolve('stop')}>Stop Swarm</button></div> }
function CompletionStrip({ detail, onWork }: { detail: SwarmDetail; onWork: (tab: WorkTab) => void }) { const summary = detail.swarm.summary!; return <section className="swarm-completion-strip"><CheckCircle2 size={18} /><div><span className="section-label">Accepted result</span><strong>{summary.outcome}</strong><p>{summary.filesChanged} files changed · {summary.testsPassed} tests passed · {summary.scenariosVerified} review scenarios · {summary.unresolvedConflicts} unresolved conflicts</p></div><button type="button" className="button button-secondary" onClick={() => onWork('changes')}>Review changes</button><button type="button" className="button button-secondary" onClick={() => onWork('evidence')}>View evidence</button></section> }
function Metric({ value, label, attention = false }: { value: number; label: string; attention?: boolean }) { return <div className={attention && value > 0 ? 'is-attention' : ''}><strong>{value}</strong><span>{label}</span></div> }
function WorkSummary({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <article>{icon}<span>{label}</span><strong>{value}</strong></article> }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="swarm-empty-state"><Search size={19} /><strong>{title}</strong><p>{body}</p></div> }
function RoleIcon({ role }: { role: SwarmRole }) { if (role === 'builder') return <Code2 size={17} />; if (role === 'reviewer') return <ShieldCheck size={17} />; if (role === 'scout') return <Search size={17} />; if (role === 'debugger') return <AlertTriangle size={17} />; if (role === 'integrator') return <GitBranch size={17} />; return <Bot size={17} /> }
function compactMission(mission: string) { return mission.length > 150 ? `${mission.slice(0, 147)}…` : mission }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
function formatElapsed(start?: string | null, end?: string | null) { if (!start) return 'Not started'; const duration = Math.max(0, Date.parse(end ?? new Date().toISOString()) - Date.parse(start)); const minutes = Math.floor(duration / 60_000); return minutes < 60 ? `${minutes}m elapsed` : `${Math.floor(minutes / 60)}h ${minutes % 60}m` }
function layoutAgents(agents: SwarmAgent[]) { const map = new Map<string, { x: number; y: number }>(); const slots: Record<SwarmRole, Array<{ x: number; y: number }>> = { coordinator: [{ x: 500, y: 275 }], scout: [{ x: 210, y: 165 }, { x: 170, y: 350 }], builder: [{ x: 500, y: 85 }, { x: 760, y: 170 }, { x: 790, y: 365 }, { x: 530, y: 505 }, { x: 265, y: 480 }], reviewer: [{ x: 860, y: 490 }, { x: 900, y: 300 }], debugger: [{ x: 300, y: 285 }, { x: 380, y: 500 }], integrator: [{ x: 700, y: 505 }, { x: 870, y: 105 }] }; const counts = new Map<SwarmRole, number>(); for (const agent of agents) { const index = counts.get(agent.role) ?? 0; const choices = slots[agent.role]; map.set(agent.id, choices[index % choices.length]); counts.set(agent.role, index + 1) } return map }
function groupEvidence(detail: SwarmDetail) { const groups = new Map<string, SwarmDetail['evidence']>(); for (const item of detail.evidence) groups.set(item.criterion, [...(groups.get(item.criterion) ?? []), item]); return [...groups.entries()] }
