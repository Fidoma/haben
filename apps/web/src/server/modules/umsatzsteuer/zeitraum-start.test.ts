import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Erster Buchungsmonat (Postgres)", () => {
  let zeitraum: typeof import("./zeitraum.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    zeitraum = await import("./zeitraum.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries cascade`;
  });

  it("ohne Buchung zählt der heutige Monat", async () => {
    expect(await zeitraum.ersterBuchungsmonat("2026-11-16")).toBe("2026-11");
  });

  it("sonst der Monat der frühesten Buchung, auch wenn sie später angelegt wurde", async () => {
    for (const datum of ["2026-09-30", "2026-08-15", "2026-10-02"]) {
      await sql.begin(async (tx) => {
        const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
          values (${datum}, 'Test', 'invoice', gen_random_uuid(), 'SKR03') returning id`;
        await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1400', 100, 0), (${e!.id}, '8400', 0, 100)`;
        await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
      });
    }
    expect(await zeitraum.ersterBuchungsmonat("2026-11-16")).toBe("2026-08");
  });
});
