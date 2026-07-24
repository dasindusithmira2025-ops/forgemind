import { Search, X } from 'lucide-react'
import { useSidebarStore } from '../sidebarStore'

/**
 * One filter over both primary lists. The sidebar's two unbounded lists — Workspaces and Swarms
 * — previously had no way to narrow them while the rarely-used recents list did, so a Project
 * with twenty Workspaces could only be navigated by scrolling.
 *
 * It renders only once there is enough to filter (see MIN_ROWS_FOR_FILTER): below that the field
 * would cost more vertical space than it saves.
 */
export function SidebarFilter({ resultCount }: { resultCount: number }) {
  const query = useSidebarStore((state) => state.filterQuery)
  const setQuery = useSidebarStore((state) => state.setFilterQuery)
  const filtering = query.trim().length > 0

  return (
    <div className={`sb-filter ${filtering ? 'is-filtering' : ''}`}>
      <label className="sb-filter-field">
        <Search size={13} aria-hidden />
        <input
          type="search"
          value={query}
          placeholder="Filter Workspaces & Swarms"
          aria-label="Filter Workspaces and Swarms"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filtering) {
              event.preventDefault()
              event.stopPropagation()
              setQuery('')
            }
          }}
        />
        {filtering && (
          <button type="button" aria-label="Clear filter" title="Clear filter" onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        )}
      </label>
      {filtering && (
        <p className="sb-filter-status" role="status">
          {resultCount === 0 ? 'No matches' : `${resultCount} match${resultCount === 1 ? '' : 'es'}`}
        </p>
      )}
    </div>
  )
}

/** Below this many combined Workspace + Swarm rows, scrolling is faster than filtering. */
export const MIN_ROWS_FOR_FILTER = 6
