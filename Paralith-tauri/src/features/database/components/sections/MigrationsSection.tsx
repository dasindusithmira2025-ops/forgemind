import { useEffect, useState } from 'react'
import { History as HistoryIcon, Info, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { databaseApi } from '../../api'
import { useDatabaseStore } from '../../databaseStore'
import { SectionError } from '../SectionError'
import { StatusBadge, type BadgeTone } from '../StatusBadge'
import type { DatabaseAdapterSupport, MigrationAppliedState } from '../../databaseTypes'

const ADAPTER_LABEL: Record<string, string> = {
  prisma: 'Prisma',
  drizzle: 'Drizzle',
  raw_sql: 'Raw SQL',
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
}

const STATE_TONE: Record<MigrationAppliedState, BadgeTone> = {
  declared_only: 'neutral',
  applied: 'success',
  missing: 'danger',
  diverged: 'warning',
  unknown: 'neutral',
}

/**
 * Migrations.
 *
 * "No migrations found" and "this adapter cannot read migrations" are different facts with
 * different remedies, and this surface never collapses them into one sentence. Which case applies
 * is read from the adapter capability contract, not guessed from an ID list.
 */
export function MigrationsSection() {
  const load = useDatabaseStore((state) => state.migrationsLoad)
  const migrations = useDatabaseStore((state) => state.migrations)
  const loadMigrations = useDatabaseStore((state) => state.loadMigrations)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const sources = useDatabaseStore((state) => state.sources)
  const discoverSources = useDatabaseStore((state) => state.discoverSources)
  const [adapters, setAdapters] = useState<DatabaseAdapterSupport[]>([])

  useEffect(() => {
    if (load.status === 'idle' && activeSourceId) void loadMigrations()
  }, [load.status, activeSourceId, loadMigrations])

  useEffect(() => {
    let cancelled = false
    databaseApi.adapterSupport()
      .then((result) => { if (!cancelled) setAdapters(result) })
      .catch(() => undefined) // capability detail is additive; its absence must not break the list
    return () => { cancelled = true }
  }, [])

  const activeSource = sources.find((source) => source.id === activeSourceId)
  const sourceAdapters = activeSource?.adapterIds ?? []
  const capable = adapters.filter((adapter) => sourceAdapters.includes(adapter.adapterId) && adapter.capabilities.extractMigrations)
  // Only claim "unsupported" once the capability contract has actually been read.
  const capabilityKnown = adapters.length > 0
  const unsupported = capabilityKnown && sourceAdapters.length > 0 && capable.length === 0

  if (load.status === 'loading' && migrations.length === 0) {
    return <div className="code-explorer-skeleton">{Array.from({ length: 6 }).map((_, index) => <span key={index} />)}</div>
  }

  if (load.status === 'error') {
    return <SectionError load={load} fallback="Failed to load migrations." onRetry={() => void loadMigrations()} />
  }

  if (migrations.length === 0) {
    const adapterNames = sourceAdapters.map((id) => ADAPTER_LABEL[id] ?? id).join(', ')
    return (
      <div className="db-migrations-empty">
        <HistoryIcon size={24} />
        <h2>{unsupported ? 'Migration extraction is not supported here' : 'No migrations discovered'}</h2>
        <dl className="db-inspector-dl db-migrations-diagnostic">
          {activeSource && <div><dt>Database</dt><dd>{activeSource.displayName}</dd></div>}
          {adapterNames && <div><dt>Adapter</dt><dd>{adapterNames}</dd></div>}
          {activeSource?.evidencePaths[0] && (
            <div><dt>Schema</dt><dd className="mono" title={activeSource.evidencePaths.join('\n')}>{activeSource.evidencePaths[0]}</dd></div>
          )}
        </dl>
        <p>
          {unsupported
            ? `${adapterNames || 'This adapter'} declares no migration extraction capability, so Paralith cannot read a migration history for this datasource. This is a capability limit, not a failed scan.`
            : 'The adapter supports migration extraction, but no supported migration directory was found beside this datasource’s schema.'}
        </p>
        {!unsupported && (
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void discoverSources(true)}>
            Rescan repository
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="db-migrations">
      <div className="db-migrations-header">
        <span>{migrations.length} migration{migrations.length === 1 ? '' : 's'}</span>
        {migrations.some((migration) => migration.appliedState === 'declared_only') && (
          <span className="db-inspector-list-secondary">
            <Info size={12} /> Applied state is unknown without an introspected database.
          </span>
        )}
      </div>
      <ul className="db-inspector-list db-migrations-list">
        {migrations.map((migration) => (
          <li key={migration.meta.identity.id}>
            <div className="db-inspector-column-main">
              <span className="mono">{migration.name}</span>
              <StatusBadge tone={STATE_TONE[migration.appliedState] ?? 'neutral'}>
                {migration.appliedState.replace(/_/g, ' ')}
              </StatusBadge>
            </div>
            <span className="db-inspector-list-secondary mono" title={migration.relativePath}>{migration.relativePath}</span>
            {migration.operationKinds.length > 0 && (
              <span className="db-inspector-list-secondary">{migration.operationKinds.join(' · ')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
