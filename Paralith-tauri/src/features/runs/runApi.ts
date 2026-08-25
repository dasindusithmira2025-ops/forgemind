import { invoke } from '@tauri-apps/api/core'
import type {
  CreateRunRequest,
  Run,
  RunDetail,
  RunInboxSummary,
  RunQuery,
} from './runTypes'

/**
 * Thin transport for the canonical Run Engine. Every function here is a *request* — the Rust
 * `RunService` owns Run lifecycle, so nothing in the frontend may set a Run's status directly.
 */
export const runApi = {
  create: (request: CreateRunRequest) => invoke<Run>('create_run', { request }),
  cancel: (runId: string, hard = false) => invoke<Run>('cancel_run', { runId, hard }),
  retry: (runId: string) => invoke<Run>('retry_run', { runId }),
  resolveApproval: (approvalId: string, approved: boolean, note?: string) =>
    invoke<Run>('resolve_run_approval', { approvalId, approved, note }),
  list: (query: RunQuery) => invoke<Run[]>('list_runs', { query }),
  detail: (runId: string) => invoke<RunDetail>('get_run_detail', { runId }),
  inboxSummary: (projectId: string) => invoke<RunInboxSummary>('run_inbox_summary', { projectId }),
}
