import type { DatabaseObjectDetail, ForeignKey, SemanticId } from './databaseTypes'

export type RelationCardinality = 'One → One' | 'Many → One'

/**
 * A foreign key's cardinality, derived only from constraint evidence.
 *
 * The referenced side of a foreign key is always exactly one row — that is what a foreign key is.
 * The referencing side is many rows unless its own columns are themselves unique, which is the only
 * thing that makes the relation one-to-one and is a fact the graph actually carries (a unique
 * constraint, the primary key, or a unique index over exactly those columns). Nothing here is
 * inferred from naming, and many-to-many is deliberately never claimed: a join table is two
 * separate foreign keys, and asserting otherwise would be a guess about intent.
 */
export function relationCardinality(key: ForeignKey, detail: DatabaseObjectDetail): RelationCardinality {
  const columns = [...key.columnIds].sort().join(',')
  const uniqueSets = [
    ...detail.uniqueConstraints.map((constraint) => [...constraint.columnIds].sort().join(',')),
    ...(detail.primaryKey ? [[...detail.primaryKey.columnIds].sort().join(',')] : []),
    ...detail.indexes.filter((index) => index.unique).map((index) =>
      index.keys.map((entry) => entry.columnId).filter((id): id is SemanticId => Boolean(id)).sort().join(','),
    ),
  ]
  return uniqueSets.includes(columns) ? 'One → One' : 'Many → One'
}
