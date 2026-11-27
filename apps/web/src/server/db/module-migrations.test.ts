import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../test-db.ts";
import { applyModuleMigrations, moduleMigrations } from "./migrations.ts";

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

const journal = (folder: string): Journal => JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));

describe("Modulmigrationen", () => {
  it("haben getrennte, vollständige und chronologische Historien", () => {
    expect(new Set(moduleMigrations.map((module) => module.table)).size).toBe(moduleMigrations.length);
    for (const module of moduleMigrations) {
      const { entries } = journal(module.folder);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.filter((entry, index) => index > 0 && entry.when <= entries[index - 1]!.when)).toEqual([]);
      expect(entries.filter((entry) => !existsSync(join(module.folder, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`)))).toEqual([]);
    }
  });
});

describe.skipIf(!testDatabaseUrl)("Übernahme bestehender Modultabellen (Postgres)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt nur die getrennten Historien nachträglich an", async () => {
    for (const module of moduleMigrations) await sql.unsafe(`drop table drizzle."${module.table}"`);

    await applyModuleMigrations(drizzle(sql));

    for (const module of moduleMigrations) {
      const [row] = await sql.unsafe<{ count: number }[]>(`select count(*)::int as count from drizzle."${module.table}"`);
      expect(row!.count).toBe(journal(module.folder).entries.length);
    }
    const [tables] = await sql<{ webmail: string | null; pms: string | null }[]>`
      select to_regclass('public.webmail_accounts')::text as webmail,
             to_regclass('public.pms_reservations')::text as pms`;
    expect(tables).toEqual({ webmail: "webmail_accounts", pms: "pms_reservations" });
  });
});
