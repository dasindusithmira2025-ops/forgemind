import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, ChevronLeft, ChevronRight, FolderGit2, FolderOpen, GripVertical, Plus, RefreshCw, ScanSearch, Search, Sparkles, TerminalSquare, X } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import type { AgentDetectionResult, AgentProvider, LayoutNode, PaneAssignment, Project, ShellProfile, Workspace } from '../native/types'
import { newId, paneIds, preferredShell, providerLabel } from '../shared/layout'
import { useAppStore } from '../stores/appStore'

type Choice = { provider: AgentProvider; name: string; executablePath: string; args: string[]; available: boolean; detail?: string; shellProfileId?: string }
type WizardStep = 'layout' | 'agents'
type LayoutPreset = { id: string; name: string; count: number }

const CODING_PROVIDERS = ['claude', 'codex', 'opencode']
const countOptions = [1, 2, 4, 6, 8, 10, 12]
const gridColumns: Record<number, number> = { 1: 1, 2: 2, 4: 2, 6: 3, 8: 4, 10: 5, 12: 4 }
const PRESET_STORAGE_KEY = 'forgemind.layout-presets'
const defaultPresets: LayoutPreset[] = [
  { id: 'solo', name: 'Solo', count: 1 },
  { id: 'pair', name: 'Pair', count: 2 },
  { id: 'squad', name: 'Squad', count: 4 },
]

function loadPresets(): LayoutPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.filter((item): item is LayoutPreset => typeof item?.name === 'string' && typeof item?.count === 'number')
    }
  } catch { /* ignore malformed storage */ }
  return defaultPresets
}

const gridLabel = (count: number) => (gridColumns[count] ? `${count / gridColumns[count]}×${gridColumns[count]} grid` : `${count} panes`)

export function WorkspaceSetup() {
  const { projectId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const editWorkspaceId = searchParams.get('workspaceId') || undefined
  const duplicateWorkspaceId = searchParams.get('duplicate') || undefined
  // CREATE mints a new workspace; EDIT reconfigures an existing one in place (same id);
  // DUPLICATE copies a layout into a brand-new workspace.
  const mode: 'create' | 'edit' | 'duplicate' = editWorkspaceId ? 'edit' : duplicateWorkspaceId ? 'duplicate' : 'create'
  const navigate = useNavigate()
  const storedProject = useAppStore((state) => state.project)
  const setProject = useAppStore((state) => state.setProject)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setDetections = useAppStore((state) => state.setDetections)
  const setShells = useAppStore((state) => state.setShells)
  const settings = useAppStore((state) => state.settings)
  const [project, setLocalProject] = useState<Project | undefined>(storedProject?.id === projectId ? storedProject : undefined)
  const [detections, setLocalDetections] = useState<AgentDetectionResult[]>([])
  const [shells, setLocalShells] = useState<ShellProfile[]>([])
  const [layout, setLayout] = useState<LayoutNode>()
  const [assignments, setAssignments] = useState<Record<string, PaneAssignment | undefined>>({})
  const [name, setName] = useState('')
  const [existingId, setExistingId] = useState<string>()
  const [runningWarning, setRunningWarning] = useState(false)
  const [step, setStep] = useState<WizardStep>('layout')
  const [workingFolder, setWorkingFolder] = useState('')
  const [folderDraft, setFolderDraft] = useState('')
  const [presets, setPresets] = useState<LayoutPreset[]>(loadPresets)
  const [busy, setBusy] = useState(true)
  const [launching, setLaunching] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [prompt, setPrompt] = useState<{ kind: 'preset' | 'shell'; executablePath?: string }>()
  const [error, setError] = useState('')
  const [paneErrors, setPaneErrors] = useState<Record<string, string>>({})

  const choices = useMemo<Choice[]>(() => [
    ...detections.map((result) => ({ provider: result.provider, name: providerLabel(result.provider), executablePath: result.executablePath ?? '', args: [], available: result.available, detail: result.version ?? result.errorMessage })),
    ...shells.map((shell) => ({ provider: shell.name.startsWith('PowerShell') || shell.name === 'Windows PowerShell' ? 'powershell' as const : shell.name === 'Command Prompt' ? 'command_prompt' as const : shell.name.startsWith('WSL') ? 'wsl' as const : 'custom_shell' as const, name: shell.name, executablePath: shell.executablePath, args: shell.args, available: shell.available, detail: shell.executablePath, shellProfileId: shell.id })),
  ], [detections, shells])

  const paneCount = layout ? paneIds(layout).length : 0
  const assignedCount = Object.values(assignments).filter(Boolean).length

  useEffect(() => {
    try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets)) } catch { /* ignore */ }
  }, [presets])

  const scan = async (force = false) => {
    const customPaths = [
      settings.claudeExecutablePath && { provider: 'claude', path: settings.claudeExecutablePath },
      settings.codexExecutablePath && { provider: 'codex', path: settings.codexExecutablePath },
      settings.opencodeExecutablePath && { provider: 'opencode', path: settings.opencodeExecutablePath },
    ].filter((item): item is { provider: string; path: string } => Boolean(item))
    const [agentResults, shellResults] = await Promise.all([native.detectAgents(force, customPaths), native.detectShells()])
    setLocalDetections(agentResults); setDetections(agentResults)
    setLocalShells(shellResults); setShells(shellResults)
    return { agentResults, shellResults }
  }

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const loadedProject = project?.id === projectId ? project : await native.getProject(projectId)
        const scanned = await scan()
        if (!live) return
        setLocalProject(loadedProject); setProject(loadedProject)
        setWorkingFolder(loadedProject.rootPath)

        // EDIT / DUPLICATE start from an existing workspace's saved layout and panes.
        const sourceId = editWorkspaceId ?? duplicateWorkspaceId
        if (sourceId) {
          const source = await native.getWorkspace(sourceId)
          if (!live) return
          setLayout(source.layout)
          setAssignments(assignmentsFromWorkspace(source))
          if (mode === 'edit') {
            setExistingId(source.id)
            setName(source.name)
            // Reconfiguring a workspace whose terminals are still running must not silently
            // mutate pane configuration underneath live processes.
            const live_sessions = await native.listLiveSessions(source.id)
            if (live && live_sessions.some((session) => session.status === 'running')) setRunningWarning(true)
          } else {
            setExistingId(undefined)
            setName(await native.suggestWorkspaceName(projectId).catch(() => `${source.name} copy`))
          }
          return
        }

        // CREATE: default layout sized to installed agents, with a unique proposed name.
        const installedAgents = scanned.agentResults.filter((result) => result.available).length
        const count = installedAgents >= 2 ? 4 : 2
        const preset = await native.getLayoutPreset(count, '')
        if (!live) return
        setExistingId(undefined)
        setName(await native.suggestWorkspaceName(projectId).catch(() => 'Main Workspace'))
        setLayout(preset)
        seedAssignments(preset, loadedProject, scanned.agentResults, scanned.shellResults, loadedProject.rootPath)
      } catch (caught) { if (live) setError(asNativeError(caught).message) }
      finally { if (live) setBusy(false) }
    })()
    return () => { live = false }
    // Re-hydrate when the project or the edit/duplicate target changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, editWorkspaceId, duplicateWorkspaceId])

  const seedAssignments = (nextLayout: LayoutNode, currentProject: Project, agents = detections, currentShells = shells, baseDir?: string) => {
    const base = baseDir ?? (workingFolder || currentProject.rootPath)
    const ready: Choice[] = [
      ...agents.filter((item) => item.available && item.executablePath).map((item) => ({ provider: item.provider, name: providerLabel(item.provider), executablePath: item.executablePath!, args: [], available: true })),
      ...currentShells.filter((item) => item.available).map((item) => ({ provider: item.name.startsWith('PowerShell') ? 'powershell' as const : item.name === 'Command Prompt' ? 'command_prompt' as const : item.name.startsWith('WSL') ? 'wsl' as const : 'custom_shell' as const, name: item.name, executablePath: item.executablePath, args: item.args, available: true, shellProfileId: item.id })),
    ]
    const shell = preferredShell(ready, settings.defaultShell)
    const coding = ready.filter((choice) => CODING_PROVIDERS.includes(choice.provider))
    const next: Record<string, PaneAssignment | undefined> = {}
    paneIds(nextLayout).forEach((paneId, index) => {
      const choice = index < coding.length ? coding[index] : shell ?? ready[index % Math.max(ready.length, 1)]
      if (choice) next[paneId] = assignmentFrom(choice, paneId, base, index)
    })
    setAssignments(next)
  }

  const chooseCount = async (count: number) => {
    if (!project) return
    const next = await native.getLayoutPreset(count, '')
    setLayout(next); seedAssignments(next, project, detections, shells, workingFolder || project.rootPath)
  }

  const assign = (paneId: string, choice?: Choice) => {
    if (!project) return
    setAssignments((current) => ({ ...current, [paneId]: choice ? assignmentFrom(choice, paneId, current[paneId]?.workingDirectory ?? (workingFolder || project.rootPath), paneIds(layout!).indexOf(paneId), current[paneId]?.title) : undefined }))
    setPaneErrors((current) => ({ ...current, [paneId]: '' }))
  }

  const moveAssignment = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    setAssignments((current) => {
      const source = current[sourceId]
      const target = current[targetId]
      return {
        ...current,
        [sourceId]: target ? { ...target, id: sourceId, positionOrder: source?.positionOrder ?? 0 } : undefined,
        [targetId]: source ? { ...source, id: targetId, positionOrder: target?.positionOrder ?? 0 } : undefined,
      }
    })
  }

  const commitWorkingFolder = (folder: string) => {
    setWorkingFolder(folder)
    setAssignments((current) => Object.fromEntries(Object.entries(current).map(([id, assignment]) => [id, assignment ? { ...assignment, workingDirectory: folder } : assignment])))
  }

  const browseWorkingFolder = async () => {
    if (!project) return
    const selected = await open({ directory: true, multiple: false, defaultPath: workingFolder || project.rootPath, title: 'Choose working folder' })
    if (!selected || Array.isArray(selected)) return
    try {
      const validated = await native.validateWorkingDirectory(project.rootPath, selected, false)
      commitWorkingFolder(validated)
    } catch (caught) { setError(asNativeError(caught).message) }
  }

  const applyFolderDraft = async (event: FormEvent) => {
    event.preventDefault()
    if (!project || !folderDraft.trim()) return
    try {
      const validated = await native.validateWorkingDirectory(project.rootPath, folderDraft.trim(), false)
      commitWorkingFolder(validated); setFolderDraft(''); setError('')
    } catch (caught) { setError(asNativeError(caught).message) }
  }

  const applyPreset = (preset: LayoutPreset) => { void chooseCount(preset.count) }

  const savePreset = () => setPrompt({ kind: 'preset' })

  const removePreset = (id: string) => setPresets((current) => current.filter((preset) => preset.id !== id))

  const changeWorkingDirectory = async (paneId: string) => {
    if (!project) return
    const selected = await open({ directory: true, multiple: false, defaultPath: workingFolder || project.rootPath, title: 'Choose terminal working directory' })
    if (!selected || Array.isArray(selected)) return
    try {
      const validated = await native.validateWorkingDirectory(project.rootPath, selected, false)
      setAssignments((current) => ({ ...current, [paneId]: current[paneId] ? { ...current[paneId]!, workingDirectory: validated } : undefined }))
    } catch (caught) { setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message })) }
  }

  const locateAgent = async (provider: AgentProvider) => {
    const selected = await open({ directory: false, multiple: false, title: `Locate ${providerLabel(provider)} executable` })
    if (!selected || Array.isArray(selected)) return
    try {
      const path = await native.validateCustomExecutable(selected)
      const results = await native.detectAgents(true, [{ provider, path }])
      setLocalDetections(results); setDetections(results)
    } catch (caught) { setError(asNativeError(caught).message) }
  }

  const addCustomShell = async () => {
    const selected = await open({ directory: false, multiple: false, title: 'Locate custom shell executable' })
    if (!selected || Array.isArray(selected)) return
    setPrompt({ kind: 'shell', executablePath: selected })
  }

  const confirmPrompt = async (value: string) => {
    const current = prompt
    setPrompt(undefined)
    if (!current) return
    if (current.kind === 'preset') {
      setPresets((items) => [...items, { id: newId(), name: value, count: paneCount }])
      return
    }
    try {
      await native.saveCustomShell(value, current.executablePath!)
      await scan(true)
    } catch (caught) { setError(asNativeError(caught).message) }
  }

  const rescan = async () => {
    setScanning(true); setError('')
    try { await scan(true) }
    catch (caught) { setError(asNativeError(caught).message) }
    finally { setScanning(false) }
  }

  const launch = async (source: Record<string, PaneAssignment | undefined> = assignments) => {
    if (!project || !layout || launching) return
    const ids = paneIds(layout)
    const missing = Object.fromEntries(ids.filter((id) => !source[id]).map((id) => [id, 'Assign an available agent or shell before launch.']))
    setPaneErrors(missing)
    if (Object.keys(missing).length) { setError('Every terminal needs an agent or shell. Add one on the Agents step.'); setStep('agents'); return }
    setLaunching(true); setError('')
    try {
      const now = new Date().toISOString()
      const workspace: Workspace = {
        // EDIT preserves the id so reconfiguration updates in place; CREATE/DUPLICATE mint one.
        id: existingId ?? newId(),
        projectId: project.id,
        name: name.trim() || 'Main Workspace',
        layout,
        activePaneId: ids[0],
        panes: ids.map((id, index) => ({ ...source[id]!, positionOrder: index })),
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      }
      const saved = await native.saveWorkspace({
        id: workspace.id,
        projectId: workspace.projectId,
        name: workspace.name,
        layout: workspace.layout,
        activePaneId: workspace.activePaneId,
        panes: workspace.panes,
      })
      setWorkspace(saved)
      navigate(`/workspace/${saved.id}`)
    } catch (caught) {
      const nativeError = asNativeError(caught)
      if (nativeError.affectedEntity) setPaneErrors((current) => ({ ...current, [nativeError.affectedEntity!]: nativeError.message }))
      setError(nativeError.message)
    } finally { setLaunching(false) }
  }

  const openWithoutAgents = async () => {
    if (!project || !layout) return
    const shell = preferredShell(choices.filter((choice) => choice.available), settings.defaultShell)
    if (!shell) { setError('No shell is available to open terminals with.'); return }
    const seeded: Record<string, PaneAssignment> = {}
    paneIds(layout).forEach((paneId, index) => { seeded[paneId] = assignmentFrom(shell, paneId, workingFolder || project.rootPath, index) })
    setAssignments(seeded)
    await launch(seeded)
  }

  if (busy) return <div className="setup-loading"><div className="loading-line wide" /><div className="loading-grid">{Array.from({ length: 4 }, (_, i) => <div className="loading-block" key={i} />)}</div></div>
  if (!project || !layout) return <main className="centered-error"><ErrorNotice message={error || 'This project could not be loaded.'} /><Button onClick={() => navigate('/')}>Return to launcher</Button></main>

  const modeLabel = mode === 'edit' ? `Editing “${name || 'workspace'}”` : mode === 'duplicate' ? 'Duplicating workspace' : 'Creating workspace'

  return <main className="wizard-shell">
    <div className="wizard-topbar">
      <div className="wizard-topbar-left">
        <Brand />
        <button className="wizard-project" onClick={() => navigate('/')} title="Change project"><FolderGit2 size={14} /><span>{project.name}</span>{project.gitBranch && <em>{project.gitBranch}</em>}</button>
        <span className="wizard-mode" data-mode={mode}>{modeLabel}</span>
      </div>
      <label className="wizard-name"><span>Workspace</span><input aria-label="Workspace name" value={name} onChange={(event) => setName(event.target.value)} /></label>
    </div>

    {runningWarning && <div className="wizard-running-banner" role="alert">
      <span>This workspace has running terminals. Saving changes updates its configuration; reopen it to apply the new layout to fresh terminals.</span>
      <Button variant="ghost" onClick={() => setRunningWarning(false)}>Dismiss</Button>
    </div>}

    <div className="wizard-canvas">
      <nav className="wizard-stepper" aria-label="Setup progress">
        <StepDot index={1} label="Start" state="done" />
        <span className="step-bar done" />
        <StepDot index={2} label="Layout" state={step === 'layout' ? 'active' : 'done'} />
        <span className={`step-bar ${step === 'agents' ? 'done' : ''}`} />
        <StepDot index={3} label="Agents" state={step === 'agents' ? 'active' : 'todo'} />
      </nav>

      {error && <div className="wizard-error"><ErrorNotice message={error} /></div>}

      {step === 'layout' ? <section className="wizard-card" key="layout">
        <header className="wizard-head">
          <h1>Set up your workspace</h1>
          <p>Pick a folder to work in and choose how many terminals you want.</p>
        </header>

        <div className="wizard-field">
          <div className="field-label">Working folder<span className="field-hint">Where your terminals will start</span></div>
          <div className="folder-field">
            <span className="folder-ic"><FolderOpen size={16} /></span>
            <span className="folder-path" title={workingFolder}>{workingFolder}</span>
            <button className="folder-browse" onClick={() => void browseWorkingFolder()} aria-label="Browse for folder"><Search size={15} /></button>
          </div>
          <form className="folder-entry" onSubmit={(event) => void applyFolderDraft(event)}>
            <input value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} aria-label="Enter a folder path" placeholder="Paste a folder path and press Enter" spellCheck={false} />
            <button type="submit" className="folder-go" aria-label="Set folder"><ArrowRight size={15} /></button>
          </form>
        </div>

        <div className="wizard-field">
          <div className="field-label">How many terminals?<span className="field-hint">Tap a tile to choose a layout</span>
            <span className="count-badges"><span className="count-badge accent">{paneCount} terminal{paneCount === 1 ? '' : 's'}</span><span className="count-badge">{gridLabel(paneCount)}</span></span>
          </div>
          <div className="count-tiles">
            {countOptions.map((count) => <button key={count} className={`count-tile ${paneCount === count ? 'selected' : ''}`} aria-label={`${count} pane${count === 1 ? '' : 's'}`} aria-pressed={paneCount === count} onClick={() => void chooseCount(count)}>
              <span className="tile-grid" style={{ gridTemplateColumns: `repeat(${gridColumns[count]}, 1fr)` } as CSSProperties}>{Array.from({ length: count }, (_, index) => <i key={index} />)}</span>
              <span className="tile-num">{count}</span>
            </button>)}
          </div>
        </div>

        <div className="wizard-field">
          <div className="field-label"><Sparkles size={13} /> Presets<span className="field-hint">One-click layouts</span></div>
          <div className="preset-chips">
            {presets.map((preset) => <span className={`preset-chip ${preset.count === paneCount ? 'active' : ''}`} key={preset.id}>
              <button className="preset-apply" onClick={() => applyPreset(preset)}><span className="chip-grid" style={{ gridTemplateColumns: `repeat(${gridColumns[preset.count] ?? 2}, 1fr)` } as CSSProperties}>{Array.from({ length: Math.min(preset.count, 12) }, (_, index) => <i key={index} />)}</span>{preset.name}</button>
              <button className="preset-remove" aria-label={`Remove ${preset.name} preset`} onClick={() => removePreset(preset.id)}><X size={12} /></button>
            </span>)}
            <button className="preset-chip add" onClick={savePreset}><Plus size={14} />New</button>
          </div>
        </div>

        <footer className="wizard-footer">
          <Button variant="ghost" icon={<ChevronLeft size={16} />} onClick={() => navigate('/')}>Back</Button>
          <div className="footer-right">
            <Button variant="ghost" onClick={() => void openWithoutAgents()} disabled={launching}>Open without AI</Button>
            <button className="button button-primary wizard-next" onClick={() => setStep('agents')}>Next: Add AI agents <ArrowRight size={16} /></button>
          </div>
        </footer>
      </section> : <section className="wizard-card wide" key="agents">
        <header className="wizard-head">
          <h1>Add your AI agents</h1>
          <p>Drop a ready agent onto a terminal, or pick one from each pane below.</p>
        </header>

        <div className="agents-layout">
          <aside className="agents-palette">
            <div className="palette-head"><span className="section-label">Agents &amp; shells</span><Button variant="ghost" icon={<RefreshCw className={scanning ? 'is-spinning' : ''} size={13} />} onClick={() => void rescan()} disabled={scanning}>{scanning ? 'Scanning' : 'Re-scan'}</Button></div>
            <div className="agent-list">{choices.length === 0 ? <div className="agent-empty"><TerminalSquare size={18} /><strong>No terminals available</strong><span>Re-scan or add a custom shell to continue.</span></div> : choices.map((choice) => <div className={`agent-row ${choice.available ? '' : 'unavailable'}`} draggable={choice.available} onDragStart={(event) => event.dataTransfer.setData('application/forgemind-choice', JSON.stringify(choice))} key={`${choice.provider}:${choice.name}`}><span className="drag-handle"><GripVertical size={14} /></span><span className="agent-icon"><TerminalSquare size={15} /></span><div><strong>{choice.name}</strong><span title={choice.detail}>{choice.detail || (choice.available ? 'Ready' : 'Not installed')}</span></div><span className={`availability ${choice.available ? 'ready' : ''}`}>{choice.available ? 'Ready' : 'Unavailable'}</span>{!choice.available && CODING_PROVIDERS.includes(choice.provider) && <Button variant="ghost" icon={<ScanSearch size={14} />} onClick={() => void locateAgent(choice.provider)}>Locate</Button>}</div>)}</div>
            <Button className="add-custom-shell" variant="ghost" icon={<TerminalSquare size={13} />} onClick={() => void addCustomShell()}>Add custom shell</Button>
          </aside>

          <div className="agents-stage">
            <div className="assignment-heading"><div><h2>Assign terminals</h2><p>Every terminal needs an agent or shell before launch.</p></div><span className="assign-progress">{assignedCount}/{paneCount} assigned</span></div>
            <AssignmentPreview layout={layout} allPaneIds={paneIds(layout)} assignments={assignments} choices={choices} errors={paneErrors} onAssign={assign} onMove={moveAssignment} onChangeDirectory={changeWorkingDirectory} onChangeTitle={(paneId, title) => setAssignments((current) => ({ ...current, [paneId]: current[paneId] ? { ...current[paneId]!, title } : undefined }))} />
          </div>
        </div>

        <footer className="wizard-footer">
          <Button variant="ghost" icon={<ChevronLeft size={16} />} onClick={() => setStep('layout')}>Back to layout</Button>
          <div className="footer-right">
            <button className="button button-primary wizard-next" onClick={() => void launch()} disabled={launching}>{launching ? (mode === 'edit' ? 'Saving…' : 'Launching…') : mode === 'edit' ? 'Save changes' : 'Launch workspace'}<ChevronRight size={16} /></button>
          </div>
        </footer>
      </section>}
    </div>
    {prompt && <TextPromptDialog title={prompt.kind === 'preset' ? 'Save layout preset' : 'Add custom shell'} label={prompt.kind === 'preset' ? 'Preset name' : 'Shell name'} initialValue={prompt.kind === 'preset' ? `Layout ${paneCount}` : 'Custom shell'} confirmLabel={prompt.kind === 'preset' ? 'Save preset' : 'Add shell'} onClose={() => setPrompt(undefined)} onConfirm={(value) => void confirmPrompt(value)} />}
  </main>
}

function StepDot({ index, label, state }: { index: number; label: string; state: 'done' | 'active' | 'todo' }) {
  return <span className={`step ${state}`}>
    <span className="step-dot">{state === 'done' ? <Check size={13} strokeWidth={3} /> : index}</span>
    <span className="step-label">{label}</span>
  </span>
}

function assignmentFrom(choice: Choice, paneId: string, workingDirectory: string, positionOrder: number, title?: string): PaneAssignment {
  return { id: paneId, title: title || choice.name, provider: choice.provider, executablePath: choice.executablePath, args: choice.args, shellProfileId: choice.shellProfileId, workingDirectory, positionOrder }
}

function assignmentsFromWorkspace(workspace: Workspace): Record<string, PaneAssignment> {
  return Object.fromEntries(workspace.panes.map((pane) => [pane.id, { ...pane, workspaceId: undefined }]))
}

function AssignmentPreview({ layout, allPaneIds, assignments, choices, errors, onAssign, onMove, onChangeDirectory, onChangeTitle }: { layout: LayoutNode; allPaneIds: string[]; assignments: Record<string, PaneAssignment | undefined>; choices: Choice[]; errors: Record<string, string>; onAssign: (paneId: string, choice?: Choice) => void; onMove: (sourceId: string, targetId: string) => void; onChangeDirectory: (paneId: string) => void; onChangeTitle: (paneId: string, title: string) => void }) {
  if (layout.type === 'pane') {
    const assignment = assignments[layout.paneId]
    const paneNumber = allPaneIds.indexOf(layout.paneId) + 1
    return <div className={`assignment-pane ${assignment ? 'assigned' : ''}`} draggable={Boolean(assignment)} onDragStart={(event) => assignment && event.dataTransfer.setData('application/forgemind-pane', layout.paneId)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const data = event.dataTransfer.getData('application/forgemind-choice'); const source = event.dataTransfer.getData('application/forgemind-pane'); if (data) onAssign(layout.paneId, JSON.parse(data) as Choice); else if (source) onMove(source, layout.paneId) }}>
      <header><span>Pane {paneNumber || 1}</span>{assignment && <Button variant="ghost" icon={<X size={14} />} aria-label="Clear assignment" onClick={() => onAssign(layout.paneId)} />}</header>
      {assignment ? <><div className="assigned-provider"><span className="agent-icon"><TerminalSquare size={17} /></span><div><input aria-label="Pane title" value={assignment.title} onChange={(event) => onChangeTitle(layout.paneId, event.target.value)} /><strong>{providerLabel(assignment.provider)}</strong></div><Check size={16} /></div><button className="working-directory" title={assignment.workingDirectory} onClick={() => onChangeDirectory(layout.paneId)}>{assignment.workingDirectory}</button><select aria-label={`Assignment for ${assignment.title}`} value={`${assignment.provider}:${assignment.executablePath}`} onChange={(event) => onAssign(layout.paneId, choices.find((choice) => `${choice.provider}:${choice.executablePath}` === event.target.value))}>{choices.filter((choice) => choice.available).map((choice) => <option value={`${choice.provider}:${choice.executablePath}`} key={`${choice.provider}:${choice.name}`}>{choice.name}</option>)}</select></> : <><TerminalSquare size={19} /><strong>Unassigned terminal</strong><span>Drop an available agent here</span><select aria-label="Choose agent" defaultValue="" onChange={(event) => onAssign(layout.paneId, choices.find((choice) => `${choice.provider}:${choice.executablePath}` === event.target.value))}><option value="" disabled>Choose agent or shell</option>{choices.filter((choice) => choice.available).map((choice) => <option value={`${choice.provider}:${choice.executablePath}`} key={`${choice.provider}:${choice.name}`}>{choice.name}</option>)}</select></>}
      {errors[layout.paneId] && <span className="pane-error">{errors[layout.paneId]}</span>}
    </div>
  }
  return <div className={`assignment-split direction-${layout.direction}`} style={{ '--split-template': layout.sizes.map((size) => `${size}fr`).join(' ') } as CSSProperties}>{layout.children.map((child) => <AssignmentPreview key={paneIds(child).join(':')} layout={child} allPaneIds={allPaneIds} assignments={assignments} choices={choices} errors={errors} onAssign={onAssign} onMove={onMove} onChangeDirectory={onChangeDirectory} onChangeTitle={onChangeTitle} />)}</div>
}
