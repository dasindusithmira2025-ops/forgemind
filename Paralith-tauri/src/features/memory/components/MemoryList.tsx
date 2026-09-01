import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Filter, Pin } from 'lucide-react'
import { useMemoryStore, visibleMemories } from '../memoryStore'
import {
  knowledgeGroups,
  qualityLabel,
  qualityTone,
  relativeAge,
  type KnowledgeGroup,
} from '../memoryPresentation'
import type { MemorySearchHit, MemorySummary } from '../memoryTypes'

/**
 * Knowledge navigator: the filter box and the project's knowledge, grouped by what kind of truth
 * it is.
 *
 * The grouping is the difference between a notes list and a project-truth browser. A flat list of
 * two hundred titles answers "what exists"; sections answer "what kind of thing does this project
 * know", which is the question someone opening Knowledge is actually asking. Grouping is derived
 * from the memory type the backend already stores — nothing here classifies anything itself.
 *
 * While a filter is active the grouping collapses to a single ranked result list, because a
 * ranked search split across eight headings is not ranked any more.
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
  const [collapsed, setCollapsed] = useState<string[]>([])

  const rows = useMemo(() => visibleMemories({ query, results, items }), [query, results, items])
  const isSearch = Boolean(query.trim())
  const groups = useMemo(() => (isSearch ? [] : knowledgeGroups(rows)), [rows, isSearch])

  const toggleGroup = (key: string) =>
    setCollapsed((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    )

  const renderRow = (row: MemorySummary) => (
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
  )

  return (
    <div className="memory-list">
      <div className="memory-filter">
        <Filter size={12} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => void setQuery(event.target.value)}
          placeholder="Filter knowledge"
          aria-label="Filter knowledge"
          spellCheck={false}
        />
      </div>

      {listLoading || searching ? (
        <p className="memory-list-state" role="status">
          {searching ? 'Searching…' : 'Loading knowledge…'}
        </p>
      ) : rows.length === 0 ? (
        <p className="memory-list-state">
          {isSearch
            ? 'Nothing here matches that filter.'
            : 'Paralith is building its understanding. Knowledge appears here as project evidence is analyzed, or as you capture it yourself.'}
        </p>
      ) : isSearch ? (
        <ul className="memory-rows">{rows.map(renderRow)}</ul>
      ) : (
        <div className="memory-groups">
          {groups.map((group) => (
            <GroupSection
              key={group.key}
              group={group}
              open={!collapsed.includes(group.key)}
              onToggle={() => toggleGroup(group.key)}
            >
              {group.items.map(renderRow)}
            </GroupSection>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupSection({
  group,
  open,
  onToggle,
  children,
}: {
  group: KnowledgeGroup
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="memory-group">
      <button type="button" className="memory-group-head" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <span>{group.label}</span>
        <span className="memory-count tnum">{group.items.length}</span>
      </button>
      {open && <ul className="memory-rows">{children}</ul>}
    </section>
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
          {row.staleReason && <span className="memory-row-state is-stale">needs review</span>}
          {row.quality === 'superseded' && (
            <span className="memory-row-state is-superseded">superseded</span>
          )}
          {row.tags.slice(0, 2).map((tag) => (
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
