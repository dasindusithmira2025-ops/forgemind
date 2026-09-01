/**
 * Search: one query language over every knowledge store.
 *
 * The field accepts the same syntax the Review filters, the health drilldowns, and the Context
 * Compiler's structured candidate source use. Anything the parser could not read is shown as a
 * diagnostic rather than silently narrowing the result set — a search that quietly ignores half
 * your query is worse than one that says it did.
 *
 * Results are grouped by the store they came out of. The grouping is not a taxonomy this file
 * invented: every heading is a domain the backend actually returned, so an empty category cannot
 * appear and a new one cannot be hidden.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Search } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useIntelligenceStore } from '../intelligenceStore'
import { useMemoryStore } from '../memoryStore'
import {
  SEARCH_DOMAIN_LABELS,
  SEARCH_EXAMPLES,
  type SearchDomain,
  type SearchResult,
} from '../intelligenceTypes'

/** Reading order for the groups: what the project knows first, what it is unsure about last. */
const DOMAIN_ORDER: SearchDomain[] = [
  'memory',
  'fact',
  'claim',
  'entity',
  'conflict',
  'candidate',
  'handoff',
]

function groupByDomain(results: SearchResult[]): { domain: SearchDomain; rows: SearchResult[] }[] {
  const buckets = new Map<SearchDomain, SearchResult[]>()
  for (const row of results) {
    const existing = buckets.get(row.domain)
    if (existing) existing.push(row)
    else buckets.set(row.domain, [row])
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => DOMAIN_ORDER.indexOf(left) - DOMAIN_ORDER.indexOf(right))
    .map(([domain, rows]) => ({ domain, rows }))
}

function ResultRow({ result, onNavigate }: { result: SearchResult; onNavigate?: () => void }) {
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const openable = result.domain === 'memory' || Boolean(result.itemId)

  return (
    <li className={`memory-search-result is-${result.domain}${result.stale ? ' is-stale' : ''}`}>
      <div className="memory-search-result-head">
        {openable ? (
          <button
            type="button"
            className="memory-search-title"
            onClick={() => {
              void open((result.itemId ?? result.id) as string)
              void setView('all')
              onNavigate?.()
            }}
          >
            {result.title}
          </button>
        ) : (
          <span className="memory-search-title is-plain">{result.title}</span>
        )}
        <span className="memory-search-spacer" />
        {result.memoryType && <span className="memory-search-meta">{result.memoryType}</span>}
        {result.quality && <span className="memory-search-meta">{result.quality}</span>}
        {result.stale && <span className="memory-search-stale">stale</span>}
      </div>
      {result.excerpt && <p className="memory-search-excerpt">{result.excerpt}</p>}
      <p className="memory-search-why">
        matched by {result.matchReason}
        {result.branchName ? ` · ${result.branchName}` : ''}
      </p>
    </li>
  )
}

export function MemorySearch({ onNavigate }: { onNavigate?: () => void } = {}) {
  const query = useIntelligenceStore((state) => state.query)
  const setQuery = useIntelligenceStore((state) => state.setQuery)
  const runSearch = useIntelligenceStore((state) => state.runSearch)
  const searching = useIntelligenceStore((state) => state.searching)
  const results = useIntelligenceStore((state) => state.results)
  const parsed = useIntelligenceStore((state) => state.parsed)
  const elapsed = useIntelligenceStore((state) => state.searchElapsedMs)
  const truncated = useIntelligenceStore((state) => state.searchTruncated)
  const semantic = useIntelligenceStore((state) => state.semantic)
  const [ran, setRan] = useState(false)

  // A blank field returns to the empty state rather than listing everything: the examples are more
  // useful than an unfiltered dump of the vault.
  useEffect(() => {
    if (query.trim() === '') setRan(false)
  }, [query])

  const groups = useMemo(() => groupByDomain(results), [results])

  const submit = () => {
    setRan(true)
    void runSearch()
  }

  return (
    <section className="memory-search" aria-label="Knowledge search">
      <form
        className="memory-search-bar"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="memory-search-field">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search project intelligence, or type:decision quality:canonical"
            aria-label="Knowledge query"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={searching}>
          Search
        </Button>
      </form>

      {parsed && parsed.diagnostics.length > 0 && (
        <ul className="memory-search-diagnostics" aria-label="Query diagnostics">
          {parsed.diagnostics.map((note) => (
            <li key={note}>
              <AlertCircle size={12} aria-hidden /> {note}
            </li>
          ))}
        </ul>
      )}

      <div className="memory-search-body">
        {!ran && (
          <div className="memory-search-examples">
            <p className="memory-empty-lead">
              Memories, claims, entities, candidates, handoffs, conflicts and detected project
              facts are all searchable from one field. Every example below runs.
            </p>
            <ul>
              {SEARCH_EXAMPLES.map((example) => (
                <li key={example.query}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(example.query)
                      setRan(true)
                      void runSearch(example.query)
                    }}
                  >
                    <code>{example.query}</code>
                    <span>{example.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
            {semantic && !semantic.available && (
              <p className="memory-search-semantic">
                Semantic search is off.{' '}
                {semantic.detail ?? 'Lexical and structured search are unaffected.'}
              </p>
            )}
          </div>
        )}

        {ran && searching && <p className="memory-inline-status">Searching…</p>}

        {ran && !searching && results.length === 0 && (
          <p className="memory-empty-lead">
            Nothing matched. Widen the query, or check the diagnostics above for anything that was
            not understood.
          </p>
        )}

        {results.length > 0 && (
          <>
            <p className="memory-search-summary">
              {results.length} result{results.length === 1 ? '' : 's'} in {elapsed}ms
              {truncated ? ' · more available' : ''}
            </p>
            {groups.map((group) => (
              <section key={group.domain} className="memory-search-group">
                <h3>
                  <span>{SEARCH_DOMAIN_LABELS[group.domain]}</span>
                  <span className="memory-count tnum">{group.rows.length}</span>
                </h3>
                <ul className="memory-search-results">
                  {group.rows.map((result) => (
                    <ResultRow
                      key={`${result.domain}-${result.id}`}
                      result={result}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </section>
  )
}
