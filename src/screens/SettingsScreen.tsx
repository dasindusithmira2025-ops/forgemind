import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { ArrowLeft, CheckCircle2, Copy, FolderOpen, RefreshCw, Save, Stethoscope, Wrench } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import type { AgentProfile, AgentProvider, AppSettings, DiagnosticsSnapshot, ShellProfile } from '../native/types'
import { defaultSettings, useAppStore } from '../stores/appStore'

type Section = 'appearance' | 'terminal' | 'agents' | 'workspace' | 'diagnostics'
const sections: Array<{ id: Section; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'diagnostics', label: 'Diagnostics' },
]

export function SettingsScreen() {
  const navigate = useNavigate()
  const stored = useAppStore((state) => state.settings)
  const setStored = useAppStore((state) => state.setSettings)
  const [settings, setSettings] = useState<AppSettings>(stored ?? defaultSettings)
  const [section, setSection] = useState<Section>('appearance')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [customShellPath, setCustomShellPath] = useState<string>()
  const [shells, setShells] = useState<ShellProfile[]>([])
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>()

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale))
    return () => document.documentElement.style.setProperty('--ui-scale', String(stored.uiScale))
  }, [settings.uiScale, stored.uiScale])

  useEffect(() => {
    void Promise.all([native.detectShells(), native.listAgentProfiles(), native.getDiagnostics()])
      .then(([nextShells, nextProfiles, nextDiagnostics]) => {
        setShells(nextShells); setProfiles(nextProfiles); setDiagnostics(nextDiagnostics)
      })
      .catch(() => undefined)
  }, [])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value })); setStatus('Unsaved changes')
  }
  const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  const save = async () => {
    if (saving) return
    setSaving(true); setError('')
    try {
      const result = await native.saveSettings(settings)
      setSettings(result); setStored(result); setStatus('Settings saved')
    } catch (caught) { setError(asNativeError(caught).message); setStatus('Save failed') }
    finally { setSaving(false) }
  }
  const customPaths = () => [settings.claudeExecutablePath && { provider: 'claude', path: settings.claudeExecutablePath }, settings.codexExecutablePath && { provider: 'codex', path: settings.codexExecutablePath }, settings.opencodeExecutablePath && { provider: 'opencode', path: settings.opencodeExecutablePath }].filter((item): item is { provider: string; path: string } => Boolean(item))
  const rescan = async () => {
    setScanning(true); setStatus('Scanning for installed agents'); setError('')
    try { await native.detectAgents(true, customPaths()); setProfiles(await native.listAgentProfiles()); setStatus('Agent scan complete') }
    catch (caught) { setError(asNativeError(caught).message); setStatus('Agent scan failed') }
    finally { setScanning(false) }
  }
  const locate = async (provider: AgentProvider) => {
    const selected = await open({ directory: false, multiple: false, title: `Locate ${provider} executable` })
    if (!selected || Array.isArray(selected)) return
    try {
      const path = await native.validateCustomExecutable(selected)
      const key = provider === 'claude' ? 'claudeExecutablePath' : provider === 'codex' ? 'codexExecutablePath' : 'opencodeExecutablePath'
      update(key, path)
    } catch (caught) { setError(asNativeError(caught).message) }
  }
  const refreshDiagnostics = async () => {
    try {
      const health = await native.runHealthCheck()
      setDiagnostics((current) => current ? { ...current, health, schemaVersion: health.schemaVersion } : current)
      setStatus('Health check complete')
    }
    catch (caught) { setError(asNativeError(caught).message) }
  }
  const repair = async () => {
    try {
      const summary = await native.repairDatabaseMetadata()
      setStatus(`Repair complete: ${summary.repaired} repaired, ${summary.quarantined} quarantined`)
      await refreshDiagnostics()
    } catch (caught) { setError(asNativeError(caught).message) }
  }

  return <main className="settings-shell focused-settings">
    <header className="settings-titlebar"><Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>Back</Button><Brand compact /><h1>Settings</h1><div className="titlebar-spacer" /><span role="status" aria-live="polite">{status}</span><Button variant="primary" icon={<Save size={15} />} onClick={() => void save()} disabled={saving}>{saving ? 'Saving' : 'Save'}</Button></header>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{sections.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>
      <section className="settings-panel">{error && <ErrorNotice message={error} />}
        {section === 'appearance' && <SettingsSection title="Appearance" description="Density and terminal rendering update immediately.">
          <SettingRow label="UI scale" detail="Scale the entire desktop interface."><input aria-label="UI scale" type="range" min="0.8" max="1.5" step="0.05" value={settings.uiScale} onChange={(event) => update('uiScale', Number(event.target.value))} /><output>{Math.round(settings.uiScale * 100)}%</output></SettingRow>
          <SettingRow label="Terminal font"><input aria-label="Terminal font" value={settings.terminalFontFamily} onChange={(event) => update('terminalFontFamily', event.target.value)} /></SettingRow>
          <SettingRow label="Font size"><input aria-label="Terminal font size" type="number" min="9" max="30" value={settings.terminalFontSize} onChange={(event) => update('terminalFontSize', Number(event.target.value))} onBlur={(event) => update('terminalFontSize', clamp(Math.round(Number(event.target.value)), 9, 30))} /></SettingRow>
          <SettingRow label="Line height"><input aria-label="Terminal line height" type="range" min="0.9" max="2" step="0.05" value={settings.terminalLineHeight} onChange={(event) => update('terminalLineHeight', Number(event.target.value))} /><output>{settings.terminalLineHeight.toFixed(2)}</output></SettingRow>
          <SettingRow label="Cursor style"><select aria-label="Cursor style" value={settings.cursorStyle} onChange={(event) => update('cursorStyle', event.target.value as AppSettings['cursorStyle'])}><option value="block">Block</option><option value="bar">Bar</option><option value="underline">Underline</option></select></SettingRow>
          <div className="terminal-preview" style={{ fontFamily: settings.terminalFontFamily, fontSize: settings.terminalFontSize, lineHeight: settings.terminalLineHeight }}><span>$ forge status</span><strong><i />4 panes ready</strong><span className={`preview-cursor ${settings.cursorStyle}`}> </span></div>
        </SettingsSection>}
        {section === 'terminal' && <SettingsSection title="Terminal" description="PTY defaults, output retention, and interaction safeguards.">
          <SettingRow label="Default shell"><select aria-label="Default shell" value={settings.defaultShell ?? ''} onChange={(event) => update('defaultShell', event.target.value || undefined)}><option value="">Automatic fallback</option>{shells.map((shell) => <option key={shell.id} value={shell.id}>{shell.name}</option>)}</select></SettingRow>
          <SettingRow label="Scrollback lines"><input aria-label="Scrollback lines" type="number" min="1000" max="1000000" step="1000" value={settings.scrollbackSize} onChange={(event) => update('scrollbackSize', Number(event.target.value))} /></SettingRow>
          <Toggle label="Copy on select" checked={settings.copyOnSelect} onChange={(value) => update('copyOnSelect', value)} />
          <Toggle label="Warn before multiline paste" checked={settings.confirmMultilinePaste} onChange={(value) => update('confirmMultilinePaste', value)} />
          <Toggle label="Confirm before closing a running Pane" checked={settings.confirmClosePane} onChange={(value) => update('confirmClosePane', value)} />
          <SettingRow label="Output log retention"><select aria-label="Output log retention" value={settings.outputLogRetention} onChange={(event) => update('outputLogRetention', event.target.value as AppSettings['outputLogRetention'])}><option value="tail_only">Bounded tail only</option><option value="rotating_log">Rotating native log</option></select></SettingRow>
          <SettingRow label="Restoration launch budget" detail="Maximum Panes started in the initial restore batch."><input aria-label="Restoration launch budget" type="number" min="1" max="8" value={settings.restorationLaunchBudget} onChange={(event) => update('restorationLaunchBudget', clamp(Number(event.target.value), 1, 8))} /></SettingRow>
          <SettingRow label="Custom shell"><Button onClick={async () => { const selected = await open({ directory: false, multiple: false, title: 'Locate custom shell executable' }); if (selected && !Array.isArray(selected)) setCustomShellPath(selected) }}>Add custom shell</Button></SettingRow>
        </SettingsSection>}
        {section === 'agents' && <SettingsSection title="Agents" description="Detected coding-agent profiles and executable overrides.">{(['claude', 'codex', 'opencode'] as AgentProvider[]).map((provider) => { const profile = profiles.find((item) => item.provider === provider); const override = provider === 'claude' ? settings.claudeExecutablePath : provider === 'codex' ? settings.codexExecutablePath : settings.opencodeExecutablePath; return <div className="agent-setting" key={provider}><span className={`terminal-status status-${profile?.available ? 'running' : 'failed'}`} /><div><strong>{provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex CLI' : 'OpenCode'}</strong><span>{profile?.available ? profile.version || 'Available' : 'Not detected'}</span><small title={override || profile?.executablePath}>{override || profile?.executablePath || 'Automatic detection'}</small></div><Button onClick={() => void locate(provider)}>Locate</Button>{override && <Button variant="ghost" onClick={() => update(provider === 'claude' ? 'claudeExecutablePath' : provider === 'codex' ? 'codexExecutablePath' : 'opencodeExecutablePath', undefined)}>Reset</Button>}</div> })}<SettingRow label="Provider detection"><Button icon={<RefreshCw className={scanning ? 'is-spinning' : ''} size={14} />} onClick={() => void rescan()} disabled={scanning}>{scanning ? 'Scanning' : 'Rescan all'}</Button></SettingRow></SettingsSection>}
        {section === 'workspace' && <SettingsSection title="Workspace" description="Startup, switching, and inactive Workspace behavior.">
          <Toggle label="Reopen last Workspace" checked={settings.reopenLastWorkspace} onChange={(value) => update('reopenLastWorkspace', value)} />
          <SettingRow label="Restore behavior"><select aria-label="Restore behavior" value={settings.restoreBehavior} onChange={(event) => update('restoreBehavior', event.target.value as AppSettings['restoreBehavior'])}><option value="ask">Ask</option><option value="restart_agents">Restart assigned agents</option><option value="fresh_shells">Open fresh shells</option></select></SettingRow>
          <SettingRow label="Default layout"><select aria-label="Default layout" value={settings.defaultLayout} onChange={(event) => update('defaultLayout', event.target.value)}><option value="auto">Automatic</option><option value="2-vertical">Two vertical</option><option value="2-horizontal">Two horizontal</option><option value="4">Four panes</option></select></SettingRow>
          <SettingRow label="Default Pane count"><select aria-label="Default Pane count" value={settings.defaultPaneCount} onChange={(event) => update('defaultPaneCount', Number(event.target.value))}>{[1, 2, 3, 4, 6, 8].map((count) => <option key={count} value={count}>{count}</option>)}</select></SettingRow>
          <SettingRow label="Inactive Workspace processes"><select aria-label="Inactive Workspace processes" value={settings.inactiveWorkspaceProcesses} onChange={(event) => update('inactiveWorkspaceProcesses', event.target.value as AppSettings['inactiveWorkspaceProcesses'])}><option value="keep_running">Keep running</option><option value="ask">Ask</option><option value="stop">Stop</option></select></SettingRow>
          <SettingRow label="Inactive Workspace rendering" detail="Hidden xterm canvases are unmounted while native tails continue."><select aria-label="Inactive Workspace rendering" value={settings.inactiveWorkspaceRendering} disabled><option value="hibernate">Hibernate canvases</option></select></SettingRow>
        </SettingsSection>}
        {section === 'diagnostics' && <SettingsSection title="Diagnostics" description="Inspect and repair ForgeMind metadata without touching source Projects.">
          {diagnostics && <div className={`health-banner ${diagnostics.health.healthy ? 'healthy' : 'attention'}`}>{diagnostics.health.healthy ? <CheckCircle2 size={18} /> : <Stethoscope size={18} />}<div><strong>{diagnostics.health.healthy ? 'ForgeMind is healthy' : 'Metadata needs attention'}</strong><span>{diagnostics.health.messages.join(' ')}</span></div></div>}
          <SettingRow label="Application version"><code>{diagnostics?.applicationVersion || 'Loading…'}</code></SettingRow>
          <SettingRow label="Database"><code title={diagnostics?.databasePath}>{diagnostics?.databasePath || 'Loading…'}</code></SettingRow>
          <SettingRow label="Log directory"><code title={diagnostics?.logDirectory}>{diagnostics?.logDirectory || 'Loading…'}</code><Button icon={<FolderOpen size={14} />} onClick={() => diagnostics && void openPath(diagnostics.logDirectory)}>Open logs</Button></SettingRow>
          {diagnostics?.backupPath && <SettingRow label="Migration backup"><code title={diagnostics.backupPath}>{diagnostics.backupPath}</code></SettingRow>}
          <div className="diagnostic-actions"><Button icon={<Stethoscope size={14} />} onClick={() => void refreshDiagnostics()}>Run health check</Button><Button icon={<Wrench size={14} />} onClick={() => void repair()}>Repair database metadata</Button><Button icon={<Copy size={14} />} onClick={() => diagnostics && void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))}>Copy diagnostics</Button><Button variant="ghost" onClick={() => { update('sidebarOpen', true); update('uiScale', 1) }}>Reset UI layout only</Button></div>
        </SettingsSection>}
      </section>
    </div>
    {customShellPath && <TextPromptDialog title="Add custom shell" label="Shell name" initialValue="Custom shell" confirmLabel="Add shell" onClose={() => setCustomShellPath(undefined)} onConfirm={async (name) => { const path = customShellPath; setCustomShellPath(undefined); if (!path) return; try { await native.saveCustomShell(name, path); setShells(await native.detectShells()); setStatus('Custom shell added') } catch (caught) { setError(asNativeError(caught).message) } }} />}
  </main>
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="focused-section"><header><h2>{title}</h2><p>{description}</p></header><div className="setting-rows">{children}</div></div> }
function SettingRow({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) { return <label className="setting-row"><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><div>{children}</div></label> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="setting-row toggle-row"><span><strong>{label}</strong></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label> }
