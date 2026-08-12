import type { DatabaseLayer, DatabaseLoadState } from '../../databaseTypes'

/**
 * "This layer has nothing behind it yet" is a different fact from "this database has no tables",
 * and the two must never render the same way. The backend distinguishes them with a specific error
 * code (`database_snapshot_unavailable`); this recognises it so the surface can explain the missing
 * prerequisite instead of showing a failure — or worse, a blank graph that reads as an empty schema.
 */
export function layerUnavailableReason(layer: DatabaseLayer, load: DatabaseLoadState): boolean {
  return load.status === 'error' && load.errorCode === 'database_snapshot_unavailable' && layer !== 'declared'
}
