CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL
);

ALTER TABLE users
  ADD COLUMN display_name text;

CREATE INDEX projects_org_idx
  ON projects (organization_id);
