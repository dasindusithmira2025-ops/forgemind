import { useEffect, useState, type CSSProperties } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock3, FolderGit2, FolderOpen, Minus, Plus, RefreshCw, Rocket, Settings2, Sparkles, TerminalSquare, Trash2, Wand2, X } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { native } from '../native/commands'
import type { Project } from '../native/types'
import { relativeTime } from '../shared/layout'
import { assignedCount, regularTerminalCount, remainingCapacity } from '../features/workspace-setup/allocationCompiler'
import { readyAgents } from '../features/workspace-setup/agentRegistry'
import { LAYOUT_OPTIONS, layoutById, type AgentDefinition, type LayoutOption, type SetupStep } from '../features/workspace-setup/setupTypes'
import { stepForPhase, useSetupStore } from '../features/workspace-setup/setupStore'

const STEP_META: Array<{ id: SetupStep; label: string }> = [
  { id: 'start', label: 'Start' },
  { id: 'layout', label: 'Layout' },
  { id: 'agents', label: 'Agents' },
]

export function WorkspaceSetup() {
  const { projectId: routeProjectId = '', workspaceId: routeWorkspaceId } = useParams()
  const [searchParams] = useSearchParams()
  const editWorkspaceId = routeWorkspaceId || searchParams.get('workspaceId') || undefined
  const duplicateWorkspaceId = searchParams.get('duplicate') || undefined
  const mode: 'create' | 'edit' | 'duplicate' = editWorkspaceId ? 'edit' : duplicateWorkspaceId ? 'duplicate' : 'create'
  const navigate = useNavigate()

  const init = useSetupStore((state) => state.init)
  const phase = useSetupStore((state) => state.phase)
  const busy = useSetupStore((state) => state.busy)
  const project = useSetupStore((state) => state.project)
  const error = useSetupStore((state) => state.error)
  const runningWarning = useSetupStore((state) => state.runningWarning)
  const launchedWorkspaceId = useSetupStore((state) => state.launchedWorkspaceId)
  const step = stepForPhase(phase)

  useEffect(() => {
    void init({ projectId: routeProjectId, workspaceId: editWorkspaceId ?? duplicateWorkspaceId, mode })
    // Re-initialise whenever the setup target changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId, editWorkspaceId, duplicateWorkspaceId])

  useEffect(() => {
    if (launchedWorkspaceId) navigate(`/workspace/${launchedWorkspaceId}`)
  }, [launchedWorkspaceId, navigate])

  if (busy) return <div className="setup-loading" aria-label="Preparing workspace setup"><div className="loading-line wide" /><div className="loading-grid">{Array.from({ length: 4 }, (_, i) => <div className="loading-block" key={i} />)}</div></div>
  if (!project) return <main className="centered-error"><ErrorNotice message={error || 'This project could not be loaded.'} /><Button onClick={() => navigate('/')}>Return to launcher</Button></main>

  const back = () => navigate(mode === 'edit' && editWorkspaceId ? `/workspace/${editWorkspaceId}` : '/')

  return <main className="wiz-shell">
    <header className="wiz-topbar">
      <div className="wiz-topbar-left"><Button variant="ghost" icon={<ArrowLeft size={15} />} aria-label="Exit setup" onClick={back} /><Brand compact /><span className="wiz-crumb">Workspace setup<span aria-hidden>/</span><em>{STEP_META.find((meta) => meta.id === step)?.label}</em></span></div>
      <Stepper current={step} />
      <div className="wiz-topbar-right" data-mode={mode}>{mode === 'edit' ? 'Editing workspace' : mode === 'duplicate' ? 'Duplicating' : 'New workspace'}</div>
    </header>

    {runningWarning && <div className="wiz-banner" role="status"><AlertTriangle size={14} /><span>Running terminals keep their current configuration until reopened.</span></div>}
    {error && <div className="wiz-error"><ErrorNotice message={error} /></div>}

    <div className="wiz-scroll">
      {step === 'start' && <StartStep />}
      {step === 'layout' && <LayoutStep />}
      {step === 'agents' && <AgentsStep />}
    </div>
  </main>
}

function Stepper({ current }: { current: SetupStep }) {
  const goToStep = useSetupStore((state) => state.goToStep)
  const currentIndex = STEP_META.findIndex((meta) => meta.id === current)
  return <ol className="wiz-stepper" aria-label="Setup progress">
    {STEP_META.map((meta, index) => {
      const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'todo'
      return <li key={meta.id} className={`wiz-step ${state}`} aria-current={state === 'active' ? 'step' : undefined}>
        <button className="wiz-step-button" disabled={index > currentIndex} onClick={() => goToStep(meta.id)}>
          <span className="wiz-step-dot">{state === 'done' ? <Check size={13} /> : index + 1}</span>
          <span className="wiz-step-label">{meta.label}</span>
        </button>
      </li>
    })}
  </ol>
}

// ---- Step 1: Start -----------------------------------------------------------------------------

function StartStep() {
  const navigate = useNavigate()
  const project = useSetupStore((state) => state.project)!
  const draft = useSetupStore((state) => state.draft)
  const fieldErrors = useSetupStore((state) => state.fieldErrors)
  const setName = useSetupStore((state) => state.setName)
  const next = useSetupStore((state) => state.next)
  const [recents, setRecents] = useState<Project[]>([])
  const [changing, setChanging] = useState(false)

  useEffect(() => { void native.listRecentProjects().then((list) => setRecents(list.filter((item) => item.id !== project.id))).catch(() => undefined) }, [project.id])

  const changeFolder = async () => {
    setChanging(true)
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Open project folder' })
      if (!selected || Array.isArray(selected)) return
      const opened = await native.openProject(selected)
      navigate(`/setup/${opened.id}`)
    } catch { /* validation errors surface on the launcher */ } finally { setChanging(false) }
  }

  return <section className="wiz-panel wiz-start">
    <header className="wiz-head"><h1>Name your workspace</h1><p>Pick the project folder PARALITH will open. You will choose the layout and agents next.</p></header>

    <label className="wiz-field">
      <span className="wiz-label">Workspace name</span>
      <input className="wiz-input" value={draft.workspaceName} autoFocus aria-invalid={Boolean(fieldErrors.name)} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void next() }} placeholder="Main Workspace" />
      {fieldErrors.name && <span className="wiz-field-error">{fieldErrors.name}</span>}
    </label>

    <div className="wiz-field">
      <span className="wiz-label">Project folder</span>
      <div className="wiz-folder-card">
        <span className="wiz-folder-icon"><FolderGit2 size={17} /></span>
        <div className="wiz-folder-meta"><strong>{project.name}</strong><span className="path-text" title={project.rootPath}>{project.rootPath}</span><span className="wiz-folder-facts">{project.gitBranch || 'No branch'} · {project.detectedFramework || project.majorLanguages[0] || 'Local folder'}</span></div>
        <Button variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void changeFolder()} disabled={changing}>Change</Button>
      </div>
    </div>

    {recents.length > 0 && <div className="wiz-field">
      <span className="wiz-label">Recently opened</span>
      <div className="wiz-recent-list">
        {recents.slice(0, 4).map((recent) => <button key={recent.id} className="wiz-recent" onClick={() => navigate(`/setup/${recent.id}`)}>
          <FolderOpen size={14} /><div><strong>{recent.name}</strong><span className="path-text">{recent.rootPath}</span></div><span className="wiz-recent-time"><Clock3 size={11} />{relativeTime(recent.lastOpenedAt)}</span>
        </button>)}
      </div>
    </div>}

    <StartFooter />
  </section>
}

function StartFooter() {
  const phase = useSetupStore((state) => state.phase)
  const next = useSetupStore((state) => state.next)
  const validating = phase === 'VALIDATING_PROJECT'
  return <footer className="wiz-footer">
    <span className="wiz-footer-spacer" />
    <Button variant="primary" icon={<ArrowRight size={15} />} onClick={() => void next()} disabled={validating}>{validating ? 'Checking…' : 'Continue to Layout'}</Button>
  </footer>
}

// ---- Step 2: Layout ----------------------------------------------------------------------------

function LayoutStep() {
  const project = useSetupStore((state) => state.project)!
  const draft = useSetupStore((state) => state.draft)
  const fieldErrors = useSetupStore((state) => state.fieldErrors)
  const presets = useSetupStore((state) => state.presets)
  const setWorkingDirectory = useSetupStore((state) => state.setWorkingDirectory)
  const setStartupCommand = useSetupStore((state) => state.setStartupCommand)
  const selectLayout = useSetupStore((state) => state.selectLayout)
  const loadPreset = useSetupStore((state) => state.loadPreset)
  const savePreset = useSetupStore((state) => state.savePreset)
  const [folderDraft, setFolderDraft] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)
  const selected = layoutById(draft.layoutId)

  const browse = async () => {
    const selectedPath = await open({ directory: true, multiple: false, defaultPath: draft.workingDirectory || project.rootPath, title: 'Choose working folder' })
    if (!selectedPath || Array.isArray(selectedPath)) return
    await setWorkingDirectory(selectedPath)
  }

  return <section className="wiz-panel wiz-layout">
    <header className="wiz-head"><h1>Choose your layout</h1><p>Set the working folder and how many terminals open. Agents get mapped across them in the next step.</p></header>

    <div className="wiz-two-col">
      <label className="wiz-field">
        <span className="wiz-label">Working folder</span>
        <button className="wiz-path-button" onClick={() => void browse()} title={draft.workingDirectory}><FolderOpen size={14} /><span className="path-text">{draft.workingDirectory}</span><span className="wiz-path-hint">Browse</span></button>
        <form onSubmit={(event) => { event.preventDefault(); if (folderDraft.trim()) { void setWorkingDirectory(folderDraft.trim()); setFolderDraft('') } }}>
          <input className="wiz-input" value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} placeholder="Or type a folder path" spellCheck={false} aria-label="Working folder path" />
        </form>
        {fieldErrors.working && <span className="wiz-field-error">{fieldErrors.working}</span>}
      </label>

      <label className="wiz-field">
        <span className="wiz-label">Startup command <span className="wiz-optional">optional</span></span>
        <input className="wiz-input" value={draft.startupCommand ?? ''} onChange={(event) => setStartupCommand(event.target.value)} placeholder="npm run dev" spellCheck={false} />
        <span className="wiz-hint">Runs in the first terminal after launch. It is never executed during setup.</span>
      </label>
    </div>

    <div className="wiz-field">
      <span className="wiz-label">Terminal layout {selected && <span className="wiz-count-pill">{selected.count} terminal{selected.count === 1 ? '' : 's'} · {selected.name}</span>}</span>
      <div className="wiz-layout-grid" role="radiogroup" aria-label="Terminal layout">
        {LAYOUT_OPTIONS.map((option) => <LayoutCard key={option.id} option={option} selected={draft.layoutId === option.id} onSelect={() => selectLayout(option.id)} />)}
      </div>
    </div>

    {presets.length > 0 && <div className="wiz-field">
      <span className="wiz-label"><Sparkles size={13} /> Saved presets</span>
      <div className="wiz-preset-list">{presets.map((preset) => <button key={preset.id} className={`wiz-preset ${preset.layoutId === draft.layoutId ? 'active' : ''}`} onClick={() => loadPreset(preset)}><strong>{preset.name}</strong><span>{preset.terminalCount} terminals{assignedCount(preset.agentAllocations, preset.customCommands) > 0 ? ` · ${assignedCount(preset.agentAllocations, preset.customCommands)} agents` : ''}</span></button>)}</div>
    </div>}

    <div className="wiz-inline-actions"><Button variant="ghost" icon={<Plus size={13} />} onClick={() => setSavingPreset(true)}>Save current as preset</Button></div>

    <LayoutFooter />
    <ReduceDialog />
    {savingPreset && <TextPromptDialog title="Save preset" label="Preset name" initialValue={`${selected?.name ?? 'Layout'} ${draft.terminalCount}`} confirmLabel="Save preset" onClose={() => setSavingPreset(false)} onConfirm={(value) => { savePreset(value); setSavingPreset(false) }} />}
  </section>
}

function LayoutCard({ option, selected, onSelect }: { option: LayoutOption; selected: boolean; onSelect: () => void }) {
  return <button role="radio" aria-checked={selected} aria-label={`${option.count} terminal ${option.name} layout`} className={`wiz-layout-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
    <span className="wiz-layout-preview" style={{ gridTemplateColumns: `repeat(${option.columns}, 1fr)` } as CSSProperties}>{Array.from({ length: option.count }, (_, index) => <i key={index} />)}</span>
    <span className="wiz-layout-name"><strong>{option.count}</strong>{option.name}</span>
  </button>
}

function LayoutFooter() {
  const back = useSetupStore((state) => state.back)
  const next = useSetupStore((state) => state.next)
  const openWithoutAgents = useSetupStore((state) => state.openWithoutAgents)
  const phase = useSetupStore((state) => state.phase)
  const busyLaunch = phase === 'VALIDATING_LAUNCH' || phase === 'LAUNCHING'
  return <footer className="wiz-footer">
    <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={back}>Back</Button>
    <span className="wiz-footer-spacer" />
    <Button variant="secondary" onClick={() => void openWithoutAgents()} disabled={busyLaunch}>{busyLaunch ? 'Opening…' : 'Open without AI'}</Button>
    <Button variant="primary" icon={<ArrowRight size={15} />} onClick={() => void next()} disabled={phase === 'VALIDATING_LAYOUT'}>Next: Add AI Agents</Button>
  </footer>
}

function ReduceDialog() {
  const pendingReduce = useSetupStore((state) => state.pendingReduce)
  const draft = useSetupStore((state) => state.draft)
  const confirmReduce = useSetupStore((state) => state.confirmReduce)
  const cancelReduce = useSetupStore((state) => state.cancelReduce)
  if (!pendingReduce) return null
  const assigned = assignedCount(draft.agentAllocations, draft.customCommands)
  return <div className="wiz-dialog-scrim" role="presentation" onClick={cancelReduce}>
    <div className="wiz-dialog" role="alertdialog" aria-modal aria-label="Resolve allocation" onClick={(event) => event.stopPropagation()}>
      <h2>More agents than terminals</h2>
      <p>Your current setup assigns {assigned} agents, but the selected layout has {pendingReduce.toCount} terminals.</p>
      <div className="wiz-dialog-actions">
        <Button variant="secondary" onClick={cancelReduce}>Return to previous selection</Button>
        <Button variant="primary" onClick={confirmReduce}>Reduce automatically</Button>
      </div>
    </div>
  </div>
}

// ---- Step 3: Agents ----------------------------------------------------------------------------

function AgentsStep() {
  const navigate = useNavigate()
  const draft = useSetupStore((state) => state.draft)
  const registry = useSetupStore((state) => state.registry)
  const discovering = useSetupStore((state) => state.discovering)
  const reduceNotice = useSetupStore((state) => state.reduceNotice)
  const rescan = useSetupStore((state) => state.rescan)
  const incrementAgent = useSetupStore((state) => state.incrementAgent)
  const decrementAgent = useSetupStore((state) => state.decrementAgent)
  const applyOneOfEach = useSetupStore((state) => state.applyOneOfEach)
  const applySplitEvenly = useSetupStore((state) => state.applySplitEvenly)
  const applyFillRemaining = useSetupStore((state) => state.applyFillRemaining)
  const clearAllocations = useSetupStore((state) => state.clearAllocations)
  const [custom, setCustom] = useState(false)

  const assigned = assignedCount(draft.agentAllocations, draft.customCommands)
  const remaining = remainingCapacity(draft.terminalCount, draft.agentAllocations, draft.customCommands)
  const regular = regularTerminalCount(draft.terminalCount, draft.agentAllocations, draft.customCommands)
  const ready = readyAgents(registry)
  const fillTarget = ready.find((agent) => agent.category === 'coding-agent') ?? ready[0]
  const pct = draft.terminalCount > 0 ? Math.round((assigned / draft.terminalCount) * 100) : 0

  return <section className="wiz-panel wiz-agents">
    <header className="wiz-head">
      <div><h1>Add AI coding agents</h1><p>Choose how many instances of each agent launch across your {draft.terminalCount} terminals. Unassigned terminals stay regular shells.</p></div>
      <Button variant="ghost" icon={<RefreshCw className={discovering ? 'is-spinning' : ''} size={14} />} aria-label="Rescan agents" onClick={() => void rescan()} disabled={discovering} />
    </header>

    <div className="wiz-alloc-summary">
      <div className="wiz-alloc-head"><strong>{assigned} / {draft.terminalCount} assigned</strong><span aria-live="polite" role="status">{assigned === 0 ? 'No agents yet' : remaining === 0 ? 'All terminals filled' : `${regular} regular shell${regular === 1 ? '' : 's'}`}</span></div>
      <div className="wiz-progress" role="progressbar" aria-valuemin={0} aria-valuemax={draft.terminalCount} aria-valuenow={assigned}><span style={{ width: `${pct}%` }} /></div>
    </div>

    <div className="wiz-quickfill">
      <Button variant="secondary" icon={<Wand2 size={13} />} onClick={applyOneOfEach} disabled={ready.length === 0}>One of each</Button>
      <Button variant="secondary" onClick={applySplitEvenly} disabled={ready.length === 0}>Split evenly</Button>
      <Button variant="secondary" onClick={() => fillTarget && applyFillRemaining(fillTarget.id)} disabled={!fillTarget || remaining === 0}>{fillTarget ? `Fill with ${fillTarget.name}` : 'Fill remaining'}</Button>
      <Button variant="ghost" icon={<Trash2 size={13} />} onClick={clearAllocations} disabled={assigned === 0}>Clear</Button>
    </div>

    <div className="wiz-agent-grid">
      {registry.map((agent) => <AgentRow key={agent.id} agent={agent} count={draft.agentAllocations[agent.id] ?? 0} canAdd={remaining > 0} onIncrement={() => incrementAgent(agent.id)} onDecrement={() => decrementAgent(agent.id)} onConfigure={() => navigate('/settings')} />)}
    </div>

    <CustomCommands />
    <div className="wiz-inline-actions"><Button variant="ghost" icon={<Plus size={13} />} onClick={() => setCustom(true)}>Add custom command</Button></div>

    {reduceNotice && <p className="wiz-hint" role="status">{reduceNotice}</p>}

    <AgentsFooter />
    {custom && <CustomCommandDialog onClose={() => setCustom(false)} />}
  </section>
}

function AgentRow({ agent, count, canAdd, onIncrement, onDecrement, onConfigure }: { agent: AgentDefinition; count: number; canAdd: boolean; onIncrement: () => void; onDecrement: () => void; onConfigure: () => void }) {
  const atCap = agent.supportsMultipleInstances === false ? count >= 1 : agent.maximumInstances ? count >= agent.maximumInstances : false
  const statusLabel = agent.status === 'checking' ? 'Checking…' : agent.installed ? (agent.version || 'Ready') : agent.status === 'error' ? 'Detection failed' : 'Missing'
  return <div className={`wiz-agent-row ${agent.installed ? '' : 'unavailable'}`}>
    <span className="wiz-agent-icon"><TerminalSquare size={16} /></span>
    <div className="wiz-agent-meta"><strong>{agent.name}</strong><span>{agent.subtitle}{agent.category === 'coding-agent' ? '' : ''}</span></div>
    <span className={`wiz-agent-status ${agent.installed ? 'ready' : ''}`}>{statusLabel}</span>
    {agent.installed
      ? <div className="wiz-stepper-control">
          <button className="wiz-step-btn" aria-label={`Remove one ${agent.name}`} onClick={onDecrement} disabled={count <= 0}><Minus size={14} /></button>
          <span className="wiz-step-count" aria-label={`${agent.name} count`}>{count}</span>
          <button className="wiz-step-btn" aria-label={`Add one ${agent.name}`} onClick={onIncrement} disabled={!canAdd || atCap}><Plus size={14} /></button>
        </div>
      : agent.category === 'coding-agent'
        ? <Button variant="ghost" icon={<Settings2 size={13} />} onClick={onConfigure}>Configure</Button>
        : <span className="wiz-agent-disabled-note">Unavailable</span>}
  </div>
}

function CustomCommands() {
  const draft = useSetupStore((state) => state.draft)
  const changeCustomCount = useSetupStore((state) => state.changeCustomCount)
  const removeCustomCommand = useSetupStore((state) => state.removeCustomCommand)
  const remaining = remainingCapacity(draft.terminalCount, draft.agentAllocations, draft.customCommands)
  if (draft.customCommands.length === 0) return null
  return <div className="wiz-agent-grid">
    {draft.customCommands.map((entry) => <div key={entry.id} className="wiz-agent-row custom">
      <span className="wiz-agent-icon"><TerminalSquare size={16} /></span>
      <div className="wiz-agent-meta"><strong>{entry.label}</strong><span className="path-text">{entry.command}</span></div>
      <span className="wiz-agent-status ready">Custom</span>
      <div className="wiz-stepper-control">
        <button className="wiz-step-btn" aria-label={`Remove one ${entry.label}`} onClick={() => changeCustomCount(entry.id, -1)} disabled={entry.count <= 0}><Minus size={14} /></button>
        <span className="wiz-step-count">{entry.count}</span>
        <button className="wiz-step-btn" aria-label={`Add one ${entry.label}`} onClick={() => changeCustomCount(entry.id, 1)} disabled={remaining <= 0}><Plus size={14} /></button>
      </div>
      <Button variant="ghost" icon={<X size={13} />} aria-label={`Delete ${entry.label}`} onClick={() => removeCustomCommand(entry.id)} />
    </div>)}
  </div>
}

function CustomCommandDialog({ onClose }: { onClose: () => void }) {
  const addCustomCommand = useSetupStore((state) => state.addCustomCommand)
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const submit = () => { if (!command.trim()) return; addCustomCommand({ label, command }); onClose() }
  return <div className="wiz-dialog-scrim" role="presentation" onClick={onClose}>
    <div className="wiz-dialog" role="dialog" aria-modal aria-label="Add custom command" onClick={(event) => event.stopPropagation()}>
      <h2>Add custom command</h2>
      <label className="wiz-field"><span className="wiz-label">Display name</span><input className="wiz-input" autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Dev server" /></label>
      <label className="wiz-field"><span className="wiz-label">Command</span><input className="wiz-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npm run dev" spellCheck={false} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} /></label>
      <p className="wiz-hint">The command runs in your default shell. Secret values are never logged.</p>
      <div className="wiz-dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!command.trim()}>Add command</Button></div>
    </div>
  </div>
}

function AgentsFooter() {
  const draft = useSetupStore((state) => state.draft)
  const phase = useSetupStore((state) => state.phase)
  const back = useSetupStore((state) => state.back)
  const launch = useSetupStore((state) => state.launch)
  const openWithoutAgents = useSetupStore((state) => state.openWithoutAgents)
  const assigned = assignedCount(draft.agentAllocations, draft.customCommands)
  const busyLaunch = phase === 'VALIDATING_LAUNCH' || phase === 'LAUNCHING'
  const label = busyLaunch ? 'Launching…' : assigned > 0 ? `Launch ${draft.terminalCount} terminal${draft.terminalCount === 1 ? '' : 's'}` : 'Launch workspace'
  return <footer className="wiz-footer">
    <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={back} disabled={busyLaunch}>Back</Button>
    <span className="wiz-footer-spacer" />
    <Button variant="secondary" onClick={() => void openWithoutAgents()} disabled={busyLaunch} title="Open regular terminals with no agents">Skip — no agents</Button>
    <Button variant="primary" icon={<Rocket size={15} />} onClick={() => void launch()} disabled={busyLaunch}>{label}</Button>
  </footer>
}
