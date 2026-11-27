import type { StripeClient } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Darf der Schlüssel Zahlungen nicht lesen, sagt das schon „Zugang prüfen“, wenn Schlüssel der Metadaten gewählt sind (#1915):
 * Nach dem ersten Abruf wären die Umsätze ohne Metadaten übernommen und bekämen sie nicht mehr.
 */

describe.skipIf(!testDatabaseUrl)("Stripe-Zugang prüfen mit Metadaten ohne Leserecht (Postgres)", () => {
  let psp: typeof import("./index.ts");
  let sql: postgres.Sql;
  let darf = false;
  let stoerung: Error | null = null;
  let gefragt = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    psp = await import("./index.ts");
    psp.setStripeClientFactory(
      () =>
        ({
          accountId: async () => "acct_rechte",
          darfZahlungenLesen: async () => {
            gefragt++;
            if (stoerung) throw stoerung;
            return darf;
          },
        }) as unknown as StripeClient,
    );
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const pruefen = (config: Record<string, string>) => psp.zugangPruefen("stripe", { apiKey: "rk_live_abcdefghijklmnop" }, config);

  it("meldet das fehlende Recht mit seiner Folge, wenn Schlüssel gewählt sind", async () => {
    darf = false;
    const { hinweise } = await pruefen({ metadataKeys: "invoice_number" });
    expect(hinweise).toHaveLength(1);
    expect(hinweise[0]).toContain("Lesezugriff auf Zahlungen und Erstattungen");
    expect(hinweise[0]).toContain("nicht nachträglich");
  });

  it("meldet nichts, wenn der Schlüssel Zahlungen lesen darf", async () => {
    darf = true;
    expect((await pruefen({ metadataKeys: "invoice_number" })).hinweise).toEqual([]);
  });

  it("nimmt den Schlüssel an, wenn sich nur das Leserecht nicht prüfen lässt, und sagt das", async () => {
    stoerung = new Error("HTTP 500: Stripe ist gestört");
    const ergebnis = await pruefen({ metadataKeys: "invoice_number" });
    stoerung = null;
    expect(ergebnis.accountId).toBe("acct_rechte");
    expect(ergebnis.hinweise).toHaveLength(1);
    expect(ergebnis.hinweise[0]).toContain("ließ sich nicht prüfen");
    expect(ergebnis.hinweise[0]).toContain("HTTP 500: Stripe ist gestört");
  });

  it("fragt ohne gewählte Schlüssel nicht nach dem Recht", async () => {
    darf = false;
    gefragt = 0;
    expect((await pruefen({})).hinweise).toEqual([]);
    expect((await pruefen({ metadataKeys: " , " })).hinweise).toEqual([]);
    expect(gefragt).toBe(0);
  });
});
