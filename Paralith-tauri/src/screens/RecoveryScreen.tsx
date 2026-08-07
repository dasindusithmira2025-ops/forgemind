import { useEffect, useState } from 'react'
import { openPath, openUrl } from '@tauri-apps/plugin-opener'
import { AlertTriangle, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { confirm } from '../components/ui/confirm'
import { asNativeError, native } from '../native/commands'
import type { StartupStatus, UpdateStatus } from '../native/types'

export function RecoveryScreen({ startup }: { startup: StartupStatus }) {
  const [update, setUpdate] = useState<UpdateStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void native.getUpdateStatus().then(setUpdate).catch(() => undefined) }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (caught) { setError(asNativeError(caught).message) } finally { setBusy(false) }
  }
  const restore = async () => {
    if (!startup.latestBackupPath || !(await confirm({
      title: 'Restore the backup and restart?',
      body: 'PARALITH restores the validated pre-migration database.',
      details: ['The current failed database is retained separately.', 'PARALITH restarts immediately.'],
      confirmLabel: 'Restore and restart',
    }))) return
    await native.stageDatabaseBackupRestore(startup.latestBackupPath)
    await native.restartAfterRecovery()
  }
  return <main className="recovery-shell">
    <header><Brand /><span>SAFE RECOVERY MODE</span></header>
    <section>
      <AlertTriangle size={28} />
      <h1>PARALITH stopped the update startup loop.</h1>
      <p>{startup.message || 'The post-update startup health check was not confirmed.'}</p>
      {error && <ErrorNotice message={error} />}
      <dl>
        <div><dt>Failing app version</dt><dd>{startup.failingAppVersion || update?.build.version || 'Unknown'}</dd></div>
        <div><dt>Failing schema version</dt><dd>{startup.failingSchemaVersion ?? update?.build.databaseSchemaVersion ?? 'Unknown'}</dd></div>
        <div><dt>Edition</dt><dd>{update?.build.edition || 'Unknown'}</dd></div>
        <div><dt>Latest recovery backup</dt><dd>{startup.latestBackupPath || 'No migration backup recorded'}</dd></div>
      </dl>
      <div className="recovery-actions">
        <Button icon={<RefreshCw size={14} />} disabled={busy} onClick={() => void run(native.restartAfterRecovery)}>Retry Startup</Button>
        <Button icon={<RotateCcw size={14} />} disabled={busy || !startup.latestBackupPath} onClick={() => void run(restore)}>Restore Database Backup</Button>
        <Button icon={<FolderOpen size={14} />} disabled={!update} onClick={() => update && void openPath(update.updateDataDirectory)}>Open Update Diagnostics</Button>
        {startup.previousInstallerUrl && <Button variant="ghost" onClick={() => void openUrl(startup.previousInstallerUrl!)}>Open Previous Installer</Button>}
      </div>
      <small>PARALITH never downgrades a migrated database automatically. Backup restoration occurs only after this explicit action.</small>
    </section>
  </main>
}
