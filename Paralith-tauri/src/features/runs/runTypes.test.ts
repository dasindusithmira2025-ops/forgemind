import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  isRunActive,
  isRunTerminal,
  runElapsedMs,
  runNeedsAttention,
  runStatusLabel,
  runStatusTone,
} from './runTypes'
import type { Run, RunStatus } from './runTypes'

const ALL_STATUSES: RunStatus[] = [
  'queued',
  'preparing',
  'waiting_environment',
  'waiting_approval',
  'running',
  'verifying',
  'review_ready',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run',
    projectId: 'project',
    workspaceId: null,
    parentRunId: null,
    rootRunId: 'run',
    retryOfRunId: null,
    swarmId: null,
    swarmTaskId: null,
    runType: 'agent_task',
    executionStrategy: 'single_agent',
    isolation: 'isolated_worktree',
    objective: 'objective',
    providerId: 'claude',
    modelId: null,
    reasoningEffort: null,
    terminalSessionId: null,
    providerSessionId: null,
    workingDirectory: null,
    worktreePath: null,
    branchName: null,
    contextPackId: null,
    status: 'running',
    statusReason: null,
    triggerSource: 'manual',
    requestedBy: 'user',
    errorCode: null,
    errorMessage: null,
    resultSummary: null,
    createdAt: '2026-08-23T10:00:00Z',
    queuedAt: '2026-08-23T10:00:00Z',
    startedAt: null,
    completedAt: null,
    updatedAt: '2026-08-23T10:00:00Z',
    metadata: {},
    ...overrides,
  }
}

describe('run status classification', () => {
  it('treats exactly the terminal states as terminal, and never as active', () => {
    const terminal = ALL_STATUSES.filter(isRunTerminal)
    expect(terminal).toEqual(['succeeded', 'failed', 'cancelled'])
    for (const status of terminal) {
      expect(isRunActive(status)).toBe(false)
    }
  })

  it('does not count an interrupted Run as active, because nothing is executing it', () => {
    expect(isRunActive('interrupted')).toBe(false)
    expect(isRunTerminal('interrupted')).toBe(false)
  })

  it('flags only the states that are waiting on a person', () => {
    expect(ALL_STATUSES.filter(runNeedsAttention)).toEqual(['waiting_approval', 'review_ready'])
  })

  it('gives every status a label and a tone, so no state can render blank', () => {
    for (const status of ALL_STATUSES) {
      expect(runStatusLabel(status)).toBeTruthy()
      expect(runStatusTone(status)).toBeTruthy()
    }
  })

  it('never shows a failed or cancelled Run in a success tone', () => {
    expect(runStatusTone('failed')).toBe('danger')
    expect(runStatusTone('cancelled')).toBe('danger')
    expect(runStatusTone('succeeded')).toBe('success')
  })
})

describe('run elapsed time', () => {
  it('reports nothing before execution started rather than a misleading zero', () => {
    expect(runElapsedMs(run({ startedAt: null }))).toBeUndefined()
  })

  it('measures against now while running and against completion once finished', () => {
    const started = run({ startedAt: '2026-08-23T10:00:00Z' })
    const now = Date.parse('2026-08-23T10:01:30Z')
    expect(runElapsedMs(started, now)).toBe(90_000)

    const finished = run({
      startedAt: '2026-08-23T10:00:00Z',
      completedAt: '2026-08-23T10:00:45Z',
    })
    // A finished Run's duration must not keep growing with the clock.
    expect(runElapsedMs(finished, now)).toBe(45_000)
    expect(runElapsedMs(finished, now + 60_000)).toBe(45_000)
  })

  it('ignores an unparseable timestamp instead of rendering NaN', () => {
    expect(runElapsedMs(run({ startedAt: 'not-a-date' }))).toBeUndefined()
  })
})

describe('duration formatting', () => {
  it('scales the unit to the magnitude', () => {
    expect(formatDuration(4_000)).toBe('4s')
    expect(formatDuration(95_000)).toBe('1m 35s')
    expect(formatDuration(3_800_000)).toBe('1h 3m')
  })
})
