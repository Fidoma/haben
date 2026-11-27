import { customType, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { user } from "../../db/auth-schema.ts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) => value,
});

/** Konten des optionalen Webmail-Moduls; Geheimnisse liegen gemeinsam verschlüsselt in `ciphertext`. */
export const webmailAccounts = pgTable(
  "webmail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull().default(""),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull().default(993),
    imapSecure: boolean("imap_secure").notNull().default(true),
    imapUsername: text("imap_username").notNull(),
    smtpHost: text("smtp_host").notNull(),
    smtpPort: integer("smtp_port").notNull().default(587),
    smtpSecure: boolean("smtp_secure").notNull().default(false),
    smtpUsername: text("smtp_username").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webmail_accounts_user_email").on(t.userId, t.email), index("webmail_accounts_user").on(t.userId)],
);
