/**
 * Database Studio Tauri boundary.
 *
 * This is the one place `src/features/database/**` calls `invoke`. The store and components never
 * import `@tauri-apps/api/core` directly — mirrors the `native/commands.ts` precedent so the
 * feature has a single, mockable seam. Every command here is implemented in
 * `src-tauri/src/commands/database_commands.rs`; request and response shapes are the same structs
 * on both sides, so a contract change is a compile error rather than a runtime surprise.
 */
import { invoke } from '@tauri-apps/api/core'
import type {
  ApplyDatabaseDesignOperationRequest,
  DatabaseAdapterSupport,
  GetDatabaseLayoutRequest,
  BuildDatabaseContextPackRequest,
  CompareDatabaseRequest,
  CreateDatabaseDraftRequest,
  DatabaseCanvasStateReceipt,
  DatabaseContextPack,
  DatabaseDesign,
  DatabaseDesignBundle,
  DatabaseDesignMutationResult,
  DatabaseDiff,
  DatabaseGraphPage,
  DatabaseImplementationRun,
  DatabaseIssue,
  DatabaseLayout,
  DatabaseMigration,
  DatabaseObjectDetail,
  DatabaseSnapshot,
  DatabaseSource,
  DatabaseSourceDetail,
  DatabaseUsagePage,
  DecideDatabaseDesignRequest,
  DiscoverDatabaseSourcesRequest,
  DiscoverDatabaseSourcesResponse,
  GetDatabaseDesignRequest,
  GetDatabaseObjectRequest,
  GetDatabaseSchemaRequest,
  GetDatabaseSourceRequest,
  ImplementDatabaseDesignRequest,
  IntrospectSqliteFileRequest,
  ListDatabaseDesignsRequest,
  ListDatabaseIssuesRequest,
  ListDatabaseMigrationsRequest,
  ListDatabaseSourcesRequest,
  ListDatabaseUsageRequest,
  PublishDatabaseCanvasStateRequest,
  SaveDatabaseLayoutRequest,
} from './databaseTypes'

export const databaseApi = {
  discoverSources: (request: DiscoverDatabaseSourcesRequest) =>
    invoke<DiscoverDatabaseSourcesResponse>('database_discover_sources', { request }),
  listSources: (request: ListDatabaseSourcesRequest) =>
    invoke<DatabaseSource[]>('database_list_sources', { request }),
  getSource: (request: GetDatabaseSourceRequest) =>
    invoke<DatabaseSourceDetail>('database_get_source', { request }),
  getSchema: (request: GetDatabaseSchemaRequest) =>
    invoke<DatabaseGraphPage>('database_get_schema', { request }),
  getObject: (request: GetDatabaseObjectRequest) =>
    invoke<DatabaseObjectDetail>('database_get_object', { request }),
  compare: (request: CompareDatabaseRequest) =>
    invoke<DatabaseDiff>('database_compare', { request }),
  listMigrations: (request: ListDatabaseMigrationsRequest) =>
    invoke<DatabaseMigration[]>('database_list_migrations', { request }),
  listUsage: (request: ListDatabaseUsageRequest) =>
    invoke<DatabaseUsagePage>('database_list_usage', { request }),
  listIssues: (request: ListDatabaseIssuesRequest) =>
    invoke<DatabaseIssue[]>('database_list_issues', { request }),
  introspectSqliteFile: (request: IntrospectSqliteFileRequest) =>
    invoke<DatabaseSnapshot>('database_introspect_sqlite_file', { request }),
  createDraft: (request: CreateDatabaseDraftRequest) =>
    invoke<DatabaseDesignBundle>('database_create_draft', { request }),
  listDesigns: (request: ListDatabaseDesignsRequest) =>
    invoke<DatabaseDesign[]>('database_list_designs', { request }),
  getDesign: (request: GetDatabaseDesignRequest) =>
    invoke<DatabaseDesignBundle>('database_get_design', { request }),
  applyDesignOperation: (request: ApplyDatabaseDesignOperationRequest) =>
    invoke<DatabaseDesignMutationResult>('database_apply_design_operation', { request }),
  approveDesign: (request: DecideDatabaseDesignRequest) =>
    invoke<DatabaseDesignMutationResult>('database_approve_design', { request }),
  rejectDesign: (request: DecideDatabaseDesignRequest) =>
    invoke<DatabaseDesignMutationResult>('database_reject_design', { request }),
  archiveDesign: (request: DecideDatabaseDesignRequest) =>
    invoke<DatabaseDesignMutationResult>('database_archive_design', { request }),
  saveLayout: (request: SaveDatabaseLayoutRequest) =>
    invoke<DatabaseLayout>('database_save_layout', { request }),
  getLayout: (request: GetDatabaseLayoutRequest) =>
    invoke<DatabaseLayout | null>('database_get_layout', { request }),
  adapterSupport: () => invoke<DatabaseAdapterSupport[]>('database_adapter_support'),
  buildContextPack: (request: BuildDatabaseContextPackRequest) =>
    invoke<DatabaseContextPack>('database_build_context_pack', { request }),
  /** WP4-owned command; WP3 is the caller only (gate-1.md finding 5, CONTRACTS.md §8). */
  publishCanvasState: (request: PublishDatabaseCanvasStateRequest) =>
    invoke<DatabaseCanvasStateReceipt>('database_publish_canvas_state', { request }),
  implementDesign: (request: ImplementDatabaseDesignRequest) =>
    invoke<DatabaseImplementationRun>('database_implement_design', { request }),
}

export interface DatabaseNativeError {
  code: string
  message: string
  recoverable: boolean
  details?: Record<string, unknown>
}

/** Mirrors `native/commands.ts`'s `asNativeError` so store error handling stays consistent app-wide. */
export function asDatabaseError(caught: unknown): DatabaseNativeError {
  if (caught && typeof caught === 'object' && 'code' in caught && 'message' in caught) {
    const candidate = caught as { code: unknown; message: unknown; recoverable?: unknown; details?: unknown }
    return {
      code: String(candidate.code),
      message: String(candidate.message),
      recoverable: Boolean(candidate.recoverable),
      details: candidate.details as Record<string, unknown> | undefined,
    }
  }
  if (caught instanceof Error) return { code: 'unknown', message: caught.message, recoverable: false }
  return { code: 'unknown', message: String(caught), recoverable: false }
}
