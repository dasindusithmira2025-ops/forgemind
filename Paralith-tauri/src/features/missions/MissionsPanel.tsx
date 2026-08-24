import { useCallback, useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { ChevronRight, Plus, Target } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { MissionDetail } from './MissionDetail'
import { useMissionStore } from './missionStore'
import {
  criteriaSummary,
  missionStatusLabel,
  missionStatusTone,
  progressSummary,
  riskLabel,
} from './missionTypes'
import type { CreateMissionRequest, MissionChangedEvent, MissionSummary } from './missionTypes'

type Filter = 'all' | 'active' | 'attention' | 'completed'

/**
 * The Mission Control surface: every engineering outcome this Project is pursuing, and one
 * Mission's operational detail.
 *
 * This surface *observes*. The Rust `MissionService` owns Mission and Task lifecycle, so nothing
 * here computes or advances a status — it renders persisted state and refetches on the backend's
 * `mission-changed` event. Leaving this screen, or closing the window, does not affect a Mission.
 */
export function MissionsPanel({ projectId }: { projectId: string }) {
  const missions = useMissionStore((state) => state.missionsByProject[projectId])
  const loading = useMissionStore((state) => state.loadingProject === projectId)
  const error = useMissionStore((state) => state.error)
  const loadMissions = useMissionStore((state) => state.loadMissions)
  const applyChange = useMissionStore((state) => state.applyChange)
  const clearError = useMissionStore((state) => state.clearError)

  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [composerOpen, setComposerOpen] = useState(false)

  const query = useMemo(
    () => ({
      projectId,
      activeOnly: filter === 'active',
      needsAttentionOnly: filter === 'attention',
      statuses: filter === 'completed' ? (['completed'] as const).slice() : undefined,
      limit: 100,
    }),
    [filter, projectId],
  )

  const refresh = useCallback(() => {
    void loadMissions(query)
  }, [loadMissions, query])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The backend is the only source of change. One subscription for the whole surface; the store
  // decides what actually needs refetching.
  useEffect(() => {
    const unlisten = listen<MissionChangedEvent>('mission-changed', (event) => {
      if (event.payload.projectId !== projectId) return
      void applyChange(event.payload)
    })
    return () => {
      void unlisten.then((dispose) => dispose())
    }
  }, [applyChange, projectId])

  if (selectedId) {
    return (
      <MissionDetail missionId={selectedId} onClose={() => setSelectedId(undefined)} />
    )
  }

  return (
    <div className="missions-shell">
      <header className="missions-header">
        <div className="missions-identity">
          <h2>Missions</h2>
          <p>Engineering outcomes, decomposed into work Paralith can execute and you can review.</p>
        </div>
        <MissionFilters active={filter} onChange={setFilter} missions={missions} />
        <div className="missions-header-actions">
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setComposerOpen(true)}>
            New Mission
          </Button>
        </div>
      </header>

      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => {
            clearError()
            refresh()
          }}
        />
      )}

      {composerOpen && (
        <MissionComposer
          projectId={projectId}
          onClose={() => setComposerOpen(false)}
          onCreated={(missionId) => {
            setComposerOpen(false)
            setSelectedId(missionId)
          }}
        />
      )}

      <MissionList
        missions={missions}
        loading={loading}
        filter={filter}
        onSelect={setSelectedId}
        onCreate={() => setComposerOpen(true)}
      />
    </div>
  )
}

function MissionFilters({
  active,
  onChange,
  missions,
}: {
  active: Filter
  onChange: (filter: Filter) => void
  missions?: MissionSummary[]
}) {
  // Counts come from what is loaded; the chips are filters first, so a count is never the only
  // reason one exists.
  const attention = (missions ?? []).filter((entry) =>
    ['blocked', 'review_ready'].includes(entry.mission.status),
  ).length
  const running = (missions ?? []).filter((entry) => entry.mission.status === 'running').length

  const chips: { key: Filter; label: string; count?: number; attention?: boolean }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active', count: running },
    { key: 'attention', label: 'Needs you', count: attention, attention: attention > 0 },
    { key: 'completed', label: 'Accepted' },
  ]

  return (
    <div className="missions-filters" role="group" aria-label="Mission filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={`missions-filter ${active === chip.key ? 'is-active' : ''} ${chip.attention ? 'is-attention' : ''}`}
          aria-pressed={active === chip.key}
          onClick={() => onChange(chip.key)}
        >
          {chip.count !== undefined && <strong>{chip.count}</strong>}
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  )
}

function MissionList({
  missions,
  loading,
  filter,
  onSelect,
  onCreate,
}: {
  missions?: MissionSummary[]
  loading: boolean
  filter: Filter
  onSelect: (missionId: string) => void
  onCreate: () => void
}) {
  if (!missions && loading) {
    return (
      <div className="missions-list-state" role="status">
        Loading Missions…
      </div>
    )
  }
  if (missions && missions.length === 0) {
    return (
      <div className="missions-empty">
        <Target size={22} aria-hidden />
        <p>
          {filter === 'all'
            ? 'Missions turn larger engineering goals into planned, dependency-aware work you can watch, retry and review.'
            : 'No Mission matches this filter.'}
        </p>
        {filter === 'all' && (
          <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>
            Create Mission
          </Button>
        )}
      </div>
    )
  }
  return (
    <ul className="missions-list">
      {(missions ?? []).map((entry) => (
        <MissionRow key={entry.mission.id} entry={entry} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function MissionRow({
  entry,
  onSelect,
}: {
  entry: MissionSummary
  onSelect: (missionId: string) => void
}) {
  const { mission, progress, activeRuns } = entry
  const attention = ['blocked', 'review_ready'].includes(mission.status)
  return (
    <li className={`missions-row ${attention ? 'is-attention' : ''}`}>
      <button type="button" className="missions-row-main" onClick={() => onSelect(mission.id)}>
        <span className={`missions-dot tone-${missionStatusTone(mission.status)}`} aria-hidden />
        <span className="missions-row-body">
          <span className="missions-row-title" title={mission.objective}>
            {mission.title}
          </span>
          <span className="missions-row-meta">
            <span>{missionStatusLabel(mission.status)}</span>
            <span>{progressSummary(progress)}</span>
            <span>{criteriaSummary(progress)}</span>
            {activeRuns > 0 && <span>{activeRuns} active Run{activeRuns === 1 ? '' : 's'}</span>}
            <span className={`missions-risk risk-${mission.riskLevel}`}>
              {riskLabel(mission.riskLevel)} risk
            </span>
          </span>
        </span>
        <ChevronRight size={15} aria-hidden />
      </button>
    </li>
  )
}

/**
 * Create a Mission.
 *
 * One field is required, because one field is what a person actually has at the start: what they
 * want. Everything else — constraints, non-goals, how planning happens, which agent — is an
 * expandable choice with a working default, not a form to fill in before Paralith will help.
 */
function MissionComposer({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: (missionId: string) => void
}) {
  const createMission = useMissionStore((state) => state.createMission)
  const prepareMission = useMissionStore((state) => state.prepareMission)
  const [objective, setObjective] = useState('')
  const [constraints, setConstraints] = useState('')
  const [nonGoals, setNonGoals] = useState('')
  const [planningMode, setPlanningMode] = useState<'deterministic' | 'agent'>('deterministic')
  const [provider, setProvider] = useState('claude')
  const [advanced, setAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const lines = (value: string) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

  const submit = async () => {
    if (!objective.trim() || submitting) return
    setSubmitting(true)
    const request: CreateMissionRequest = {
      projectId,
      objective: objective.trim(),
      constraints: lines(constraints),
      nonGoals: lines(nonGoals),
      planningMode,
      defaultProviderId: provider,
    }
    try {
      const mission = await createMission(request)
      // Preflight and planning happen immediately: the point of a Mission is that you see the
      // plan before anything runs, not that you have to ask for one.
      void prepareMission(mission.id)
      onCreated(mission.id)
    } catch {
      // The store surfaces the message; keep the composer open so nothing typed is lost.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="missions-composer" aria-label="Create a Mission">
      <label className="missions-composer-objective">
        <span>What do you want to build or change?</span>
        <textarea
          value={objective}
          rows={3}
          autoFocus
          placeholder="Add team invitations. Members can invite someone by email, invitations expire after seven days, and duplicate active invitations are prevented."
          onChange={(event) => setObjective(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
            if (event.key === 'Escape') onClose()
          }}
        />
      </label>

      <button
        type="button"
        className="missions-composer-toggle"
        aria-expanded={advanced}
        onClick={() => setAdvanced((open) => !open)}
      >
        {advanced ? 'Hide options' : 'Options'}
      </button>

      {advanced && (
        <div className="missions-composer-advanced">
          <label>
            <span>Constraints that must remain true</span>
            <textarea
              rows={2}
              value={constraints}
              placeholder={'One per line\nExisting password login must keep working'}
              onChange={(event) => setConstraints(event.target.value)}
            />
          </label>
          <label>
            <span>Explicitly out of scope</span>
            <textarea
              rows={2}
              value={nonGoals}
              placeholder={'One per line\nDo not redesign account settings'}
              onChange={(event) => setNonGoals(event.target.value)}
            />
          </label>
          <div className="missions-composer-options">
            <label>
              <span>Planning</span>
              <select
                value={planningMode}
                onChange={(event) =>
                  setPlanningMode(event.target.value as 'deterministic' | 'agent')
                }
              >
                <option value="deterministic">Local (free, instant)</option>
                <option value="agent">Agent (uses your provider quota)</option>
              </select>
            </label>
            <label>
              <span>Agent</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value)}>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex CLI</option>
              </select>
            </label>
          </div>
        </div>
      )}

      <p className="missions-composer-hint">
        Paralith analyses the Project, proposes Acceptance Criteria and a Task graph, and waits for
        you to approve it. Nothing runs until you press Build.
      </p>
      <div className="missions-composer-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!objective.trim() || submitting}
          onClick={() => void submit()}
        >
          {submitting ? 'Creating…' : 'Create Mission'}
        </Button>
      </div>
    </section>
  )
}
