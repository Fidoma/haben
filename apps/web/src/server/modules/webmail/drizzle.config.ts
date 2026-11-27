import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/modules/webmail/schema.ts",
  out: "./src/server/modules/webmail/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://haben@localhost:5432/haben" },
});
