import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MissionBundle, SaveMissionRequest } from './missionTypes'
import { chooseComposerDraft, emptyComposerDraft, MissionDraftCoordinator, sanitizeRecoveryDraft, serializeComposerDraft, type ComposerDraft, type DraftSaveStatus, type RecoveryStore } from './missionDraft'

function bundle(request: SaveMissionRequest, updatedAt = '2026-07-14T00:00:00.000Z'): MissionBundle {
  return {
    mission: {
      id: request.id as string,
      projectId: request.projectId,
      originWorkspaceId: request.originWorkspaceId,
      title: request.title,
      objective: request.objective,
      constraints: request.constraints,
      referencePaths: request.referencePaths,
      preferredAgentIds: request.preferredAgentIds,
      status: request.status ?? 'draft',
      executionMode: request.executionMode,
      riskLevel: request.riskLevel,
      permissionProfile: request.permissionProfile,
      verificationProfileId: request.verificationProfileId,
      createdAt: updatedAt,
      updatedAt,
    },
    acceptanceCriteria: request.acceptanceCriteria.map((criterion) => ({ id: criterion.id as string, missionId: request.id as string, description: criterion.description, required: criterion.required, status: 'pending', evidenceIds: [] })),
    tasks: [], worktrees: [], sessions: [], events: [], verificationResults: [], evidence: [], auditEvents: [], recovery: [],
  }
}

function populated(projectId = 'project-a'): ComposerDraft {
  const value = emptyComposerDraft(projectId, 'workspace-a')
  return {
    ...value,
    updatedAt: '2026-07-14T01:00:00.000Z',
    title: ' Ship a status page ',
    objective: ' Restore every field ',
    criteria: [{ id: 'criterion-a', description: ' It reloads ', required: true }],
    constraints: ' Keep routes\n\nNo backend ',
    references: 'src\n package.json ',
    executionMode: 'manual-plan',
    riskLevel: 'high',
    permissionProfile: 'read-only',
    verificationProfileId: 'profile-a',
    preferredAgentIds: ['agent-a', 'agent-b'],
  }
}

function memoryRecovery(overrides: Partial<RecoveryStore> = {}): RecoveryStore {
  const values = new Map<string, ComposerDraft>()
  return {
    read: (projectId) => values.get(projectId),
    write: (projectId, value) => { values.set(projectId, structuredClone(value)) },
    remove: (projectId) => { values.delete(projectId) },
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('Mission Composer draft serialization', () => {
  it('produces only the exact plain backend values', () => {
    const request = serializeComposerDraft(populated())
    expect(request).toEqual({
      id: expect.any(String), projectId: 'project-a', originWorkspaceId: 'workspace-a', title: 'Ship a status page', objective: 'Restore every field',
      constraints: ['Keep routes', 'No backend'], referencePaths: ['src', 'package.json'], preferredAgentIds: ['agent-a', 'agent-b'], status: 'draft',
      executionMode: 'manual-plan', riskLevel: 'high', permissionProfile: 'read-only', verificationProfileId: 'profile-a',
      acceptanceCriteria: [{ id: 'criterion-a', description: 'It reloads', required: true }],
    })
    expect(JSON.parse(JSON.stringify(request))).toEqual(request)
    expect(JSON.stringify(request)).not.toContain('undefined')
  })

  it('uses explicit nulls for nullable backend values', () => {
    const request = serializeComposerDraft({ ...populated(), originWorkspaceId: null, verificationProfileId: null })
    expect(request.originWorkspaceId).toBeNull()
    expect(request.verificationProfileId).toBeNull()
  })
})

describe('Mission Draft save coordination', () => {
  it('debounces rapid changes and prevents duplicate creation under Strict Mode identities', async () => {
    vi.useFakeTimers()
    const first = emptyComposerDraft('strict-project')
    const remount = emptyComposerDraft('strict-project')
    expect(remount.id).toBe(first.id)
    const save = vi.fn(async (request: SaveMissionRequest) => bundle(request))
    const coordinator = new MissionDraftCoordinator({ saveCanonical: save, recovery: memoryRecovery(), onStatus: () => undefined })
    coordinator.schedule({ request: serializeComposerDraft({ ...first, title: 'a' }), recovery: { ...first, title: 'a' } })
    coordinator.schedule({ request: serializeComposerDraft({ ...first, title: 'ab' }), recovery: { ...first, title: 'ab' } })
    coordinator.schedule({ request: serializeComposerDraft({ ...first, title: 'abc' }), recovery: { ...first, title: 'abc' } })
    await vi.advanceTimersByTimeAsync(650)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].id).toBe(first.id)
    expect(save.mock.calls[0][0].title).toBe('abc')
  })

  it('allows one active save and never lets an older response win', async () => {
    vi.useFakeTimers()
    const draft = populated()
    const one = deferred<MissionBundle>()
    const two = deferred<MissionBundle>()
    const save = vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise)
    const statuses: DraftSaveStatus[] = []
    const coordinator = new MissionDraftCoordinator({ saveCanonical: save, recovery: memoryRecovery(), onStatus: (status) => statuses.push(status) })
    const first = { ...draft, title: 'older' }
    coordinator.schedule({ request: serializeComposerDraft(first), recovery: first })
    await vi.advanceTimersByTimeAsync(650)
    const latest = { ...draft, title: 'latest' }
    coordinator.schedule({ request: serializeComposerDraft(latest), recovery: latest })
    await vi.advanceTimersByTimeAsync(650)
    expect(save).toHaveBeenCalledTimes(1)
    one.resolve(bundle(serializeComposerDraft(first)))
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(statuses.at(-1)?.canonical).not.toBe('saved')
    two.resolve(bundle(serializeComposerDraft(latest)))
    await coordinator.flush()
    expect(statuses.at(-1)?.canonical).toBe('saved')
    expect(save.mock.calls[1][0].title).toBe('latest')
  })

  it('manual save flushes the latest state without racing autosave', async () => {
    vi.useFakeTimers()
    const draft = populated()
    const save = vi.fn(async (request: SaveMissionRequest) => bundle(request))
    const coordinator = new MissionDraftCoordinator({ saveCanonical: save, recovery: memoryRecovery(), onStatus: () => undefined })
    coordinator.schedule({ request: serializeComposerDraft({ ...draft, title: 'old' }), recovery: { ...draft, title: 'old' } })
    coordinator.schedule({ request: serializeComposerDraft({ ...draft, title: 'manual latest' }), recovery: { ...draft, title: 'manual latest' } })
    const saved = await coordinator.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(saved.mission.title).toBe('manual latest')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps one stable Draft ID across later autosaves', async () => {
    vi.useFakeTimers()
    const draft = populated()
    const ids: Array<string | null | undefined> = []
    const coordinator = new MissionDraftCoordinator({ saveCanonical: async (request) => { ids.push(request.id); return bundle(request) }, recovery: memoryRecovery(), onStatus: () => undefined })
    coordinator.schedule({ request: serializeComposerDraft(draft), recovery: draft })
    await vi.advanceTimersByTimeAsync(650)
    const edited = { ...draft, objective: 'edited' }
    coordinator.schedule({ request: serializeComposerDraft(edited), recovery: edited })
    await vi.advanceTimersByTimeAsync(650)
    expect(ids).toEqual([draft.id, draft.id])
  })

  it('reports canonical success with only a non-blocking recovery warning', async () => {
    vi.useFakeTimers()
    const draft = populated()
    const statuses: DraftSaveStatus[] = []
    const coordinator = new MissionDraftCoordinator({ saveCanonical: async (request) => bundle(request), recovery: memoryRecovery({ write: () => { throw new Error('quota unavailable') } }), onStatus: (status) => statuses.push(status) })
    coordinator.schedule({ request: serializeComposerDraft(draft), recovery: draft })
    await vi.advanceTimersByTimeAsync(650)
    expect(statuses.at(-1)?.canonical).toBe('saved')
    expect(statuses.at(-1)?.recoveryWarning).toContain('quota unavailable')
  })

  it('preserves the latest form snapshot after failure and retries it', async () => {
    const draft = populated()
    const statuses: DraftSaveStatus[] = []
    const save = vi.fn().mockRejectedValueOnce({ code: 'database_error', message: 'Database unavailable', detail: 'locked', sourceLayer: 'persistence' }).mockImplementation(async (request: SaveMissionRequest) => bundle(request))
    const coordinator = new MissionDraftCoordinator({ saveCanonical: save, recovery: memoryRecovery(), onStatus: (status) => statuses.push(status) })
    coordinator.schedule({ request: serializeComposerDraft(draft), recovery: draft })
    await expect(coordinator.flush()).rejects.toMatchObject({ code: 'database_error' })
    expect(statuses.at(-1)).toMatchObject({ canonical: 'error', message: 'Database unavailable' })
    const saved = await coordinator.retry()
    expect(saved.mission.objective).toBe('Restore every field')
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0])
  })

  it('cancels stale completion when the Project route is disposed', async () => {
    const draft = populated()
    const pending = deferred<MissionBundle>()
    const statuses: DraftSaveStatus[] = []
    const onSaved = vi.fn()
    const coordinator = new MissionDraftCoordinator({ saveCanonical: () => pending.promise, recovery: memoryRecovery(), onStatus: (status) => statuses.push(status), onSaved })
    coordinator.schedule({ request: serializeComposerDraft(draft), recovery: draft })
    const flushing = coordinator.flush()
    coordinator.dispose()
    pending.resolve(bundle(serializeComposerDraft(draft)))
    await expect(flushing).rejects.toThrow('route is no longer active')
    expect(onSaved).not.toHaveBeenCalled()
    expect(statuses.some((status) => status.canonical === 'saved')).toBe(false)
  })
})

describe('Mission Draft restoration and Project isolation', () => {
  it('reloads every persisted field from the canonical database bundle', () => {
    const original = populated()
    const restored = chooseComposerDraft('project-a', bundle(serializeComposerDraft(original)), undefined)
    expect(restored).toMatchObject({
      id: original.id, projectId: 'project-a', title: 'Ship a status page', objective: 'Restore every field', constraints: 'Keep routes\nNo backend', references: 'src\npackage.json',
      executionMode: 'manual-plan', riskLevel: 'high', permissionProfile: 'read-only', verificationProfileId: 'profile-a', preferredAgentIds: ['agent-a', 'agent-b'], originWorkspaceId: 'workspace-a',
    })
    expect(restored.criteria).toEqual([{ id: 'criterion-a', description: 'It reloads', required: true }])
  })

  it('uses a newer recovery copy but retains the canonical stable ID', () => {
    const canonical = populated()
    const recovery = { ...canonical, id: 'recovery-id', updatedAt: '2026-07-14T02:00:00.000Z', title: 'newer crash recovery' }
    const restored = chooseComposerDraft('project-a', bundle(serializeComposerDraft(canonical), '2026-07-14T01:30:00.000Z'), recovery)
    expect(restored.id).toBe(canonical.id)
    expect(restored.title).toBe('newer crash recovery')
  })

  it('never restores a Draft under a different Project', () => {
    const foreign = populated('project-a')
    expect(sanitizeRecoveryDraft(foreign, 'project-b')).toBeUndefined()
    const selected = chooseComposerDraft('project-b', undefined, foreign)
    expect(selected.projectId).toBe('project-b')
    expect(selected.title).toBe('')
    expect(selected.id).not.toBe(foreign.id)
  })
})
