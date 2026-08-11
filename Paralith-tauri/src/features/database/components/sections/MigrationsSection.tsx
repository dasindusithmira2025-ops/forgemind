import { useEffect } from 'react'
import { AlertTriangle, History as HistoryIcon, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'

export function MigrationsSection() {
  const load = useDatabaseStore((state) => state.migrationsLoad)
  const migrations = useDatabaseStore((state) => state.migrations)
  const loadMigrations = useDatabaseStore((state) => state.loadMigrations)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const sources = useDatabaseStore((state) => state.sources)

  useEffect(() => {
    if (load.status === 'idle' && activeSourceId) void loadMigrations()
  }, [load.status, activeSourceId, loadMigrations])

  const activeSource = sources.find((source) => source.id === activeSourceId)
  const migrationsUnsupported = activeSource ? !activeSource.adapterIds.some((id) => id === 'prisma' || id === 'drizzle' || id === 'raw_sql') : false

  if (load.status === 'loading' && migrations.length === 0) {
    return <div className="code-explorer-skeleton">{Array.from({ length: 6 }).map((_, index) => <span key={index} />)}</div>
  }

  if (load.status === 'error') {
    return (
      <div className="db-section-error">
        <AlertTriangle size={18} />
        <span>{load.errorMessage ?? 'Failed to load migrations.'}</span>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void loadMigrations()}>Retry</Button>
      </div>
    )
  }

  if (migrations.length === 0) {
    return (
      <div className="db-migrations-empty">
        <HistoryIcon size={22} />
        <span>{migrationsUnsupported ? 'Migration history is not tracked for this adapter yet.' : 'No migrations detected for this adapter.'}</span>
      </div>
    )
  }

  return (
    <ul className="db-inspector-list db-migrations-list">
      {migrations.map((migration) => (
        <li key={migration.meta.identity.id}>
          <span className="mono">{migration.name}</span>
          <span className="db-inspector-list-secondary">{migration.appliedState}</span>
        </li>
      ))}
    </ul>
  )
}
