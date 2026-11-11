import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("PMS-Einstellungen (Postgres)", () => {
  let settings: typeof import("./settings.ts");
  let sql: postgres.Sql;
  const actor = "pms-einstellungen-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    settings = await import("./settings.ts");
  }, 30_000);

  afterAll(async () => sql?.end());

  beforeEach(async () => {
    await leeren(sql)`truncate pms_settings, articles cascade`;
  });

  async function article(archived = false) {
    const [row] = await sql`
      insert into articles (description, unit, unit_price, tax_rate, archived_at)
      values ('Übernachtung', 'Tag', 12500, 1900, ${archived ? "2026-11-09T12:00:00Z" : null}) returning id
    `;
    return row!.id as string;
  }

  it("liefert ohne Datensatz keinen Standardartikel", async () => {
    await expect(settings.getPmsSettings()).resolves.toEqual({ defaultArticleId: null });
  });

  it("speichert und entfernt den Standardartikel mit Audit-Akteur", async () => {
    const articleId = await article();
    await expect(settings.savePmsSettings(actor, { defaultArticleId: articleId })).resolves.toEqual({ defaultArticleId: articleId });
    await expect(settings.getPmsSettings()).resolves.toEqual({ defaultArticleId: articleId });

    await settings.savePmsSettings(actor, { defaultArticleId: null });
    await expect(settings.getPmsSettings()).resolves.toEqual({ defaultArticleId: null });

    const audit = await sql`select action, actor from audit_log where table_name = 'pms_settings' order by id`;
    expect(audit.map((row) => [row.action, row.actor])).toEqual([
      ["INSERT", actor],
      ["UPDATE", actor],
    ]);
  });

  it("weist unbekannte und archivierte Standardartikel ab", async () => {
    await expect(settings.savePmsSettings(actor, { defaultArticleId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("Artikel nicht gefunden");
    await expect(settings.savePmsSettings(actor, { defaultArticleId: await article(true) })).rejects.toThrow("Artikel ist archiviert");
  });
});
