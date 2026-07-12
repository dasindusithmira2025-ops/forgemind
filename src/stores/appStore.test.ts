import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './appStore'
import type { TerminalSession, Workspace } from '../native/types'

const session: TerminalSession = { id: 'session', workspaceId: 'workspace', paneId: 'pane', provider: 'codex', title: 'Codex', workingDirectory: 'C:\\project', status: 'running', processId: 42, startedAt: new Date().toISOString(), outputTail: [], nextSequence: 0 }
const workspace: Workspace = { id: 'workspace', projectId: 'project', name: 'Workspace', layout: { type: 'pane', paneId: 'pane' }, activePaneId: 'pane', panes: [{ id: 'pane', title: 'Codex', provider: 'codex', executablePath: 'codex.exe', args: [], workingDirectory: 'C:\\project', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: '' }

describe('application store', () => {
  beforeEach(() => useAppStore.setState({ workspace: undefined, sessions: {}, activePaneId: undefined }))

  it('hydrates active pane from workspace', () => {
    useAppStore.getState().setWorkspace(workspace)
    expect(useAppStore.getState().activePaneId).toBe('pane')
  })

  it('deduplicates terminal sessions by native session id', () => {
    useAppStore.getState().upsertSession(session)
    useAppStore.getState().upsertSession({ ...session, title: 'Updated' })
    expect(Object.values(useAppStore.getState().sessions)).toHaveLength(1)
    expect(useAppStore.getState().sessions.session.title).toBe('Updated')
  })

  it('applies exit once and cleans removed sessions', () => {
    useAppStore.getState().upsertSession(session)
    useAppStore.getState().markSessionExited('session', 3)
    useAppStore.getState().markSessionExited('session', 7)
    expect(useAppStore.getState().sessions.session.exitCode).toBe(3)
    useAppStore.getState().removeSession('session')
    expect(useAppStore.getState().sessions).toEqual({})
  })
})
