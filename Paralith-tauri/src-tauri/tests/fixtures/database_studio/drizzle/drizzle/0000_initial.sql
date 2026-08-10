CREATE TYPE "account_role" AS ENUM ('owner','admin','member');
CREATE TABLE "accounts" ("id" uuid PRIMARY KEY, "slug" text NOT NULL, "name" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "users" ("id" uuid PRIMARY KEY, "account_id" uuid NOT NULL REFERENCES "accounts"("id"), "email" text NOT NULL, "role" "account_role" NOT NULL);
CREATE TABLE "audit_logs" ("id" serial PRIMARY KEY, "account_id" uuid NOT NULL REFERENCES "accounts"("id"), "actor_id" uuid REFERENCES "users"("id"), "action" text NOT NULL);
CREATE UNIQUE INDEX "accounts_slug_unique" ON "accounts"("slug");
CREATE UNIQUE INDEX "users_account_email_unique" ON "users"("account_id","email");
CREATE INDEX "audit_logs_account_idx" ON "audit_logs"("account_id");
