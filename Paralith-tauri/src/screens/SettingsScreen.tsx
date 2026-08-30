import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, FolderOpen, RefreshCw, RotateCcw, Save, ShieldCheck, Stethoscope, Wrench } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import type { AgentProfile, AgentProvider, AppSettings, DiagnosticsSnapshot, SafeRestartAssessment, SafeRestartClientState, ShellProfile } from '../native/types'
import { defaultSettings, useAppStore } from '../stores/appStore'
import { ThemeGallery } from '../theme/ThemeGallery'
import { useThemeStore } from '../theme/themeStore'
import { useUpdateController } from '../features/updates/updateController'

type Section = 'appearance' | 'terminal' | 'agents' | 'workspace' | 'updates' | 'diagnostics'
const sections: Array<{ id: Section; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'updates', label: 'Updates' },
  { id: 'diagnostics', label: 'Diagnostics' },
]
/** `AgentProvider` also covers shell providers; only these three have detectable executables. */
type CodingAgent = Extract<AgentProvider, 'claude' | 'codex' | 'opencode'>
const providerLabels = { claude: 'Claude Code', codex: 'Codex CLI', opencode: 'OpenCode' } as const satisfies Record<CodingAgent, string>
const executableKeys = { claude: 'claudeExecutablePath', codex: 'codexExecutablePath', opencode: 'opencodeExecutablePath' } as const satisfies Record<CodingAgent, keyof AppSettings>

export function SettingsScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stored = useAppStore((state) => state.settings)
  const setStored = useAppStore((state) => state.setSettings)
  const [settings, setSettings] = useState<AppSettings>(stored ?? defaultSettings)
  const requestedSection = searchParams.get('section')
  const [section, setSection] = useState<Section>(
    sections.some((item) => item.id === requestedSection) ? (requestedSection as Section) : 'appearance',
  )
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [customShellPath, setCustomShellPath] = useState<string>()
  const [shells, setShells] = useState<ShellProfile[]>([])
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>()
  const [confirmDialog, confirm] = useConfirm()
  const {
    status: updateStatus,
    assessment,
    operation: updateOperation,
    error: updateError,
    check: checkForUpdates,
    download: downloadUpdate,
    updateNow,
    installOnExit: scheduleUpdate,
    retry: retryUpdate,
  } = useUpdateController()
  const updating = Boolean(updateOperation)
  // Authoritative unsaved indicator. Deriving it from the edited settings keeps the Save affordance
  // and the safe-restart client state honest instead of coupling them to a status message string.
  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(stored), [settings, stored])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale))
    return () => document.documentElement.style.setProperty('--ui-scale', String(stored.uiScale))
  }, [settings.uiScale, stored.uiScale])

  useEffect(() => {
    document.documentElement.dataset.density = settings.uiDensity
    return () => { document.documentElement.dataset.density = stored.uiDensity }
  }, [settings.uiDensity, stored.uiDensity])

  useEffect(() => {
    void Promise.all([native.detectShells(), native.listAgentProfiles(), native.getDiagnostics()])
      .then(([nextShells, nextProfiles, nextDiagnostics]) => {
        setShells(nextShells); setProfiles(nextProfiles); setDiagnostics(nextDiagnostics)
      })
      .catch(() => undefined)
  }, [])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value })); setStatus('')
  }
  const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  const save = async () => {
    if (saving) return
    setSaving(true); setError('')
    try {
      // The theme is persisted independently the moment it is picked, so always fold the live
      // selection into this write instead of the value loaded at mount — otherwise saving unrelated
      // settings would clobber a theme chosen after the Settings screen opened.
      const result = await native.saveSettings({ ...settings, themeId: useThemeStore.getState().selectedId })
      setSettings(result); setStored(result); setStatus('Settings saved')
    } catch (caught) { setError(asNativeError(caught).message); setStatus('Save failed') }
    finally { setSaving(false) }
  }
  const customPaths = () => (Object.keys(executableKeys) as CodingAgent[])
    .map((provider) => ({ provider, path: settings[executableKeys[provider]] }))
    .filter((item): item is { provider: CodingAgent; path: string } => Boolean(item.path))
  const rescan = async () => {
    setScanning(true); setStatus('Scanning for installed agents'); setError('')
    try { await native.detectAgents(true, customPaths()); setProfiles(await native.listAgentProfiles()); setStatus('Agent scan complete') }
    catch (caught) { setError(asNativeError(caught).message); setStatus('Agent scan failed') }
    finally { setScanning(false) }
  }
  const locate = async (provider: CodingAgent) => {
    const selected = await open({ directory: false, multiple: false, title: `Locate ${providerLabels[provider]} executable` })
    if (!selected || Array.isArray(selected)) return
    try { update(executableKeys[provider], await native.validateCustomExecutable(selected)) }
    catch (caught) { setError(asNativeError(caught).message) }
  }
  const refreshDiagnostics = async () => {
    try { setDiagnostics(await native.getDiagnostics()); setStatus('Health check complete') }
    catch (caught) { setError(asNativeError(caught).message) }
  }
  const repair = async () => {
    try {
      const summary = await native.repairDatabaseMetadata()
      setStatus(`Repair complete: ${summary.repaired} repaired, ${summary.quarantined} quarantined`)
      await refreshDiagnostics()
    } catch (caught) { setError(asNativeError(caught).message) }
  }
  const exportSupport = async () => {
    try { const path = await native.exportRedactedSupportBundle(); setStatus('Redacted support bundle created'); await openPath(path) }
    catch (caught) { setError(asNativeError(caught).message) }
  }
  const withUpdate = async (label: string, action: () => Promise<unknown>) => {
    if (updating) return
    setError(''); setStatus(label)
    try {
      await action()
      const controller = useUpdateController.getState()
      if (controller.error) setError(controller.error)
      setStatus(controller.status?.journal.lastResult || label)
    }
    catch (caught) { setError(asNativeError(caught).message); setStatus('Update operation failed') }
  }
  const restartClientState = (): SafeRestartClientState => ({ unsavedEditorState: false, unsavedSettings: dirty, unsavedBrowserState: false })
  const reviewActiveWork = async () => {
    try {
      const next = await native.assessSafeRestart(restartClientState())
      useUpdateController.setState({ assessment: next })
      setStatus(next.safe ? 'No active work is blocking an update' : `${next.blockers.length + next.hardBlockers.length} item(s) to review`)
    }
    catch (caught) { setError(asNativeError(caught).message) }
  }
  const confirmBlockers = (title: string, lead: string, confirmLabel: string) => (next: SafeRestartAssessment) => confirm({
    title,
    confirmLabel,
    body: <><p>{lead}</p><ul>{next.blockers.map((item) => <li key={item}>{item}</li>)}</ul></>,
  })
  const installNow = async () => {
    await updateNow(restartClientState(), confirmBlockers(
      'Update now',
      'PARALITH must safely stop active work before updating. Agents and Swarms checkpoint, terminals stop, and your workspace layout is restored after restart.',
      'Update now',
    ))
    const controller = useUpdateController.getState()
    if (controller.error) setError(controller.error)
  }
  const installOnExit = async () => {
    await scheduleUpdate(restartClientState(), confirmBlockers(
      'Update when idle',
      'PARALITH will install only after active work is safely stopped.',
      'Schedule update',
    ))
    const controller = useUpdateController.getState()
    if (controller.error) setError(controller.error)
    else if (controller.status?.journal.installOnExit) setStatus('Verified update will install when PARALITH exits')
  }

  return <main className="settings-shell focused-settings">
    <header className="settings-titlebar">
      <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>Back</Button>
      <Brand compact /><h1>Settings</h1>
      <div className="titlebar-spacer" />
      <span role="status" aria-live="polite" className={dirty ? 'is-dirty' : ''}>{dirty ? 'Unsaved changes' : status}</span>
      <Button variant="primary" icon={<Save size={15} />} onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Saving' : 'Save'}</Button>
    </header>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{sections.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>
      <section className="settings-panel">{(error || updateError) && <ErrorNotice message={error || updateError || ''} />}

        {section === 'appearance' && <>
          <SettingsSection title="Theme" description="Themes apply instantly across every window, terminal, and editor — no save needed."><ThemeGallery /></SettingsSection>
          <SettingsSection title="Interface" description="Scale and density preview immediately and persist on save.">
            <SettingRow label="UI scale" detail="Scale the entire desktop interface."><input aria-label="UI scale" type="range" min="0.8" max="1.5" step="0.05" value={settings.uiScale} onChange={(event) => update('uiScale', Number(event.target.value))} /><output>{Math.round(settings.uiScale * 100)}%</output></SettingRow>
            <SettingRow label="Interface density" detail="Control heights, list rows, and pane chrome. Terminal text is unaffected."><select aria-label="Interface density" value={settings.uiDensity} onChange={(event) => update('uiDensity', event.target.value as AppSettings['uiDensity'])}><option value="comfortable">Comfortable</option><option value="standard">Standard</option><option value="compact">Compact</option></select></SettingRow>
            <SettingRow label="Reset interface" detail="Restore the default scale, density, and sidebar visibility."><Button icon={<RotateCcw size={14} />} onClick={() => setSettings((current) => ({ ...current, uiScale: 1, uiDensity: 'standard', sidebarOpen: true }))}>Reset</Button></SettingRow>
          </SettingsSection>
        </>}

        {section === 'terminal' && <>
          <SettingsSection title="Typography" description="Terminal rendering updates immediately in every attached Pane.">
            <SettingRow label="Font family"><input aria-label="Terminal font" value={settings.terminalFontFamily} onChange={(event) => update('terminalFontFamily', event.target.value)} /></SettingRow>
            <SettingRow label="Font size"><input aria-label="Terminal font size" type="number" min="9" max="30" value={settings.terminalFontSize} onChange={(event) => update('terminalFontSize', Number(event.target.value))} onBlur={(event) => update('terminalFontSize', clamp(Math.round(Number(event.target.value)), 9, 30))} /></SettingRow>
            <SettingRow label="Line height"><input aria-label="Terminal line height" type="range" min="0.9" max="2" step="0.05" value={settings.terminalLineHeight} onChange={(event) => update('terminalLineHeight', Number(event.target.value))} /><output>{settings.terminalLineHeight.toFixed(2)}</output></SettingRow>
            <SettingRow label="Cursor style"><select aria-label="Cursor style" value={settings.cursorStyle} onChange={(event) => update('cursorStyle', event.target.value as AppSettings['cursorStyle'])}><option value="block">Block</option><option value="bar">Bar</option><option value="underline">Underline</option></select></SettingRow>
            <div className="terminal-preview" style={{ fontFamily: settings.terminalFontFamily, fontSize: settings.terminalFontSize, lineHeight: settings.terminalLineHeight }}><span>$ forge status</span><strong><i />4 panes ready</strong><span className={`preview-cursor ${settings.cursorStyle}`}> </span></div>
          </SettingsSection>
          <SettingsSection title="Shell and behavior" description="PTY defaults, output retention, and interaction safeguards.">
            <SettingRow label="Default shell"><select aria-label="Default shell" value={settings.defaultShell ?? ''} onChange={(event) => update('defaultShell', event.target.value || undefined)}><option value="">Automatic fallback</option>{shells.map((shell) => <option key={shell.id} value={shell.id}>{shell.name}</option>)}</select></SettingRow>
            <SettingRow label="Custom shells" detail="Register an executable that is not detected automatically."><Button onClick={async () => { const selected = await open({ directory: false, multiple: false, title: 'Locate custom shell executable' }); if (selected && !Array.isArray(selected)) setCustomShellPath(selected) }}>Add shell</Button></SettingRow>
            <SettingRow label="Scrollback lines"><input aria-label="Scrollback lines" type="number" min="1000" max="1000000" step="1000" value={settings.scrollbackSize} onChange={(event) => update('scrollbackSize', Number(event.target.value))} /></SettingRow>
            <SettingRow label="Output log retention"><select aria-label="Output log retention" value={settings.outputLogRetention} onChange={(event) => update('outputLogRetention', event.target.value as AppSettings['outputLogRetention'])}><option value="tail_only">Bounded tail only</option><option value="rotating_log">Rotating native log</option></select></SettingRow>
            <Toggle label="Copy on select" checked={settings.copyOnSelect} onChange={(value) => update('copyOnSelect', value)} />
            <Toggle label="Warn before multiline paste" checked={settings.confirmMultilinePaste} onChange={(value) => update('confirmMultilinePaste', value)} />
            <Toggle label="Confirm before closing a running Pane" checked={settings.confirmClosePane} onChange={(value) => update('confirmClosePane', value)} />
          </SettingsSection>
        </>}

        {section === 'agents' && <SettingsSection title="Agents" description="Detected coding-agent profiles and executable overrides." action={<Button icon={<RefreshCw className={scanning ? 'is-spinning' : ''} size={14} />} onClick={() => void rescan()} disabled={scanning}>{scanning ? 'Scanning' : 'Rescan all'}</Button>}>
          {(Object.keys(providerLabels) as CodingAgent[]).map((provider) => {
            const profile = profiles.find((item) => item.provider === provider)
            const override = settings[executableKeys[provider]]
            return <div className="agent-setting" key={provider}>
              <span className={`terminal-status status-${profile?.available ? 'running' : 'failed'}`} />
              <div><strong>{providerLabels[provider]}</strong><span>{profile?.available ? profile.version || 'Available' : 'Not detected'}</span><small title={override || profile?.executablePath}>{override || profile?.executablePath || 'Automatic detection'}</small></div>
              <Button onClick={() => void locate(provider)}>Locate</Button>
              {override && <Button variant="ghost" onClick={() => update(executableKeys[provider], undefined)}>Reset</Button>}
            </div>
          })}
        </SettingsSection>}

        {section === 'workspace' && <SettingsSection title="Workspace" description="Startup, restore, and inactive Workspace behavior.">
          <Toggle label="Reopen last Workspace" checked={settings.reopenLastWorkspace} onChange={(value) => update('reopenLastWorkspace', value)} />
          <SettingRow label="Restore behavior"><select aria-label="Restore behavior" value={settings.restoreBehavior} onChange={(event) => update('restoreBehavior', event.target.value as AppSettings['restoreBehavior'])}><option value="ask">Ask</option><option value="restart_agents">Restart assigned agents</option><option value="fresh_shells">Open fresh shells</option></select></SettingRow>
          <SettingRow label="Restore launch budget" detail="Maximum Panes started automatically across all open Workspaces."><input aria-label="Restoration launch budget" type="number" min="1" max="8" value={settings.restorationLaunchBudget} onChange={(event) => update('restorationLaunchBudget', clamp(Number(event.target.value), 1, 8))} /></SettingRow>
          <SettingRow label="Default layout"><select aria-label="Default layout" value={settings.defaultLayout} onChange={(event) => update('defaultLayout', event.target.value)}><option value="auto">Automatic</option><option value="2-vertical">Two vertical</option><option value="2-horizontal">Two horizontal</option><option value="4">Four panes</option></select></SettingRow>
          <SettingRow label="Default Pane count"><select aria-label="Default Pane count" value={settings.defaultPaneCount} onChange={(event) => update('defaultPaneCount', Number(event.target.value))}>{[1, 2, 3, 4, 6, 8].map((count) => <option key={count} value={count}>{count}</option>)}</select></SettingRow>
          <SettingRow label="Inactive Workspace processes"><select aria-label="Inactive Workspace processes" value={settings.inactiveWorkspaceProcesses} onChange={(event) => update('inactiveWorkspaceProcesses', event.target.value as AppSettings['inactiveWorkspaceProcesses'])}><option value="keep_running">Keep running</option><option value="ask">Ask</option><option value="stop">Stop</option></select></SettingRow>
        </SettingsSection>}

        {section === 'updates' && <SettingsSection title="Updates" description="Cryptographically signed releases for this PARALITH channel.">
          {updateStatus && <div className={`health-banner ${updateStatus.journal.phase === 'failed' || updateStatus.recoveryMode ? 'attention' : 'healthy'}`}><ShieldCheck size={18} /><div><strong>{updateStatus.build.product} {updateStatus.build.edition === 'stable' ? 'Stable' : 'Preview'} {updateStatus.build.version}</strong><span>{updateStatus.endpointStatus} · {updateStatus.journal.phase.replaceAll('_', ' ')}</span></div></div>}
          <Toggle label="Check automatically after safe startup" checked={settings.automaticUpdateChecks} onChange={(value) => update('automaticUpdateChecks', value)} />
          <InfoGrid>
            <InfoRow label="Last check" value={updateStatus?.journal.lastCheckAt || 'Never'} />
            <InfoRow label="Available version" value={updateStatus?.journal.available?.version || 'None'} />
            <InfoRow label="Signature" value={updateStatus?.journal.signatureVerified ? 'Verified by bundled updater public key' : 'Not yet verified'} />
            <InfoRow label="Readiness" value={updateStatus?.journal.phase === 'downloaded' || updateStatus?.journal.phase === 'restart_requested' ? 'Ready to install' : updateStatus?.journal.phase.replaceAll('_', ' ') || 'Loading…'} />
            <InfoRow label="Previous result" value={updateStatus?.journal.lastResult || 'None'} />
          </InfoGrid>
          {updateStatus?.journal.phase === 'downloading' && <div className="update-download">
            <div className="update-progress"><span style={{ width: updateStatus.journal.downloadTotal ? `${Math.min(100, updateStatus.journal.downloadReceived / updateStatus.journal.downloadTotal * 100)}%` : '20%' }} /></div>
            <small>{formatBytes(updateStatus.journal.downloadReceived)}{updateStatus.journal.downloadTotal ? ` of ${formatBytes(updateStatus.journal.downloadTotal)} · ${Math.min(100, Math.round(updateStatus.journal.downloadReceived / updateStatus.journal.downloadTotal * 100))}%` : ' downloaded'}</small>
          </div>}
          {updateStatus?.journal.available?.releaseNotes && <div className="update-notes"><strong>Release notes · {updateStatus.journal.available.version}</strong><p>{updateStatus.journal.available.releaseNotes}</p></div>}
          {assessment && !assessment.safe && <div className="update-notes attention"><strong>{assessment.hardBlocked ? <><AlertTriangle size={14} /> Update blocked by active Git work</> : 'Active work to review before updating'}</strong><p>{[...assessment.hardBlockers, ...assessment.blockers].map((item) => `• ${item}`).join('\n')}</p></div>}
          <div className="setting-actions">
            <Button variant="primary" disabled={!updateStatus?.journal.signatureVerified} onClick={() => void installNow()}>Update now</Button>
            <Button disabled={!updateStatus?.journal.signatureVerified} onClick={() => void installOnExit()}>Update when idle</Button>
            <Button icon={<RefreshCw className={updating ? 'is-spinning' : ''} size={14} />} disabled={updating || !updateStatus?.endpointConfigured} onClick={() => void withUpdate('Checking for updates', checkForUpdates)}>Check for updates</Button>
            <Button icon={<Download size={14} />} disabled={updating || updateStatus?.journal.phase !== 'available'} onClick={() => void withUpdate('Downloading signed update', downloadUpdate)}>Download</Button>
            <Button icon={<ShieldCheck size={14} />} onClick={() => void reviewActiveWork()}>Review active work</Button>
            <Button icon={<RotateCcw size={14} />} disabled={updating || updateStatus?.journal.phase !== 'failed'} onClick={() => void withUpdate('Retrying update', retryUpdate)}>Retry</Button>
          </div>
        </SettingsSection>}

        {section === 'diagnostics' && <>
          <SettingsSection title="Diagnostics" description="Inspect and repair PARALITH metadata without touching source Projects.">
            {diagnostics && <div className={`health-banner ${diagnostics.health.healthy ? 'healthy' : 'attention'}`}>{diagnostics.health.healthy ? <CheckCircle2 size={18} /> : <Stethoscope size={18} />}<div><strong>{diagnostics.health.healthy ? 'PARALITH is healthy' : 'Metadata needs attention'}</strong><span>{diagnostics.health.messages.join(' ')}</span></div></div>}
            <InfoGrid>
              <InfoRow label="Build" value={diagnostics ? `${diagnostics.applicationVersion} · ${diagnostics.buildCommit}` : 'Loading…'} />
              <InfoRow label="Edition / channel" value={diagnostics ? `${diagnostics.edition} / ${diagnostics.releaseChannel}` : 'Loading…'} />
              <InfoRow label="Identifier" value={diagnostics ? `${diagnostics.appIdentifier} · ${diagnostics.installerType || 'unknown installer'}` : 'Loading…'} />
              <InfoRow label="Publisher" value={diagnostics ? `${diagnostics.product} · ${diagnostics.company}` : 'Loading…'} />
              <InfoRow label="Database schema" value={diagnostics ? String(diagnostics.schemaVersion) : 'Loading…'} />
              <InfoRow label="Database integrity" value={diagnostics ? `${diagnostics.health.integrityCheck} · ${diagnostics.health.foreignKeyViolations} foreign-key violations` : 'Loading…'} />
              <InfoRow label="Migrations" value={diagnostics ? `${diagnostics.migrationStatus} · legacy ${diagnostics.legacyMigrationStatus}` : 'Loading…'} />
              <InfoRow label="Backups" value={diagnostics?.backupStatus || 'Loading…'} />
              <InfoRow label="Updater endpoint" value={diagnostics?.updaterEndpointStatus || 'Loading…'} />
              <InfoRow label="Pending update" value={diagnostics?.pendingUpdate || 'None'} />
            </InfoGrid>
            <div className="setting-actions">
              <Button icon={<Stethoscope size={14} />} onClick={() => void refreshDiagnostics()}>Run health check</Button>
              <Button icon={<Wrench size={14} />} onClick={() => void repair()}>Repair database metadata</Button>
              <Button icon={<Copy size={14} />} onClick={() => void exportSupport()}>Export redacted support bundle</Button>
              <Button onClick={() => void native.startInSafeMode()}>Start in safe mode</Button>
            </div>
          </SettingsSection>
          <SettingsSection title="Files" description="Locations PARALITH writes to on this machine.">
            <InfoGrid>
              <InfoRow label="Database" value={diagnostics?.databasePath || 'Loading…'} />
              <InfoRow label="Logs" value={diagnostics?.logDirectory || 'Loading…'} action={diagnostics && <Button variant="ghost" icon={<FolderOpen size={14} />} aria-label="Open log directory" onClick={() => void openPath(diagnostics.logDirectory)} />} />
              <InfoRow label="Backups" value={diagnostics?.backupPath || diagnostics?.backupDirectory || 'Loading…'} action={diagnostics && <Button variant="ghost" icon={<FolderOpen size={14} />} aria-label="Open backup directory" onClick={() => void openPath(diagnostics.backupDirectory)} />} />
              <InfoRow label="Update data" value={diagnostics?.updateDataDirectory || 'Loading…'} action={diagnostics && <Button variant="ghost" icon={<FolderOpen size={14} />} aria-label="Open update-data directory" onClick={() => void openPath(diagnostics.updateDataDirectory)} />} />
              {diagnostics?.legacyMigrationBackup ? <InfoRow label="Legacy backup" value={diagnostics.legacyMigrationBackup} /> : null}
            </InfoGrid>
          </SettingsSection>
          {diagnostics?.readiness && <div className="update-notes"><strong>{diagnostics.readiness.firstRun ? 'First-run readiness' : 'Daily-use readiness'} · {diagnostics.readiness.ready ? 'ready' : 'attention required'}</strong><p>{diagnostics.readiness.checks.map((check) => `${check.status.toUpperCase()} · ${check.label}: ${check.detail}${check.action ? ` Action: ${check.action}` : ''}`).join('\n')}</p></div>}
          {diagnostics?.updateLogEntries.length ? <div className="update-notes"><strong>Update log</strong><p>{diagnostics.updateLogEntries.join('\n')}</p></div> : null}
        </>}
      </section>
    </div>
    {confirmDialog}
    {customShellPath && <TextPromptDialog title="Add custom shell" label="Shell name" initialValue="Custom shell" confirmLabel="Add shell" onClose={() => setCustomShellPath(undefined)} onConfirm={async (name) => { const path = customShellPath; setCustomShellPath(undefined); if (!path) return; try { await native.saveCustomShell(name, path); setShells(await native.detectShells()); setStatus('Custom shell added') } catch (caught) { setError(asNativeError(caught).message) } }} />}
  </main>
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function SettingsSection({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) { return <div className="focused-section"><header><div><h2>{title}</h2><p>{description}</p></div>{action}</header><div className="setting-rows">{children}</div></div> }
function SettingRow({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) { return <label className="setting-row"><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><div>{children}</div></label> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="setting-row toggle-row"><span><strong>{label}</strong></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label> }
/** Read-only build and runtime facts. Deliberately not `SettingRow`: nothing here is editable. */
function InfoGrid({ children }: { children: ReactNode }) { return <dl className="info-grid">{children}</dl> }
function InfoRow({ label, value, action }: { label: string; value: string; action?: ReactNode }) { return <><dt>{label}</dt><dd><span title={value}>{value}</span>{action}</dd></> }
