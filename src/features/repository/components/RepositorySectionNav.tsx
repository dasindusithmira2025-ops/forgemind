import { REPOSITORY_SECTIONS, type RepositorySectionId } from '../repositoryTypes'

/** Compact horizontal section rail for the Command Center. Keyboard + screen-reader friendly. */
export function RepositorySectionNav({ active, counts, onSelect }: {
  active: RepositorySectionId
  counts: Partial<Record<RepositorySectionId, number>>
  onSelect: (section: RepositorySectionId) => void
}) {
  return (
    <nav className="repo-section-nav" aria-label="Repository sections">
      {REPOSITORY_SECTIONS.map((section) => {
        const count = counts[section.id]
        return (
          <button
            key={section.id}
            className={active === section.id ? 'active' : ''}
            aria-current={active === section.id ? 'page' : undefined}
            onClick={() => onSelect(section.id)}
          >
            {section.label}
            {count != null && count > 0 && <span className="repo-nav-count">{count}</span>}
          </button>
        )
      })}
    </nav>
  )
}
