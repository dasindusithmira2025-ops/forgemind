// Coordinator verification of GATE 1 blocker fixes 1 and 2.
//
// The reviewer proved the original DDL was broken by inserting duplicates successfully. A fix is
// only real if the same insert is now rejected, so this re-runs the probe against the remediated
// DDL. It also exercises the generated-column FK form the Architect introduced, which is the part
// most likely to be silently unsupported.

import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
const results = [];
function record(name, fn) {
  try {
    fn();
    results.push([name, "ALLOWED"]);
  } catch (err) {
    results.push([name, `REJECTED: ${String(err.message).slice(0, 80)}`]);
  }
}

db.exec(`
CREATE TABLE database_snapshots(id TEXT PRIMARY KEY);
CREATE TABLE database_design_revisions(id TEXT PRIMARY KEY);
CREATE TABLE database_sources(id TEXT PRIMARY KEY);
INSERT INTO database_sources VALUES('src1');
INSERT INTO database_snapshots VALUES('snap1');
INSERT INTO database_design_revisions VALUES('rev1');
`);

// Remediated shape, reduced to the columns that carry the invariant.
db.exec(`
CREATE TABLE database_objects (
  id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL DEFAULT '',
  design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  qualified_name TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
  PRIMARY KEY(id, snapshot_id, design_revision_id)
);
CREATE TABLE database_edges (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL DEFAULT '',
  design_revision_id TEXT NOT NULL DEFAULT '',
  source_object_id TEXT NOT NULL, target_object_id TEXT NOT NULL, edge_type TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
  UNIQUE(snapshot_id, design_revision_id, source_object_id, target_object_id, edge_type)
);
`);

// PROBE1: the exact duplicate the reviewer proved was previously ALLOWED.
record("PROBE1 first object insert (should be allowed)", () => {
  db.exec(`INSERT INTO database_objects(id,source_id,snapshot_id,qualified_name) VALUES('db:table:x','src1','snap1','public.users')`);
});
record("PROBE1 duplicate object, same snapshot (MUST be rejected)", () => {
  db.exec(`INSERT INTO database_objects(id,source_id,snapshot_id,qualified_name) VALUES('db:table:x','src1','snap1','public.accounts')`);
});

// PROBE2: same id may legitimately exist in a different snapshot and in a design revision.
record("PROBE2 same id in a different snapshot (should be allowed)", () => {
  db.exec(`INSERT INTO database_snapshots VALUES('snap2');
           INSERT INTO database_objects(id,source_id,snapshot_id,qualified_name) VALUES('db:table:x','src1','snap2','public.users')`);
});
record("PROBE2 same id in a design revision (should be allowed)", () => {
  db.exec(`INSERT INTO database_objects(id,source_id,design_revision_id,qualified_name) VALUES('db:table:x','src1','rev1','public.users')`);
});

// PROBE3: the CHECK must forbid rows that belong to both layers or neither.
record("PROBE3 both discriminators set (MUST be rejected)", () => {
  db.exec(`INSERT INTO database_objects(id,source_id,snapshot_id,design_revision_id,qualified_name) VALUES('db:table:y','src1','snap1','rev1','public.x')`);
});
record("PROBE3 neither discriminator set (MUST be rejected)", () => {
  db.exec(`INSERT INTO database_objects(id,source_id,qualified_name) VALUES('db:table:z','src1','public.x')`);
});

// PROBE4: duplicate edges, the defect that would have corrupted the semantic diff.
record("PROBE4 first edge (should be allowed)", () => {
  db.exec(`INSERT INTO database_edges VALUES('e1','snap1','','a','b','REFERENCES')`);
});
record("PROBE4 duplicate edge (MUST be rejected)", () => {
  db.exec(`INSERT INTO database_edges VALUES('e2','snap1','','a','b','REFERENCES')`);
});

// PROBE5: the generated-column FK must actually enforce referential integrity.
db.exec("PRAGMA foreign_keys=ON");
record("PROBE5 object referencing a missing snapshot (MUST be rejected)", () => {
  db.exec(`INSERT INTO database_objects(id,source_id,snapshot_id,qualified_name) VALUES('db:table:q','src1','nope','public.q')`);
});

const objectCount = db.prepare("SELECT COUNT(*) c FROM database_objects").get().c;
const edgeCount = db.prepare("SELECT COUNT(*) c FROM database_edges").get().c;

for (const [name, outcome] of results) console.log(`${outcome.startsWith("REJECTED") ? "[rejected]" : "[allowed] "} ${name}`);
console.log(`\nrows: database_objects=${objectCount} (expected 3), database_edges=${edgeCount} (expected 1)`);

const mustReject = results.filter(([n]) => n.includes("MUST be rejected"));
const failures = mustReject.filter(([, o]) => o === "ALLOWED");
const mustAllow = results.filter(([n]) => n.includes("should be allowed"));
const wronglyRejected = mustAllow.filter(([, o]) => o !== "ALLOWED");

console.log(`\nblocker fixes: ${failures.length === 0 && wronglyRejected.length === 0 && objectCount === 3 && edgeCount === 1 ? "VERIFIED" : "NOT VERIFIED"}`);
if (failures.length) console.log("still allowed:", failures.map(([n]) => n));
if (wronglyRejected.length) console.log("wrongly rejected:", wronglyRejected);
