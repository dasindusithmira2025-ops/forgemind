import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CircleStop,
  FolderGit2,
  Network,
  Play,
  RotateCcw,
  ShieldQuestion,
  SquareCheck,
  List,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { runStatusLabel, runStatusTone } from '../runs/runTypes'
import { useMissionStore } from './missionStore'
import {
  blockerLabel,
  criteriaSummary,
  criterionStatusLabel,
  dependencyKeys,
  formatElapsed,
  graphLayers,
  isMissionTerminal,
  missionStatusLabel,
  missionStatusTone,
  progressSummary,
  riskLabel,
  taskGlyph,
  taskStatusLabel,
  taskStatusTone,
} from './missionTypes'
import type {
  AcceptanceCriterion,
  MissionDetail as MissionDetailData,
  MissionPreflight,
  MissionTask,
} from './missionTypes'

type Tab = 'plan' | 'tasks' | 'runs' | 'activity'

/**
 * One Mission as an operational workspace: what it is trying to achieve, what Paralith found
 * before planning, what it will do, what it is doing, and what actually happened.
 *
 * Every section here is backed by real persisted data. There is no Proof tab, because there is no
 * Proof Ledger; the Acceptance Criteria say plainly that nothing has verified them.
 */
export function MissionDetail({
  missionId,
  onClose,
}: {
  missionId: string
  onClose: () => void
}) {
  const detail = useMissionStore((state) => state.detailById[missionId])
  const loading = useMissionStore((state) => state.loadingDetailById[missionId])
  const pending = useMissionStore((state) => state.pendingById[missionId])
  const error = useMissionStore((state) => state.error)
  const loadDetail = useMissionStore((state) => state.loadDetail)
  const loadActivity = useMissionStore((state) => state.loadActivity)
  const loadRuns = useMissionStore((state) => state.loadRuns)
  const clearError = useMissionStore((state) => state.clearError)

  const [tab, setTab] = useState<Tab>('plan')

  useEffect(() => {
    void loadDetail(missionId)
  }, [loadDetail, missionId])

  useEffect(() => {
    if (tab === 'activity') void loadActivity(missionId)
    if (tab === 'runs') void loadRuns(missionId)
  }, [loadActivity, loadRuns, missionId, tab])

  useEffect(() => {
    // Once a Mission starts, the Task graph is the useful view; before that, the plan is.
    if (detail && ['running', 'blocked', 'review_ready'].includes(detail.mission.status)) {
      setTab((current) => (current === 'plan' ? 'tasks' : current))
    }
  }, [detail])

  if (!detail) {
    return (
      <div className="missions-shell">
        <div className="missions-list-state" role="status">
          {loading ? 'Loading Mission…' : 'That Mission is not available.'}
        </div>
        <div className="missions-detail-fallback">
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onClose}>
            All Missions
          </Button>
        </div>
      </div>
    )
  }

  const { mission, progress } = detail
  const tabs: { key: Tab; label: string }[] = [
    { key: 'plan', label: 'Plan' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'runs', label: 'Runs' },
    { key: 'activity', label: 'Activity' },
  ]

  return (
    <div className="missions-shell">
      <header className="mission-header">
        <div className="mission-header-top">
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onClose}>
            All Missions
          </Button>
          <MissionActions missionId={missionId} detail={detail} pending={pending} />
        </div>
        <h2>{mission.title}</h2>
        <p className="mission-objective">{mission.objective}</p>
        <div className="mission-facts">
          <span className={`missions-dot tone-${missionStatusTone(mission.status)}`} aria-hidden />
          <span>{missionStatusLabel(mission.status)}</span>
          <span>{progressSummary(progress)}</span>
          <span>{criteriaSummary(progress)}</span>
          <span className={`missions-risk risk-${mission.riskLevel}`}>
            {riskLabel(mission.riskLevel)} risk
          </span>
          <span>Plan revision {mission.planRevision}</span>
        </div>
        {mission.status === 'review_ready' && (
          <p className="mission-banner" role="status">
            Implementation is complete. Nothing has verified the Acceptance Criteria — Paralith has
            no verification engine yet, so accepting this Mission records your judgement, not a
            proof.
          </p>
        )}
        {mission.failureMessage && (
          <p className="mission-banner is-error" role="alert">
            <strong>{mission.failureCode}</strong> {mission.failureMessage}
          </p>
        )}
      </header>

      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => {
            clearError()
            void loadDetail(missionId)
          }}
        />
      )}

      <nav className="mission-tabs" aria-label="Mission sections">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={tab === entry.key ? 'is-active' : ''}
            aria-current={tab === entry.key}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="mission-body">
        {tab === 'plan' && <PlanView detail={detail} />}
        {tab === 'tasks' && <TasksView missionId={missionId} detail={detail} />}
        {tab === 'runs' && <RunsView missionId={missionId} />}
        {tab === 'activity' && <ActivityView missionId={missionId} />}
      </div>
    </div>
  )
}

/**
 * The Mission's controls. Only the ones that can actually do something right now are rendered:
 * a permanently disabled Build button would be exactly the dead control this product avoids.
 */
function MissionActions({
  missionId,
  detail,
  pending,
}: {
  missionId: string
  detail: MissionDetailData
  pending?: string
}) {
  const prepareMission = useMissionStore((state) => state.prepareMission)
  const startMission = useMissionStore((state) => state.startMission)
  const cancelMission = useMissionStore((state) => state.cancelMission)
  const acceptMission = useMissionStore((state) => state.acceptMission)
  const status = detail.mission.status
  const busy = Boolean(pending)

  return (
    <div className="mission-actions">
      {status === 'draft' && (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void prepareMission(missionId)}
        >
          {pending === 'preparing' ? 'Analysing…' : 'Analyse and plan'}
        </Button>
      )}
      {status === 'ready' && (
        <Button
          variant="primary"
          icon={<Play size={14} />}
          disabled={busy}
          onClick={() => void startMission(missionId)}
        >
          {pending === 'starting' ? 'Starting…' : 'Build Mission'}
        </Button>
      )}
      {status === 'review_ready' && (
        <Button
          variant="primary"
          icon={<SquareCheck size={14} />}
          disabled={busy}
          onClick={() => void acceptMission(missionId)}
        >
          Accept outcome
        </Button>
      )}
      {!isMissionTerminal(status) && status !== 'draft' && (
        <Button
          variant="ghost"
          icon={<CircleStop size={14} />}
          disabled={busy}
          onClick={() => void cancelMission(missionId)}
        >
          Cancel
        </Button>
      )}
    </div>
  )
}

/** What Paralith found, what it proposes, and what it will accept as done. */
function PlanView({ detail }: { detail: MissionDetailData }) {
  const { mission, criteria, tasks, dependencies, preflight } = detail
  const active = criteria.filter((criterion) => !criterion.retiredAt)

  return (
    <div className="mission-plan">
      {preflight && <PreflightView preflight={preflight} />}

      {(mission.constraints.length > 0 || mission.nonGoals.length > 0) && (
        <section className="mission-section">
          {mission.constraints.length > 0 && (
            <>
              <h3>Constraints</h3>
              <ul className="mission-bullets">
                {mission.constraints.map((constraint) => (
                  <li key={constraint}>{constraint}</li>
                ))}
              </ul>
            </>
          )}
          {mission.nonGoals.length > 0 && (
            <>
              <h3>Not in scope</h3>
              <ul className="mission-bullets">
                {mission.nonGoals.map((goal) => (
                  <li key={goal}>{goal}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="mission-section">
        <h3>Acceptance criteria</h3>
        {active.length === 0 ? (
          <p className="mission-muted">No Acceptance Criteria yet.</p>
        ) : (
          <ul className="mission-criteria">
            {active.map((criterion) => (
              <CriterionRow key={criterion.id} criterion={criterion} missionId={mission.id} />
            ))}
          </ul>
        )}
        <p className="mission-muted">
          Nothing verifies these yet. They stay unverified until a verification engine can produce
          evidence for them.
        </p>
      </section>

      <section className="mission-section">
        <h3>Plan</h3>
        {tasks.length === 0 ? (
          <p className="mission-muted">This Mission has no Tasks yet.</p>
        ) : (
          <ol className="mission-plan-tasks">
            {tasks.map((task) => {
              const deps = dependencyKeys(task.id, tasks, dependencies)
              return (
                <li key={task.id}>
                  <span className="mission-plan-key">{task.key}</span>
                  <span className="mission-plan-title">{task.title}</span>
                  {deps.length > 0 && (
                    <span className="mission-plan-deps">depends on {deps.join(', ')}</span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

/**
 * What Paralith knew before it planned — and, just as importantly, what it could not find out.
 * A source that had nothing to say is labelled, so an empty section never reads as a finding.
 */
function PreflightView({ preflight }: { preflight: MissionPreflight }) {
  const groups: { label: string; values: string[] }[] = [
    { label: 'Components', values: preflight.relevantComponents },
    { label: 'Likely files', values: preflight.likelyFiles },
    { label: 'Test areas', values: preflight.testAreas },
    { label: 'Environment', values: preflight.environment },
    { label: 'Risks', values: preflight.riskFindings },
  ].filter((group) => group.values.length > 0)

  return (
    <section className="mission-section">
      <h3>Preflight</h3>
      <p className="mission-muted">{preflight.summary}</p>
      {preflight.errorMessage && (
        <p className="mission-banner is-error">{preflight.errorMessage}</p>
      )}
      <dl className="mission-preflight">
        {groups.map((group) => (
          <div key={group.label}>
            <dt>{group.label}</dt>
            <dd>{group.values.slice(0, 12).join(', ')}</dd>
          </div>
        ))}
        {preflight.architectureMemories.length > 0 && (
          <div>
            <dt>Memory</dt>
            <dd>
              {preflight.architectureMemories
                .map((memory) => `${memory.title}${memory.stale ? ' (stale)' : ''}`)
                .join(', ')}
            </dd>
          </div>
        )}
      </dl>
      <ul className="mission-provenance">
        {preflight.provenance.map((entry) => (
          <li key={entry.source} className={entry.available ? '' : 'is-unavailable'}>
            <span>{entry.source.replace(/_/g, ' ')}</span>
            <span>{entry.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CriterionRow({
  criterion,
  missionId,
}: {
  criterion: AcceptanceCriterion
  missionId: string
}) {
  const waiveCriterion = useMissionStore((state) => state.waiveCriterion)
  const [waiving, setWaiving] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <li className="mission-criterion">
      <span className="mission-criterion-key">{criterion.key}</span>
      <span className="mission-criterion-body">
        <strong>{criterion.title}</strong>
        {criterion.description && <span>{criterion.description}</span>}
        {criterion.waivedReason && (
          <span className="mission-muted">Waived: {criterion.waivedReason}</span>
        )}
      </span>
      <span className={`mission-criterion-status status-${criterion.status}`}>
        {criterionStatusLabel(criterion.status)}
      </span>
      {criterion.status === 'unverified' && !waiving && (
        <Button variant="ghost" onClick={() => setWaiving(true)}>
          Waive
        </Button>
      )}
      {waiving && (
        <span className="mission-criterion-waive">
          <input
            value={reason}
            autoFocus
            placeholder="Why does this not apply?"
            aria-label={`Reason for waiving ${criterion.key}`}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            variant="primary"
            disabled={!reason.trim()}
            onClick={() => {
              void waiveCriterion(missionId, criterion.id, reason.trim())
              setWaiving(false)
            }}
          >
            Save
          </Button>
          <Button variant="ghost" onClick={() => setWaiving(false)}>
            Cancel
          </Button>
        </span>
      )}
    </li>
  )
}

/** The Task graph: a structured list by default, a layered dependency view on request. */
function TasksView({
  missionId,
  detail,
}: {
  missionId: string
  detail: MissionDetailData
}) {
  const [view, setView] = useState<'list' | 'graph'>('list')
  const { tasks, dependencies } = detail

  if (tasks.length === 0) {
    return <p className="mission-muted mission-pad">This Mission has no Tasks yet.</p>
  }

  return (
    <div className="mission-tasks">
      <div className="mission-view-toggle" role="group" aria-label="Task view">
        <button
          type="button"
          className={view === 'list' ? 'is-active' : ''}
          aria-pressed={view === 'list'}
          onClick={() => setView('list')}
        >
          <List size={13} aria-hidden /> List
        </button>
        <button
          type="button"
          className={view === 'graph' ? 'is-active' : ''}
          aria-pressed={view === 'graph'}
          onClick={() => setView('graph')}
        >
          <Network size={13} aria-hidden /> Graph
        </button>
      </div>

      {view === 'list' ? (
        <ul className="mission-task-list">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} missionId={missionId} detail={detail} />
          ))}
        </ul>
      ) : (
        <div className="mission-graph">
          {graphLayers(tasks, dependencies).map((layer, index) => (
            <div className="mission-graph-layer" key={index}>
              <span className="mission-graph-label">
                {index === 0 ? 'Can start immediately' : `After stage ${index}`}
              </span>
              <div className="mission-graph-nodes">
                {layer.map((task) => (
                  <span
                    key={task.id}
                    className={`mission-graph-node tone-${taskStatusTone(task.status)}`}
                    title={`${task.key} · ${taskStatusLabel(task.status)}`}
                  >
                    <span className="mission-graph-key">{task.key}</span>
                    <span>{task.title}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({
  task,
  missionId,
  detail,
}: {
  task: MissionTask
  missionId: string
  detail: MissionDetailData
}) {
  const retryTask = useMissionStore((state) => state.retryTask)
  const startTask = useMissionStore((state) => state.startTask)
  const completeManualTask = useMissionStore((state) => state.completeManualTask)
  const pending = useMissionStore((state) => state.pendingById[missionId])
  const deps = dependencyKeys(task.id, detail.tasks, detail.dependencies)
  const criteria = detail.taskCriteria
    .filter((link) => link.taskId === task.id)
    .map((link) => detail.criteria.find((criterion) => criterion.id === link.criterionId)?.key)
    .filter(Boolean) as string[]
  const elapsed = formatElapsed(task.startedAt, task.completedAt)

  return (
    <li className={`mission-task tone-${taskStatusTone(task.status)}`}>
      <span className="mission-task-glyph" aria-hidden>
        {taskGlyph(task.status)}
      </span>
      <div className="mission-task-body">
        <div className="mission-task-title">
          <span className="mission-task-key">{task.key}</span>
          <span>{task.title}</span>
        </div>
        <div className="mission-task-meta">
          <span>{taskStatusLabel(task.status)}</span>
          {task.providerId && <span>{task.providerId}</span>}
          {task.executionMode !== 'single_agent' && (
            <span>{task.executionMode.replace(/_/g, ' ')}</span>
          )}
          {elapsed && <span>{elapsed}</span>}
          {task.attemptCount > 1 && <span>attempt {task.attemptCount}</span>}
          {deps.length > 0 && <span>needs {deps.join(', ')}</span>}
          {criteria.length > 0 && <span>supports {criteria.join(', ')}</span>}
          {task.currentRunId && (
            <span title={task.currentRunId}>
              <FolderGit2 size={11} aria-hidden /> Run {task.currentRunId.slice(0, 8)}
            </span>
          )}
        </div>
        {task.blockerKind && (
          <p className="mission-task-blocker">
            <ShieldQuestion size={13} aria-hidden />
            <span>
              <strong>{blockerLabel(task.blockerKind)}.</strong> {task.blockerMessage}
              {task.requiredAction ? ` ${task.requiredAction}` : ''}
            </span>
          </p>
        )}
        {task.status === 'failed' && task.statusReason && (
          <p className="mission-task-blocker is-error">
            <span>{task.statusReason.replace(/_/g, ' ')}</span>
          </p>
        )}
      </div>
      <div className="mission-task-actions">
        {(task.status === 'failed' || task.status === 'blocked') && (
          <Button
            variant="ghost"
            icon={<RotateCcw size={13} />}
            disabled={Boolean(pending)}
            onClick={() => void retryTask(missionId, task.id)}
          >
            Retry
          </Button>
        )}
        {task.status === 'ready' && task.executionMode !== 'manual' && (
          <Button
            variant="ghost"
            icon={<Play size={13} />}
            disabled={Boolean(pending)}
            onClick={() => void startTask(missionId, task.id)}
          >
            Start
          </Button>
        )}
        {task.executionMode === 'manual' &&
          (task.status === 'ready' || task.status === 'running') && (
            <Button
              variant="ghost"
              icon={<SquareCheck size={13} />}
              disabled={Boolean(pending)}
              onClick={() => void completeManualTask(missionId, task.id)}
            >
              Mark done
            </Button>
          )}
      </div>
    </li>
  )
}

/** Every Run this Mission created, superseded attempts included. */
function RunsView({ missionId }: { missionId: string }) {
  const runs = useMissionStore((state) => state.runsById[missionId])
  if (!runs) {
    return (
      <p className="mission-muted mission-pad" role="status">
        Loading Runs…
      </p>
    )
  }
  if (runs.length === 0) {
    return <p className="mission-muted mission-pad">This Mission has not created a Run yet.</p>
  }
  return (
    <ul className="mission-runs">
      {runs.map((run) => (
        <li key={run.id}>
          <span className={`missions-dot tone-${runStatusTone(run.status)}`} aria-hidden />
          <span className="mission-run-objective" title={run.objective}>
            {run.objective.split('\n')[0]}
          </span>
          <span className="mission-run-meta">
            <span>{runStatusLabel(run.status)}</span>
            {run.branchName && <span>{run.branchName}</span>}
            {run.errorCode && <span>{run.errorCode}</span>}
            <span>{run.createdAt.slice(0, 19).replace('T', ' ')}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function ActivityView({ missionId }: { missionId: string }) {
  const events = useMissionStore((state) => state.activityById[missionId])
  if (!events) {
    return (
      <p className="mission-muted mission-pad" role="status">
        Loading activity…
      </p>
    )
  }
  return (
    <ol className="mission-timeline">
      {events.map((event) => (
        <li key={event.id} className={`level-${event.level}`}>
          <span className="mission-timeline-kind">{event.kind.replace(/_/g, ' ')}</span>
          <span className="mission-timeline-summary">{event.summary}</span>
          <span className="mission-timeline-time">{event.createdAt.slice(11, 19)}</span>
        </li>
      ))}
    </ol>
  )
}
