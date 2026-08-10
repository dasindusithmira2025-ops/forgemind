CREATE TABLE organizations (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE users (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX users_org_email_key ON users(organization_id, email);
