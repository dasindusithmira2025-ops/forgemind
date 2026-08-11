import { Lock, Plug } from 'lucide-react'

/**
 * V1 has no connection-profile command, credential resolution, credential persistence, network
 * driver, or network introspection path (CONTRACTS.md §0 Tier 2, §12 Security). This surface must
 * show that honestly — a genuinely absent capability, not a button that does nothing or a
 * failing stub. `SQLite file introspection` is the one Tier 1.5 exception and is described here
 * rather than offered as a control, since its command (`database_introspect_sqlite_file`) is
 * driven from the Explorer/Overview flow once a source is selected, not from this page.
 */
export function ConnectionsSection() {
  return (
    <div className="db-connections">
      <div className="db-connections-empty">
        <Plug size={22} />
        <span>No connection profiles configured.</span>
      </div>
      <div className="db-connections-safety-notice" role="note">
        <Lock size={14} />
        <div>
          <strong>Live database connections are not available in this version.</strong>
          <p>
            Paralith does not store credentials, connect to a network database, or auto-connect to
            anything. Declared-schema analysis (Prisma, Drizzle, raw SQL migrations) and read-only
            local SQLite file introspection work today from the Overview and Explorer sections.
            PostgreSQL/MySQL network introspection is a planned, explicitly out-of-scope Tier 2
            capability — nothing was connected automatically, and nothing here silently degrades
            into a failure.
          </p>
        </div>
      </div>
    </div>
  )
}
