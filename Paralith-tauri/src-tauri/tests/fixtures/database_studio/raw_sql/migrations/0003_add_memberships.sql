create table memberships (
  user_id uuid not null references users(id),
  project_id uuid not null references projects(id),
  role text not null,
  primary key (user_id, project_id)
);

create index memberships_project_idx
  on memberships (project_id);
