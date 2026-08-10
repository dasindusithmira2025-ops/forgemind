CREATE SCHEMA public;
CREATE SCHEMA audit;
CREATE TABLE public.events (id uuid PRIMARY KEY, name text NOT NULL, occurred_at timestamptz NOT NULL);
CREATE TABLE audit.events (id bigint PRIMARY KEY, actor text NOT NULL, event_payload jsonb NOT NULL, recorded_at timestamptz NOT NULL);
CREATE INDEX public_events_occurred_idx ON public.events(occurred_at);
CREATE INDEX audit_events_actor_idx ON audit.events(actor);
