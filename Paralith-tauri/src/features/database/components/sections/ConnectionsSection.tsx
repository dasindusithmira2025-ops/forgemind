import { useEffect, useState } from 'react'
import { AlertTriangle, Database, Loader2, Lock } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { databaseApi } from '../../api'
import { useDatabaseStore } from '../../databaseStore'
import type { DatabaseAdapterSupport } from '../../databaseTypes'

/**
 * Connections.
 *
 * Two things are true here and both are stated plainly. Read-only SQLite file introspection is
 * real and available, and it requires an explicit request — discovering a `.sqlite` file or a
 * `DATABASE_URL` never opens a connection on its own. Network database connections are genuinely
 * not implemented: no credential store, no driver, no profile. This surface offers the capability
 * that exists and describes the absence of the one that does not, rather than showing a control
 * that would fail.
 */
export function ConnectionsSection() {
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const introspect = useDatabaseStore((state) => state.introspectSqliteFile)
  const introspectionLoad = useDatabaseStore((state) => state.introspectionLoad)
  const observedSnapshot = useDatabaseStore((state) => state.observedSnapshot)
  const [path, setPath] = useState('')
  const [adapters, setAdapters] = useState<DatabaseAdapterSupport[]>([])

  useEffect(() => {
    databaseApi.adapterSupport().then(setAdapters).catch(() => setAdapters([]))
  }, [])

  return (
    <div className="db-connections">
      <section className="db-connections-introspect" aria-label="Read-only SQLite introspection">
        <header>
          <Database size={16} />
          <div>
            <strong>Introspect a local SQLite file</strong>
            <p>
              Reads the live structure of a database file inside this Project, opened read-only.
              Paralith connects only when you ask it to, right here.
            </p>
          </div>
        </header>
        <div className="db-changes-draft-selector">
          <input
            type="text"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="dev.sqlite"
            aria-label="Project-relative database file"
          />
          <Button
            onClick={() => void introspect(path.trim())}
            disabled={!activeSourceId || path.trim().length === 0 || introspectionLoad.status === 'loading'}
          >
            {introspectionLoad.status === 'loading' ? 'Reading…' : 'Introspect'}
          </Button>
        </div>
        {introspectionLoad.status === 'loading' && (
          <div className="db-changes-draft-selector"><Loader2 size={14} className="is-spinning" /> Reading structure…</div>
        )}
        {introspectionLoad.status === 'error' && (
          <div className="db-inline-error" role="alert">
            <AlertTriangle size={14} />
            <span>{introspectionLoad.errorMessage}</span>
          </div>
        )}
        {observedSnapshot && (
          <p className="db-inspector-list-secondary">
            Observed schema captured: {observedSnapshot.objectCount} objects, {observedSnapshot.edgeCount} relationships.
            Switch the layer to Observed to compare it against what the repository declares.
          </p>
        )}
      </section>

      {adapters.length > 0 && (
        <section aria-label="Adapter support">
          <ul className="db-inspector-list">
            {adapters.map((adapter) => (
              <li key={adapter.adapterId}>
                <span>{adapter.adapterId}</span>
                <span className="db-inspector-list-secondary">
                  {[
                    adapter.capabilities.extractDeclaredSchema && 'declared schema',
                    adapter.capabilities.extractMigrations && 'migrations',
                    adapter.capabilities.introspectObservedSchema && 'observed schema',
                    adapter.capabilities.generateChange && 'change generation',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="db-connections-safety-notice" role="note">
        <Lock size={14} />
        <div>
          <strong>Network database connections are not available in this version.</strong>
          <p>
            Paralith does not store credentials, connect to a network database, or auto-connect to
            anything it discovers. Declared-schema analysis (Prisma, Drizzle, raw SQL migrations)
            and read-only local SQLite introspection work today. PostgreSQL and MySQL network
            introspection are deliberately out of scope here — nothing was connected automatically,
            and nothing on this page silently degrades into a failure.
          </p>
        </div>
      </div>
    </div>
  )
}
