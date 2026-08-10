CREATE TABLE page_views (id uuid PRIMARY KEY, path text NOT NULL, viewed_at timestamptz NOT NULL);
CREATE TABLE conversions (id uuid PRIMARY KEY, page_view_id uuid NOT NULL REFERENCES page_views(id), kind text NOT NULL);
