import { useEffect, useState } from 'react'
import { Activity, ClipboardCopy, FolderOpen, RefreshCw, X } from 'lucide-react'
import { openPath } from '@tauri-apps/plugin-opener'
import { asNativeError, native } from '../../../native/commands'
import type { DiagnosticsSnapshot, HealthReport, Project } from '../../../native/types'
import type { SidebarWorkspace } from '../sidebarTypes'
import { runtimeStatusLabel } from '../sidebarSelectors'

/**
 * A real Diagnostics drawer backed by the existing `get_diagnostics`/`run_health_check`
 * commands. It surfaces version, paths, current context, and per-Workspace runtime
 * summaries, and can copy a redacted summary — never secrets, tokens, or terminal output.
 */
export function DiagnosticsDrawer({
  project,
  activeWorkspaceName,
  workspaces,
  onClose,
}: {
  project: Project
  activeWorkspaceName: string
  workspaces: SidebarWorkspace[]
  onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>()
  const [health, setHealth] = useState<HealthReport>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    void native
      .getDiagnostics()
      .then((value) => live && setSnapshot(value))
      .catch((caught) => live && setError(asNativeError(caught).message))
    return () => {
      live = false
    }
  }, [])

  const buildSummary = () =>
    [
      `PARALITH ${snapshot?.applicationVersion ?? 'unknown'}`,
      `Schema version: ${snapshot?.schemaVersion ?? '—'}`,
      `Database: ${snapshot?.databasePath ?? '—'}`,
      `Logs: ${snapshot?.logDirectory ?? '—'}`,
      `Live terminals: ${snapshot?.liveTerminalCount ?? 0}`,
      `Project: ${project.name} (${project.rootPath})`,
      `Active workspace: ${activeWorkspaceName}`,
      'Workspace runtime:',
      ...workspaces.map(
        (entry) =>
          `  - ${entry.workspace.name}: ${runtimeStatusLabel(entry.runtime.status)} · ` +
          `${entry.runtime.runningCount}/${entry.runtime.configuredPaneCount} running`,
      ),
      `Health: ${(health ?? snapshot?.health)?.messages.join('; ') ?? 'not run'}`,
    ].join('\n')

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildSummary())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (caught) {
      setError(asNativeError(caught).message)
    }
  }

  const runHealth = async () => {
    setBusy(true)
    try {
      setHealth(await native.runHealthCheck())
    } catch (caught) {
      setError(asNativeError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  const effectiveHealth = health ?? snapshot?.health

  return (
    <>
      <button className="drawer-scrim" aria-label="Close diagnostics" onClick={onClose} />
      <aside className="diagnostics-drawer" role="dialog" aria-label="Diagnostics">
        <header className="diagnostics-head">
          <span className="diagnostics-title">
            <Activity size={16} />
            Diagnostics
          </span>
          <button type="button" aria-label="Close diagnostics" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {error && <p className="diagnostics-error">{error}</p>}

        <dl className="diagnostics-facts">
          <div>
            <dt>Version</dt>
            <dd>{snapshot?.applicationVersion ?? '…'}</dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>v{snapshot?.schemaVersion ?? '…'}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd className="path-text" title={snapshot?.databasePath}>
              {snapshot?.databasePath ?? '…'}
            </dd>
          </div>
          <div>
            <dt>Logs</dt>
            <dd className="path-text" title={snapshot?.logDirectory}>
              {snapshot?.logDirectory ?? '…'}
            </dd>
          </div>
          <div>
            <dt>Live terminals</dt>
            <dd>{snapshot?.liveTerminalCount ?? 0}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{project.name}</dd>
          </div>
          <div>
            <dt>Active workspace</dt>
            <dd>{activeWorkspaceName}</dd>
          </div>
        </dl>

        <section className="diagnostics-runtime">
          <h3>Workspace runtime</h3>
          <ul>
            {workspaces.map((entry) => (
              <li key={entry.workspace.id}>
                <span>{entry.workspace.name}</span>
                <span className="diagnostics-runtime-status">
                  {runtimeStatusLabel(entry.runtime.status)} · {entry.runtime.runningCount}/
                  {entry.runtime.configuredPaneCount}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {effectiveHealth && (
          <section className={`diagnostics-health ${effectiveHealth.healthy ? 'ok' : 'warn'}`}>
            <h3>{effectiveHealth.healthy ? 'Healthy' : 'Needs attention'}</h3>
            <ul>
              {effectiveHealth.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>
        )}

        <footer className="diagnostics-actions">
          <button type="button" onClick={() => void runHealth()} disabled={busy}>
            <RefreshCw size={14} className={busy ? 'is-spinning' : ''} />
            Run health check
          </button>
          <button
            type="button"
            onClick={() => snapshot && void openPath(snapshot.logDirectory).catch(() => undefined)}
          >
            <FolderOpen size={14} />
            Open logs
          </button>
          <button type="button" onClick={() => void copySummary()}>
            <ClipboardCopy size={14} />
            {copied ? 'Copied' : 'Copy summary'}
          </button>
        </footer>
      </aside>
    </>
  )
}
