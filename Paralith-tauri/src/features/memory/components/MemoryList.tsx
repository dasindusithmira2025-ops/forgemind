import { useMemo } from 'react'
import { Pin, Search } from 'lucide-react'
import { useMemoryStore, visibleMemories } from '../memoryStore'
import { qualityLabel, qualityTone, relativeAge } from '../memoryPresentation'
import type { MemorySearchHit, MemorySummary } from '../memoryTypes'

/**
 * Left rail: the query box and the memory list.
 *
 * The list is the same component whether it is showing everything or showing search results — the
 * store decides which rows to hand over. What changes is the secondary line: a plain row shows its
 * summary, a search hit shows the matched snippet and why it matched, so retrieval is never
 * opaque even at the list level.
 */
export function MemoryList() {
  const query = useMemoryStore((state) => state.query)
  const setQuery = useMemoryStore((state) => state.setQuery)
  const searching = useMemoryStore((state) => state.searching)
  const listLoading = useMemoryStore((state) => state.listLoading)
  const items = useMemoryStore((state) => state.items)
  const results = useMemoryStore((state) => state.results)
  const activeId = useMemoryStore((state) => state.activeId)
  const open = useMemoryStore((state) => state.open)
  const drafts = useMemoryStore((state) => state.drafts)

  const rows = useMemo(() => visibleMemories({ query, results, items }), [query, results, items])
  const isSearch = Boolean(query.trim())

  return (
    <div className="memory-list">
      <div className="memory-search">
        <Search size={13} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => void setQuery(event.target.value)}
          placeholder="Search memory, or type:decision tag:auth"
          aria-label="Search memory"
          spellCheck={false}
        />
      </div>

      {listLoading || searching ? (
        <p className="memory-list-state" role="status">
          {searching ? 'Searching…' : 'Loading memory…'}
        </p>
      ) : rows.length === 0 ? (
        <p className="memory-list-state">
          {isSearch ? 'No memory matches that query.' : 'No memory yet for this project.'}
        </p>
      ) : (
        <ul className="memory-rows">
          {rows.map((row) => (
            <MemoryRow
              key={row.id}
              row={row}
              active={row.id === activeId}
              searchHit={isSearch}
              // A draft parked on a memory the user has navigated away from is marked here, so
              // unsaved work is visible from the list rather than only on reopening it.
              hasDraft={row.id !== activeId && row.id in drafts}
              onOpen={() => void open(row.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function MemoryRow({
  row,
  active,
  searchHit,
  hasDraft,
  onOpen,
}: {
  row: MemorySummary
  active: boolean
  searchHit: boolean
  hasDraft: boolean
  onOpen: () => void
}) {
  const hit = searchHit ? (row as MemorySearchHit) : undefined
  return (
    <li>
      <button
        type="button"
        className={`memory-row${active ? ' is-active' : ''}`}
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
      >
        <span className="memory-row-head">
          {row.pinned && <Pin size={11} aria-label="Pinned" />}
          <span className="memory-row-title">{row.title}</span>
          <span
            className={`memory-quality-dot is-${qualityTone(row.quality)}`}
            title={qualityLabel(row.quality)}
            aria-label={qualityLabel(row.quality)}
          />
        </span>
        <span className="memory-row-body">{hit?.snippet || row.summary || 'No summary yet.'}</span>
        <span className="memory-row-meta">
          <span className="memory-type-chip">{row.memoryType}</span>
          {row.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="memory-tag-chip">
              #{tag}
            </span>
          ))}
          <span className="memory-row-spacer" />
          {/* Retrieval attribution, not decoration: it answers "why is this in my results?" */}
          {hit && <span className="memory-row-reason">{hit.matchReason}</span>}
          {/* Worded, not a dot: a second coloured dot next to the quality dot would read as a
              second quality signal. This is the same phrase the editor's footer uses. */}
          {hasDraft ? (
            <span className="memory-row-draft">Unsaved changes</span>
          ) : (
            <time dateTime={row.updatedAt}>{relativeAge(row.updatedAt)}</time>
          )}
        </span>
      </button>
    </li>
  )
}
