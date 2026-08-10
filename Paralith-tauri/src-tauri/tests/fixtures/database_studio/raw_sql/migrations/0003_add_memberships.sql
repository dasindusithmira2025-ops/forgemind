CREATE TABLE memberships (user_id uuid NOT NULL REFERENCES users(id), project_id uuid NOT NULL REFERENCES projects(id), role text NOT NULL, PRIMARY KEY (user_id, project_id));
CREATE INDEX memberships_project_idx ON memberships(project_id);
