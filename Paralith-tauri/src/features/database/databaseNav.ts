import type { DatabaseSectionId } from './databaseTypes'

/** A navigation destination — mirrors `repositoryNav.ts`'s `RepositoryNavTarget` shape. */
export interface DatabaseNavTarget {
  section: DatabaseSectionId
  objectId?: string
}

const STORAGE_PREFIX = 'db:nav:'

export interface DatabaseNavState {
  section: DatabaseSectionId
}

export const DEFAULT_DATABASE_NAV: DatabaseNavState = { section: 'overview' }

const VALID_SECTIONS: DatabaseSectionId[] = ['overview', 'diagram', 'explorer', 'migrations', 'changes', 'health', 'connections']

/** Restore persisted nav for a project, defensively — bad/stale localStorage never crashes the surface. */
export function loadDatabaseNav(projectId: string): DatabaseNavState {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`)
    if (!raw) return DEFAULT_DATABASE_NAV
    const parsed = JSON.parse(raw) as Partial<DatabaseNavState>
    const section = VALID_SECTIONS.includes(parsed.section as DatabaseSectionId) ? (parsed.section as DatabaseSectionId) : 'overview'
    return { section }
  } catch {
    return DEFAULT_DATABASE_NAV
  }
}

export function saveDatabaseNav(projectId: string, nav: DatabaseNavState): void {
  try { window.localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(nav)) } catch { /* storage is best-effort */ }
}

/** Filter → section/target mapping, mirroring `repositoryNav.test.ts`'s `applyPrFilter` shape. */
export function navTargetForSection(section: DatabaseSectionId, objectId?: string): DatabaseNavTarget {
  return { section, objectId }
}
