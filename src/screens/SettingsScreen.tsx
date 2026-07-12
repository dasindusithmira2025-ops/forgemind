import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowLeft, RefreshCw, Save } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import type { AgentProvider, AppSettings, ShellProfile } from '../native/types'
import { defaultSettings, useAppStore } from '../stores/appStore'

export function SettingsScreen() {
  const navigate = useNavigate()
  const stored = useAppStore((state) => state.settings)
  const setStored = useAppStore((state) => state.setSettings)
  const [settings, setSettings] = useState<AppSettings>(stored ?? defaultSettings)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('')
  const [customShellPath, setCustomShellPath] = useState<string>()
  const [shells, setShells] = useState<ShellProfile[]>([])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale))
    return () => document.documentElement.style.setProperty('--ui-scale', String(stored.uiScale))
  }, [settings.uiScale, stored.uiScale])
  useEffect(() => { void native.detectShells().then(setShells).catch(() => setShells([])) }, [])
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => { setSettings((current) => ({ ...current, [key]: value })); setSaved(false); setStatus('Unsaved changes') }
  const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  const save = async () => {
    if (saving) return
    setSaving(true)
    try { const result = await native.saveSettings(settings); setSettings(result); setStored(result); setSaved(true); setStatus('Settings saved'); setError('') }
    catch (caught) { setError(asNativeError(caught).message); setStatus('Save failed') }
    finally { setSaving(false) }
  }
  const customPaths = () => [settings.claudeExecutablePath && { provider: 'claude', path: settings.claudeExecutablePath }, settings.codexExecutablePath && { provider: 'codex', path: settings.codexExecutablePath }, settings.opencodeExecutablePath && { provider: 'opencode', path: settings.opencodeExecutablePath }].filter((item): item is { provider: string; path: string } => Boolean(item))
  const rescan = async () => {
    if (scanning) return
    setScanning(true); setStatus('Scanning for installed agents'); setError('')
    try { await native.detectAgents(true, customPaths()); setStatus('Agent scan complete') }
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
  const addCustomShell = async () => {
    const selected = await open({ directory: false, multiple: false, title: 'Locate custom shell executable' })
    if (!selected || Array.isArray(selected)) return
    setCustomShellPath(selected)
  }
  const saveCustomShell = async (name: string) => {
    const path = customShellPath
    setCustomShellPath(undefined)
    if (!path) return
    try { await native.saveCustomShell(name, path); setShells(await native.detectShells()); setStatus('Custom shell added') }
    catch (caught) { setError(asNativeError(caught).message) }
  }

  return <main className="settings-shell"><header><Brand /><Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>Back</Button><h1>Settings</h1><div className="settings-save"><span role="status" aria-live="polite">{status}</span><Button variant="primary" icon={<Save size={15} />} onClick={() => void save()} disabled={saving || saved}>{saving ? 'Saving' : saved ? 'Saved' : 'Save settings'}</Button></div></header>{error && <ErrorNotice message={error} />}<div className="settings-content">
    <SettingsSection title="Appearance" description="Terminal rendering updates immediately in open panes.">
      <label><span>UI scale</span><input type="range" min="0.8" max="1.5" step="0.05" value={settings.uiScale} onChange={(event) => update('uiScale', Number(event.target.value))} /><output>{Math.round(settings.uiScale * 100)}%</output></label>
      <label><span>Terminal font size</span><input type="number" min="9" max="30" value={settings.terminalFontSize} onChange={(event) => update('terminalFontSize', Number(event.target.value))} onBlur={(event) => update('terminalFontSize', clamp(Math.round(Number(event.target.value)), 9, 30))} /></label>
      <label><span>Terminal font family</span><input value={settings.terminalFontFamily} onChange={(event) => update('terminalFontFamily', event.target.value)} /></label>
      <label><span>Line height</span><input type="range" min="0.9" max="2" step="0.05" value={settings.terminalLineHeight} onChange={(event) => update('terminalLineHeight', Number(event.target.value))} /><output>{settings.terminalLineHeight.toFixed(2)}</output></label>
      <label><span>Cursor style</span><select value={settings.cursorStyle} onChange={(event) => update('cursorStyle', event.target.value as AppSettings['cursorStyle'])}><option value="block">Block</option><option value="bar">Bar</option><option value="underline">Underline</option></select></label>
    </SettingsSection>
    <SettingsSection title="Terminal" description="Controls scrollback and safeguards for terminal interaction.">
      <label><span>Default shell</span><select value={settings.defaultShell ?? ''} onChange={(event) => update('defaultShell', event.target.value || undefined)}><option value="">Automatic</option>{shells.map((shell) => <option key={shell.id} value={shell.id}>{shell.name}</option>)}</select></label>
      <label><span>Scrollback lines</span><input type="number" min="1000" max="100000" step="1000" value={settings.scrollbackSize} onChange={(event) => update('scrollbackSize', Number(event.target.value))} onBlur={(event) => update('scrollbackSize', clamp(Math.round(Number(event.target.value)), 1000, 100000))} /></label>
      <Toggle label="Copy on select" checked={settings.copyOnSelect} onChange={(value) => update('copyOnSelect', value)} />
      <Toggle label="Confirm multiline paste" checked={settings.confirmMultilinePaste} onChange={(value) => update('confirmMultilinePaste', value)} />
      <Toggle label="Confirm before closing a running pane" checked={settings.confirmClosePane} onChange={(value) => update('confirmClosePane', value)} />
      <div className="settings-action"><span>Custom shell profiles are validated and saved locally.</span><Button onClick={() => void addCustomShell()}>Add custom shell</Button></div>
    </SettingsSection>
    <SettingsSection title="Agents" description="ForgeMind performs a bounded version check and never starts an interactive agent during detection.">
      <ExecutableSetting label="Claude Code" value={settings.claudeExecutablePath} onLocate={() => void locate('claude')} onReset={() => update('claudeExecutablePath', undefined)} />
      <ExecutableSetting label="Codex CLI" value={settings.codexExecutablePath} onLocate={() => void locate('codex')} onReset={() => update('codexExecutablePath', undefined)} />
      <ExecutableSetting label="OpenCode" value={settings.opencodeExecutablePath} onLocate={() => void locate('opencode')} onReset={() => update('opencodeExecutablePath', undefined)} />
      <div className="settings-action"><span>Refresh all configured agent paths.</span><Button icon={<RefreshCw className={scanning ? 'is-spinning' : ''} size={14} />} onClick={() => void rescan()} disabled={scanning}>{scanning ? 'Scanning' : 'Re-scan all'}</Button></div>
    </SettingsSection>
  </div>{customShellPath && <TextPromptDialog title="Add custom shell" label="Shell name" initialValue="Custom shell" confirmLabel="Add shell" onClose={() => setCustomShellPath(undefined)} onConfirm={(name) => void saveCustomShell(name)} />}</main>
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="settings-section"><div><h2>{title}</h2><p>{description}</p></div><div className="settings-fields">{children}</div></section> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label> }
function ExecutableSetting({ label, value, onLocate, onReset }: { label: string; value?: string; onLocate: () => void; onReset: () => void }) { return <div className="executable-setting"><div><strong>{label}</strong><span title={value}>{value || 'Automatic detection'}</span></div><Button onClick={onLocate}>Locate</Button>{value && <Button variant="ghost" onClick={onReset}>Reset</Button>}</div> }
