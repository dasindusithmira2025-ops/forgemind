import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const accountRole = pgEnum("account_role", ["owner", "admin", "member"]);
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ slugUnique: uniqueIndex("accounts_slug_unique").on(table.slug), createdIdx: index("accounts_created_idx").on(table.createdAt) }));
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  email: text("email").notNull(),
  role: accountRole("role").notNull(),
}, (table) => ({ accountEmailUnique: uniqueIndex("users_account_email_unique").on(table.accountId, table.email) }));
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
}, (table) => ({ accountIdx: index("audit_logs_account_idx").on(table.accountId) }));
export const accountRelations = relations(accounts, ({ many }) => ({ users: many(users), auditLogs: many(auditLogs) }));
export const userRelations = relations(users, ({ one }) => ({ account: one(accounts, { fields: [users.accountId], references: [accounts.id] }) }));
