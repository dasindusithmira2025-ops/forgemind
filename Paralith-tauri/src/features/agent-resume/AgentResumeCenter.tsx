import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Check,
  Clipboard,
  ExternalLink,
  FolderSearch,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { asNativeError, native } from '../../native/commands'
import type { AgentResumeRecord, ResumeAgentSessionResult } from '../../native/types'
import { terminalRuntime } from '../terminals/runtimeStore'
import { OPEN_AGENT_RESUME_CENTER, WORKSPACE_CONFIGURATION_CHANGED } from './events'

const BATCH_CONCURRENCY = 2
const STARTUP_OPEN_KEY = 'paralith.agent-resume.startup-opened'

type FailureMap = Record<string, string>

function isRecoverable(record: AgentResumeRecord) {
  return record.recoveryStatus === 'resumable'
}

function statusLabel(status: AgentResumeRecord['recoveryStatus']) {
  return status.replaceAll('_', ' ')
}

function lastActive(value: string) {
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return 'Unknown'
  const seconds = Math.max(0, Math.floor((Date.now() - time.getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return time.toLocaleDateString()
}

export function AgentResumeCenter() {
  const navigate = useNavigate()
  const [openCenter, setOpenCenter] = useState(false)
  const [records, setRecords] = useState<AgentResumeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [failures, setFailures] = useState<FailureMap>({})
  const [batchRunning, setBatchRunning] = useState(false)
  const cancelBatch = useRef(false)

  const refresh = useCallback(async (reconcile = false) => {
    setLoading(true)
    try {
      const next = reconcile
        ? await native.reconcileAgentResumeSessions()
        : await native.listAgentResumeSessions()
      setRecords(next.filter((record) => record.recoveryStatus !== 'completed' && record.recoveryStatus !== 'restored'))
      return next
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void refresh(true).then((next) => {
      if (!active || !next.some(isRecoverable)) return
      let opened = false
      try { opened = sessionStorage.getItem(STARTUP_OPEN_KEY) === '1' } catch { opened = false }
      if (!opened) {
        try { sessionStorage.setItem(STARTUP_OPEN_KEY, '1') } catch { /* unavailable storage */ }
        setOpenCenter(true)
      }
    }).catch(() => undefined)
    const show = () => { setOpenCenter(true); void refresh(true).catch(() => undefined) }
    window.addEventListener(OPEN_AGENT_RESUME_CENTER, show)
    return () => { active = false; window.removeEventListener(OPEN_AGENT_RESUME_CENTER, show) }
  }, [refresh])

  const finishResume = useCallback((result: ResumeAgentSessionResult) => {
    terminalRuntime.remove(result.sourceTerminalSessionId)
    terminalRuntime.upsert(result.terminal)
    terminalFocus(result)
    navigate(`/workspace/${result.workspaceId}`)
    setOpenCenter(false)
  }, [navigate])

  const resumeOne = useCallback(async (record: AgentResumeRecord, inNewTerminal = false) => {
    if (busy.has(record.terminalSessionId)) return
    setBusy((current) => new Set(current).add(record.terminalSessionId))
    setFailures((current) => ({ ...current, [record.terminalSessionId]: '' }))
    try {
      await native.openProjectSession(record.projectId, true)
      const result = await native.resumeAgentSession({
        terminalSessionId: record.terminalSessionId,
        inNewTerminal,
        cols: 100,
        rows: 30,
      })
      finishResume(result)
    } catch (caught) {
      setFailures((current) => ({
        ...current,
        [record.terminalSessionId]: asNativeError(caught).message,
      }))
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(record.terminalSessionId)
        return next
      })
      await refresh().catch(() => undefined)
    }
  }, [busy, finishResume, refresh])

  const resumeAll = useCallback(async () => {
    if (batchRunning) return
    const queue = records.filter((record) => record.recoveryStatus === 'resumable')
    if (queue.length === 0) return
    cancelBatch.current = false
    setBatchRunning(true)
    setFailures({})
    let cursor = 0
    let focused = false
    const worker = async () => {
      while (!cancelBatch.current) {
        const index = cursor
        cursor += 1
        const record = queue[index]
        if (!record) return
        setBusy((current) => new Set(current).add(record.terminalSessionId))
        try {
          await native.openProjectSession(record.projectId, false)
          const result = await native.resumeAgentSession({
            terminalSessionId: record.terminalSessionId,
            inNewTerminal: false,
            cols: 100,
            rows: 30,
          })
          terminalRuntime.remove(result.sourceTerminalSessionId)
          terminalRuntime.upsert(result.terminal)
          if (!focused) {
            focused = true
            terminalFocus(result)
            navigate(`/workspace/${result.workspaceId}`)
          }
        } catch (caught) {
          setFailures((current) => ({
            ...current,
            [record.terminalSessionId]: asNativeError(caught).message,
          }))
        } finally {
          setBusy((current) => {
            const next = new Set(current)
            next.delete(record.terminalSessionId)
            return next
          })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, worker))
    setBatchRunning(false)
    await refresh().catch(() => undefined)
  }, [batchRunning, navigate, records, refresh])

  const openProject = async (record: AgentResumeRecord) => {
    try {
      await native.openProjectSession(record.projectId, true)
      navigate(`/workspace/${record.workspaceId}`)
      setOpenCenter(false)
    } catch (caught) {
      setFailures((current) => ({ ...current, [record.terminalSessionId]: asNativeError(caught).message }))
    }
  }

  const locateProject = async (record: AgentResumeRecord) => {
    const selected = await open({ directory: true, multiple: false, title: `Locate ${record.projectName}` })
    if (typeof selected !== 'string') return
    try {
      await native.relocateProject(record.projectId, selected)
      await refresh(true)
    } catch (caught) {
      setFailures((current) => ({ ...current, [record.terminalSessionId]: asNativeError(caught).message }))
    }
  }

  const selectWorktree = async (record: AgentResumeRecord) => {
    const selected = await open({ directory: true, multiple: false, title: 'Select a worktree from the same repository' })
    if (typeof selected !== 'string') return
    try {
      await native.relocateAgentResumeWorktree(record.terminalSessionId, selected)
      await refresh(true)
    } catch (caught) {
      setFailures((current) => ({ ...current, [record.terminalSessionId]: asNativeError(caught).message }))
    }
  }

  const mutate = async (action: () => Promise<unknown>) => {
    await action()
    await refresh()
  }

  const resumableCount = useMemo(
    () => records.filter((record) => record.recoveryStatus === 'resumable').length,
    [records],
  )

  if (!openCenter) return null

  return (
    <Modal title="Agent Resume Center" onClose={() => { cancelBatch.current = true; setOpenCenter(false) }}>
      <div className="agent-resume-center">
        <div className="agent-resume-intro">
          <div>
            <strong>{records.length} saved session{records.length === 1 ? '' : 's'}</strong>
            <span>Exact Claude and Codex sessions tied to their original worktrees.</span>
          </div>
          <Button variant="ghost" icon={<RotateCcw size={14} />} disabled={loading} onClick={() => void refresh(true)}>Recheck</Button>
        </div>

        {records.length === 0 ? (
          <div className="agent-resume-empty">
            <Check size={18} />
            <strong>No agent sessions need recovery.</strong>
            <span>Sessions that stop during an update, restart, or crash will appear here.</span>
          </div>
        ) : (
          <div className="agent-resume-list">
            {records.map((record) => {
              const working = busy.has(record.terminalSessionId)
              const canRecreatePane = record.errorCode === 'pane_missing'
              const missingPath = ['project_missing', 'worktree_missing', 'working_directory_missing', 'working_directory_mismatch'].includes(record.errorCode ?? '')
              return (
                <article className={`agent-resume-row is-${record.recoveryStatus}`} key={record.terminalSessionId}>
                  <div className={`agent-resume-provider is-${record.provider}`} aria-label={record.provider}>
                    {record.provider === 'claude' ? 'CL' : 'CX'}
                  </div>
                  <div className="agent-resume-main">
                    <div className="agent-resume-heading">
                      <strong title={record.sessionTitle}>{record.sessionTitle}</strong>
                      <span className={`agent-resume-status is-${record.recoveryStatus}`}>{statusLabel(record.recoveryStatus)}</span>
                      <time dateTime={record.lastActivityAt}>{lastActive(record.lastActivityAt)}</time>
                    </div>
                    <div className="agent-resume-location">
                      <span>{record.projectName}</span>
                      <span>{record.workspaceName}</span>
                      <span title={record.worktreePath}>{record.branch || 'detached'} · {record.worktreePath}</span>
                    </div>
                    <code className="agent-resume-command" title={record.commandPreview}>{record.commandPreview}</code>
                    {(record.errorMessage || failures[record.terminalSessionId]) && (
                      <p className="agent-resume-error" role="alert">{failures[record.terminalSessionId] || record.errorMessage}</p>
                    )}
                    <div className="agent-resume-actions">
                      {/* Per-record action: secondary, so the footer's "Resume all" stays the one
                          accent-filled control in this dialog (design.md §7.1). */}
                      <Button variant="secondary" icon={<Play size={13} />} disabled={working || record.recoveryStatus !== 'resumable'} onClick={() => void resumeOne(record)}>Resume</Button>
                      <button disabled={working || (record.recoveryStatus !== 'resumable' && !canRecreatePane)} onClick={() => void resumeOne(record, true)}>Resume in new terminal</button>
                      <button onClick={() => void openProject(record)}><ExternalLink size={13} />Open project</button>
                      <button onClick={() => void navigator.clipboard.writeText(record.commandPreview)}><Clipboard size={13} />Copy command</button>
                      {missingPath && <button onClick={() => void locateProject(record)}><FolderSearch size={13} />Locate project</button>}
                      {missingPath && <button onClick={() => void selectWorktree(record)}>Select worktree</button>}
                      <button onClick={() => void mutate(() => native.dismissAgentResumeSession(record.terminalSessionId))}><X size={13} />Dismiss</button>
                      <button className="danger-item" disabled={working || ['running', 'launching', 'detached'].includes(record.recoveryStatus)} onClick={() => void mutate(() => native.removeAgentResumeSession(record.terminalSessionId))}><Trash2 size={13} />Remove</button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        <footer className="agent-resume-footer">
          <Button variant="ghost" disabled={batchRunning || records.length === 0} onClick={() => void mutate(() => native.dismissAllAgentResumeSessions())}>Dismiss all</Button>
          {batchRunning ? (
            <Button variant="danger" onClick={() => { cancelBatch.current = true }}>Cancel remaining</Button>
          ) : (
            <Button variant="primary" icon={<Play size={14} />} disabled={resumableCount === 0} onClick={() => void resumeAll()}>Resume all ({resumableCount})</Button>
          )}
        </footer>
      </div>
    </Modal>
  )
}

function terminalFocus(result: ResumeAgentSessionResult) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CONFIGURATION_CHANGED, {
    detail: { workspaceId: result.workspaceId, paneId: result.paneId },
  }))
}
