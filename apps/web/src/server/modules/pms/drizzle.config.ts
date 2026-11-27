import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/modules/pms/schema.ts",
  out: "./src/server/modules/pms/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://haben@localhost:5432/haben" },
});
