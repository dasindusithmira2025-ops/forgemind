CREATE TYPE "OrderStatus" AS ENUM (
  'PENDING',
  'PAID',
  'SHIPPED',
  'CANCELLED'
);

CREATE TABLE "User" (
  "id" uuid PRIMARY KEY,
  "email" text NOT NULL UNIQUE,
  "name" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Post" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "authorId" uuid NOT NULL REFERENCES "User"("id")
);

CREATE TABLE "Tag" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL UNIQUE
);

CREATE TABLE "PostTag" (
  "postId" integer NOT NULL REFERENCES "Post"("id"),
  "tagId" integer NOT NULL REFERENCES "Tag"("id"),
  PRIMARY KEY ("postId", "tagId")
);

CREATE UNIQUE INDEX "Post_authorId_slug_key"
  ON "Post" ("authorId", "slug");
