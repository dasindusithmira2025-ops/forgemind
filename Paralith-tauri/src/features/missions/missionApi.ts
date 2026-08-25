import { invoke } from '@tauri-apps/api/core'
import type { Run } from '../runs/runTypes'
import type {
  AcceptanceCriterion,
  CreateMissionRequest,
  Mission,
  MissionDetail,
  MissionEventRecord,
  MissionPlanDraft,
  MissionPlanRevision,
  MissionQuery,
  MissionSummary,
  MissionTask,
  MissionTaskOutput,
} from './missionTypes'

/**
 * Thin transport for Mission Control. Every function here is a *domain request* — the Rust
 * `MissionService` owns Mission and Task lifecycle, so there is deliberately no way from here to
 * set a status. The frontend asks for outcomes and observes what was persisted.
 */
export const missionApi = {
  create: (request: CreateMissionRequest) => invoke<Mission>('create_mission', { request }),
  updateDraft: (request: { missionId: string } & Partial<CreateMissionRequest>) =>
    invoke<Mission>('update_mission_draft', { request }),
  prepare: (missionId: string) => invoke<Mission>('prepare_mission', { missionId }),
  start: (missionId: string) => invoke<Mission>('start_mission', { missionId }),
  cancel: (missionId: string) => invoke<Mission>('cancel_mission', { missionId }),
  revisePlan: (missionId: string, plan: MissionPlanDraft, reason: string) =>
    invoke<Mission>('revise_mission_plan', { missionId, plan, reason }),
  accept: (missionId: string) => invoke<Mission>('accept_mission', { missionId }),

  retryTask: (taskId: string) => invoke<MissionTask>('retry_mission_task', { taskId }),
  startTask: (taskId: string) => invoke<MissionTask>('start_mission_task', { taskId }),
  completeManualTask: (taskId: string) =>
    invoke<MissionTask>('complete_manual_mission_task', { taskId }),
  waiveCriterion: (criterionId: string, reason: string) =>
    invoke<AcceptanceCriterion>('waive_acceptance_criterion', { criterionId, reason }),

  list: (query: MissionQuery) => invoke<MissionSummary[]>('list_missions', { query }),
  detail: (missionId: string) => invoke<MissionDetail>('get_mission_detail', { missionId }),
  activity: (missionId: string, limit?: number) =>
    invoke<MissionEventRecord[]>('get_mission_activity', { missionId, limit }),
  planRevisions: (missionId: string) =>
    invoke<MissionPlanRevision[]>('get_mission_plan_revisions', { missionId }),
  runs: (missionId: string) => invoke<Run[]>('get_mission_runs', { missionId }),
  taskOutputs: (missionId: string) =>
    invoke<MissionTaskOutput[]>('get_mission_task_outputs', { missionId }),
}
