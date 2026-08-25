import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AcceptanceCriterion,
  Mission,
  MissionDetail,
  MissionSummary,
  MissionTask,
} from './missionTypes'

/** A stand-in for the Rust service: it owns state, and the surface may only ask it for things. */
const backend = {
  missions: [] as MissionSummary[],
  detail: null as MissionDetail | null,
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    projectId: 'p1',
    workspaceId: null,
    title: 'Add team invitations',
    objective: 'Members can invite someone by email; invitations expire after seven days.',
    description: null,
    constraints: ['Organization membership must keep working'],
    nonGoals: ['Do not redesign the dashboard'],
    risks: [],
    verificationPlan: null,
    status: 'ready',
    statusReason: null,
    riskLevel: 'medium',
    origin: 'manual',
    createdBy: 'user',
    planningMode: 'deterministic',
    executionMode: 'auto_ready_tasks',
    defaultProviderId: 'claude',
    defaultModelId: null,
    defaultAgentProfileId: null,
    defaultIsolation: 'isolated_worktree',
    preflightStatus: 'completed',
    planRevision: 1,
    planningRunId: null,
    failureCode: null,
    failureMessage: null,
    acceptedBy: null,
    acceptedAt: null,
    createdAt: '2026-08-23T10:00:00Z',
    updatedAt: '2026-08-23T10:00:00Z',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  }
}

function makeTask(overrides: Partial<MissionTask> = {}): MissionTask {
  return {
    id: 'task-1',
    missionId: 'mission-1',
    projectId: 'p1',
    key: 'T1',
    title: 'Invitation service',
    objective: 'Build the invitation service',
    description: null,
    focusFiles: [],
    status: 'waiting',
    statusReason: null,
    sequence: 0,
    riskLevel: 'medium',
    executionMode: 'single_agent',
    providerId: 'claude',
    modelId: null,
    agentProfileId: null,
    isolation: null,
    blockerKind: null,
    blockerMessage: null,
    requiredAction: null,
    currentRunId: null,
    attemptCount: 0,
    createdAt: 't',
    updatedAt: 't',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

function makeCriterion(overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {
    id: 'criterion-1',
    missionId: 'mission-1',
    projectId: 'p1',
    key: 'AC-01',
    sequence: 0,
    title: 'Invitations can be sent',
    description: 'A member can invite someone by email.',
    kind: 'behavioral',
    required: true,
    status: 'unverified',
    verificationHint: null,
    waivedReason: null,
    waivedBy: null,
    retiredAt: null,
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  }
}

function makeDetail(overrides: Partial<MissionDetail> = {}): MissionDetail {
  const tasks = overrides.tasks ?? [
    makeTask(),
    makeTask({ id: 'task-2', key: 'T2', title: 'Dashboard UI', sequence: 1 }),
  ]
  return {
    mission: makeMission(),
    criteria: [makeCriterion()],
    tasks,
    dependencies: [{ missionId: 'mission-1', taskId: 'task-2', dependsOnTaskId: 'task-1' }],
    taskCriteria: [{ taskId: 'task-1', criterionId: 'criterion-1' }],
    preflight: {
      missionId: 'mission-1',
      projectId: 'p1',
      status: 'completed',
      summary: '2 component(s), 4 likely file(s).',
      relevantComponents: ['auth', 'dashboard'],
      likelyFiles: ['src/auth/invite.rs'],
      architectureMemories: [],
      relatedChanges: [],
      testAreas: [],
      environment: ['Branch main'],
      riskFindings: [],
      estimatedImpact: 'medium',
      planningContextPackId: 'pack-1',
      provenance: [
        { source: 'project_graph', detail: '4 symbol match(es)', available: true },
        { source: 'memory', detail: '0 related memory item(s)', available: false },
      ],
      errorCode: null,
      errorMessage: null,
      createdAt: 't',
      updatedAt: 't',
    },
    progress: {
      total: 2,
      implemented: 0,
      running: 0,
      ready: 0,
      waiting: 2,
      blocked: 0,
      failed: 0,
      cancelled: 0,
      criteriaTotal: 1,
      criteriaVerified: 0,
      criteriaWaived: 0,
    },
    ...overrides,
  }
}

const create = vi.fn(async (request: { projectId: string; objective: string }) => {
  const mission = makeMission({ id: 'mission-new', objective: request.objective, status: 'draft' })
  backend.missions = [{ mission, progress: makeDetail().progress, activeRuns: 0 }]
  backend.detail = makeDetail({ mission })
  return mission
})
const prepare = vi.fn(async (missionId: string) => makeMission({ id: missionId, status: 'ready' }))
const start = vi.fn(async (missionId: string) => makeMission({ id: missionId, status: 'running' }))
const cancelMission = vi.fn(async (missionId: string) =>
  makeMission({ id: missionId, status: 'cancelled' }),
)
const accept = vi.fn(async (missionId: string) => makeMission({ id: missionId, status: 'completed' }))
const retryTask = vi.fn(async (taskId: string) => makeTask({ id: taskId, status: 'waiting' }))
const waive = vi.fn(async (criterionId: string, reason: string) =>
  makeCriterion({ id: criterionId, status: 'waived', waivedReason: reason }),
)

vi.mock('./missionApi', () => ({
  missionApi: {
    list: async (query: { projectId: string }) =>
      backend.missions.filter((entry) => entry.mission.projectId === query.projectId),
    detail: async () => backend.detail ?? makeDetail(),
    activity: async () => [],
    runs: async () => [],
    taskOutputs: async () => [],
    planRevisions: async () => [],
    create: (...args: unknown[]) => create(...(args as [{ projectId: string; objective: string }])),
    updateDraft: async () => makeMission(),
    prepare: (...args: unknown[]) => prepare(...(args as [string])),
    start: (...args: unknown[]) => start(...(args as [string])),
    cancel: (...args: unknown[]) => cancelMission(...(args as [string])),
    accept: (...args: unknown[]) => accept(...(args as [string])),
    revisePlan: async () => makeMission(),
    retryTask: (...args: unknown[]) => retryTask(...(args as [string])),
    startTask: async () => makeTask(),
    completeManualTask: async () => makeTask({ status: 'implemented' }),
    waiveCriterion: (...args: unknown[]) => waive(...(args as [string, string])),
  },
}))

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({
    code: 'unknown_error',
    message: error instanceof Error ? error.message : String(error),
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}))

const { MissionsPanel } = await import('./MissionsPanel')
const { useMissionStore, resetMissionStoreVersions } = await import('./missionStore')

beforeEach(() => {
  backend.missions = []
  backend.detail = null
  create.mockClear()
  prepare.mockClear()
  start.mockClear()
  cancelMission.mockClear()
  accept.mockClear()
  retryTask.mockClear()
  waive.mockClear()
  resetMissionStoreVersions()
  useMissionStore.setState({
    missionsByProject: {},
    detailById: {},
    activityById: {},
    runsById: {},
    outputsById: {},
    loadingDetailById: {},
    pendingById: {},
    error: undefined,
    loadingProject: undefined,
  })
})

describe('Mission list', () => {
  it('explains what a Mission is instead of saying no data', async () => {
    render(<MissionsPanel projectId="p1" />)
    expect(
      await screen.findByText(/turn larger engineering goals into planned/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create mission/i })).toBeInTheDocument()
  })

  it('shows real counts for each Mission, never a fabricated percentage', async () => {
    backend.missions = [
      {
        mission: makeMission({ status: 'running' }),
        progress: {
          total: 6,
          implemented: 3,
          running: 2,
          ready: 0,
          waiting: 1,
          blocked: 0,
          failed: 0,
          cancelled: 0,
          criteriaTotal: 6,
          criteriaVerified: 0,
          criteriaWaived: 0,
        },
        activeRuns: 2,
      },
    ]
    render(<MissionsPanel projectId="p1" />)
    expect(await screen.findByText('Add team invitations')).toBeInTheDocument()
    expect(screen.getByText(/3 \/ 6 implemented/)).toBeInTheDocument()
    expect(screen.getByText(/6 defined · 6 unverified/)).toBeInTheDocument()
    expect(screen.getByText('2 active Runs')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('creates a Mission and immediately asks the backend to analyse and plan it', async () => {
    const user = userEvent.setup()
    render(<MissionsPanel projectId="p1" />)
    await user.click(await screen.findByRole('button', { name: /create mission/i }))
    const composer = screen.getByRole('region', { name: /create a mission/i })
    await user.type(
      within(composer).getByRole('textbox', { name: /what do you want to build or change/i }),
      'Add team invitations',
    )
    await user.click(within(composer).getByRole('button', { name: 'Create Mission' }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].objective).toBe('Add team invitations')
    // Planning happens without a second click: seeing the plan is the point of a Mission.
    await waitFor(() => expect(prepare).toHaveBeenCalledWith('mission-new'))
  })
})

describe('Mission detail', () => {
  async function openMission(detail = makeDetail()) {
    backend.detail = detail
    backend.missions = [{ mission: detail.mission, progress: detail.progress, activeRuns: 0 }]
    const user = userEvent.setup()
    render(<MissionsPanel projectId="p1" />)
    await user.click(await screen.findByRole('button', { name: /Add team invitations/i }))
    return user
  }

  it('shows the plan, its preflight provenance, and what is still unverified', async () => {
    await openMission()
    expect(await screen.findByRole('heading', { name: 'Add team invitations' })).toBeInTheDocument()
    expect(screen.getByText('2 component(s), 4 likely file(s).')).toBeInTheDocument()
    // A source that found nothing is labelled rather than silently omitted.
    expect(screen.getByText('0 related memory item(s)')).toBeInTheDocument()
    expect(screen.getByText('AC-01')).toBeInTheDocument()
    expect(
      screen.getByText(/They stay unverified until a verification engine/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/depends on T1/)).toBeInTheDocument()
  })

  it('offers Build for a ready Mission and starts it through the backend', async () => {
    const user = await openMission()
    const build = await screen.findByRole('button', { name: /build mission/i })
    await user.click(build)
    await waitFor(() => expect(start).toHaveBeenCalledWith('mission-1'))
  })

  it('does not offer Build for a Mission that has no validated plan', async () => {
    await openMission(makeDetail({ mission: makeMission({ status: 'draft' }) }))
    expect(await screen.findByRole('button', { name: /analyse and plan/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /build mission/i })).not.toBeInTheDocument()
  })

  it('states plainly that an implementation-complete Mission is not a verified one', async () => {
    await openMission(makeDetail({ mission: makeMission({ status: 'review_ready' }) }))
    expect(
      await screen.findByText(/records your judgement, not a\s+proof/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept outcome/i })).toBeInTheDocument()
  })

  it('surfaces a blocked Task with the action that would unblock it', async () => {
    const user = await openMission(
      makeDetail({
        mission: makeMission({ status: 'blocked' }),
        tasks: [
          makeTask({
            status: 'blocked',
            blockerKind: 'approval',
            blockerMessage: 'The agent is waiting for a permission decision.',
            requiredAction: 'Approve or deny the request on the Run.',
            currentRunId: 'run-12345678',
          }),
        ],
      }),
    )
    expect(await screen.findByText(/Needs approval\./)).toBeInTheDocument()
    expect(screen.getByText(/Approve or deny the request on the Run\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(retryTask).toHaveBeenCalledWith('task-1'))
  })

  it('groups independent Tasks together in the graph view', async () => {
    const user = await openMission(
      makeDetail({
        mission: makeMission({ status: 'running' }),
        tasks: [
          makeTask({ id: 'task-1', key: 'T1', sequence: 0 }),
          makeTask({ id: 'task-2', key: 'T2', title: 'Dashboard UI', sequence: 1 }),
          makeTask({ id: 'task-3', key: 'T3', title: 'Integration', sequence: 2 }),
        ],
        dependencies: [
          { missionId: 'mission-1', taskId: 'task-3', dependsOnTaskId: 'task-1' },
          { missionId: 'mission-1', taskId: 'task-3', dependsOnTaskId: 'task-2' },
        ],
      }),
    )
    await user.click(await screen.findByRole('button', { name: /graph/i }))
    const first = screen.getByText('Can start immediately').parentElement as HTMLElement
    expect(within(first).getByText('T1')).toBeInTheDocument()
    expect(within(first).getByText('T2')).toBeInTheDocument()
    expect(within(first).queryByText('T3')).not.toBeInTheDocument()
  })

  it('requires a reason before an Acceptance Criterion can be waived', async () => {
    const user = await openMission()
    await user.click(await screen.findByRole('button', { name: /waive/i }))
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(
      screen.getByRole('textbox', { name: /reason for waiving AC-01/i }),
      'Covered by the existing suite',
    )
    await user.click(save)
    await waitFor(() =>
      expect(waive).toHaveBeenCalledWith('criterion-1', 'Covered by the existing suite'),
    )
  })
})
