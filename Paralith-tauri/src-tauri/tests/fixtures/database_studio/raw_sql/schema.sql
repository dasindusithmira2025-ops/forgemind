CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL
);

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  role text NOT NULL,
  PRIMARY KEY (user_id, project_id)
);
