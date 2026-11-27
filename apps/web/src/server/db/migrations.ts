import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { MODULES } from "../../modules/registry.ts";

type Database = Parameters<typeof migrate>[0];

export const coreMigrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export const moduleMigrations = MODULES.map((module) => ({
  id: module.id,
  table: module.migrations.table,
  folder: fileURLToPath(new URL(`../modules/${module.migrations.directory}`, import.meta.url)),
}));

export async function applyModuleMigrations(database: Database): Promise<void> {
  for (const module of moduleMigrations) {
    await migrate(database, { migrationsFolder: module.folder, migrationsTable: module.table });
  }
}

/** Erst der unveränderte Haben-Kern, danach jedes registrierte Modul mit eigener Historie. */
export async function applyMigrations(database: Database): Promise<void> {
  await migrate(database, { migrationsFolder: coreMigrationsFolder });
  await applyModuleMigrations(database);
}
