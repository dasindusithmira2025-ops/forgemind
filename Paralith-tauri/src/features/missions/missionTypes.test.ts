import { describe, expect, it } from 'vitest'
import {
  criteriaSummary,
  dependencyKeys,
  formatElapsed,
  graphLayers,
  isMissionTerminal,
  missionNeedsAttention,
  missionStatusLabel,
  missionStatusTone,
  progressSummary,
  taskGlyph,
  taskStatusLabel,
  taskStatusTone,
} from './missionTypes'
import type {
  MissionProgress,
  MissionStatus,
  MissionTask,
  MissionTaskDependency,
  MissionTaskStatus,
} from './missionTypes'

const MISSION_STATUSES: MissionStatus[] = [
  'draft',
  'preflight',
  'planning',
  'ready',
  'running',
  'blocked',
  'verifying',
  'review_ready',
  'completed',
  'failed',
  'cancelled',
]

const TASK_STATUSES: MissionTaskStatus[] = [
  'planned',
  'waiting',
  'ready',
  'running',
  'blocked',
  'implemented',
  'failed',
  'cancelled',
]

function task(id: string, sequence: number, status: MissionTaskStatus = 'waiting'): MissionTask {
  return {
    id,
    missionId: 'mission',
    projectId: 'project',
    key: id.toUpperCase(),
    title: `Task ${id}`,
    objective: `Do ${id}`,
    description: null,
    focusFiles: [],
    status,
    statusReason: null,
    sequence,
    riskLevel: 'low',
    executionMode: 'single_agent',
    providerId: null,
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
  }
}

function edge(from: string, to: string): MissionTaskDependency {
  return { missionId: 'mission', taskId: from, dependsOnTaskId: to }
}

function progress(overrides: Partial<MissionProgress> = {}): MissionProgress {
  return {
    total: 0,
    implemented: 0,
    running: 0,
    ready: 0,
    waiting: 0,
    blocked: 0,
    failed: 0,
    cancelled: 0,
    criteriaTotal: 0,
    criteriaVerified: 0,
    criteriaWaived: 0,
    ...overrides,
  }
}

describe('mission status vocabulary', () => {
  it('labels and tones every status, so no state can render blank', () => {
    for (const status of MISSION_STATUSES) {
      expect(missionStatusLabel(status)).toBeTruthy()
      expect(missionStatusTone(status)).toBeTruthy()
    }
    for (const status of TASK_STATUSES) {
      expect(taskStatusLabel(status)).toBeTruthy()
      expect(taskStatusTone(status)).toBeTruthy()
      expect(taskGlyph(status)).toBeTruthy()
    }
  })

  it('treats only finished missions as terminal', () => {
    for (const status of MISSION_STATUSES) {
      expect(isMissionTerminal(status)).toBe(
        ['completed', 'failed', 'cancelled'].includes(status),
      )
    }
  })

  it('flags exactly the states that are waiting on a person', () => {
    for (const status of MISSION_STATUSES) {
      expect(missionNeedsAttention(status)).toBe(['blocked', 'review_ready'].includes(status))
    }
  })
})

describe('progress reporting', () => {
  it('reports counts rather than an invented percentage', () => {
    const summary = progressSummary(
      progress({ total: 7, implemented: 3, running: 2, blocked: 1, waiting: 1 }),
    )
    expect(summary).toContain('3 / 7 implemented')
    expect(summary).toContain('2 running')
    expect(summary).toContain('1 blocked')
    expect(summary).not.toMatch(/%/)
  })

  it('says nothing is planned when nothing is planned', () => {
    expect(progressSummary(progress())).toBe('No Tasks planned yet')
  })

  it('never claims an acceptance criterion is verified', () => {
    const summary = criteriaSummary(progress({ criteriaTotal: 6 }))
    expect(summary).toContain('6 defined')
    expect(summary).toContain('6 unverified')
    expect(summary).not.toContain('verified ·')
  })

  it('counts a waived criterion as accounted for without calling it verified', () => {
    expect(criteriaSummary(progress({ criteriaTotal: 2, criteriaWaived: 2 }))).toBe(
      '2 defined · all accounted for',
    )
  })
})

describe('graph layout', () => {
  it('puts independent tasks in the same layer and dependents in later ones', () => {
    const tasks = [task('a', 0), task('b', 1), task('c', 2), task('d', 3)]
    const edges = [edge('c', 'a'), edge('c', 'b'), edge('d', 'c')]
    const layers = graphLayers(tasks, edges)
    expect(layers.map((layer) => layer.map((entry) => entry.id))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d'],
    ])
  })

  it('keeps plan order inside a layer', () => {
    const layers = graphLayers([task('b', 5), task('a', 1)], [])
    expect(layers[0].map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('terminates on a graph it should never be handed', () => {
    // The backend refuses to persist a cycle; this must still return rather than spin.
    const layers = graphLayers([task('a', 0), task('b', 1)], [edge('a', 'b'), edge('b', 'a')])
    expect(layers.flat()).toHaveLength(2)
  })

  it('resolves dependency keys for display', () => {
    const tasks = [task('a', 0), task('b', 1)]
    expect(dependencyKeys('b', tasks, [edge('b', 'a')])).toEqual(['A'])
    expect(dependencyKeys('a', tasks, [edge('b', 'a')])).toEqual([])
  })
})

describe('elapsed time', () => {
  it('renders nothing before work started rather than a misleading zero', () => {
    expect(formatElapsed(null, null)).toBe('')
    expect(formatElapsed('not-a-date', null)).toBe('')
  })

  it('measures a finished task against when it finished, not now', () => {
    expect(
      formatElapsed('2026-08-23T10:00:00Z', '2026-08-23T10:04:00Z', Date.parse('2026-08-23T20:00:00Z')),
    ).toBe('4m')
  })

  it('reports hours for long work', () => {
    expect(
      formatElapsed('2026-08-23T10:00:00Z', '2026-08-23T12:30:00Z', Date.parse('2026-08-23T20:00:00Z')),
    ).toBe('2h 30m')
  })
})
