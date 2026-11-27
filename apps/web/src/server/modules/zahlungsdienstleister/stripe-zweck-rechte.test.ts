import type { StripeClient } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Darf der Schlüssel Zahlungen nicht lesen, sagt das schon „Zugang prüfen“, wenn Schlüssel der Metadaten gewählt sind (#1915):
 * Nach dem ersten Abruf wären die Umsätze ohne Metadaten übernommen und bekämen sie nicht mehr. Ebenso beim Speichern
 * geänderter Einstellungen in „Bearbeiten“ ohne neuen Schlüssel.
 */

describe.skipIf(!testDatabaseUrl)("Stripe-Zugang prüfen mit Metadaten ohne Leserecht (Postgres)", () => {
  let psp: typeof import("./index.ts");
  let sql: postgres.Sql;
  let darf = false;
  let stoerung: Error | null = null;
  let gefragt = 0;
  let ausfall: Error | null = null;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    psp = await import("./index.ts");
    psp.setStripeClientFactory(
      () =>
        ({
          accountId: async () => {
            if (ausfall) throw ausfall;
            return "acct_rechte";
          },
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

  it("meldet das fehlende Recht auch, wenn „Bearbeiten“ Schlüssel ohne neuen Zugang setzt, und fragt bei gleicher config nicht", async () => {
    darf = false;
    const verbindung = { provider: "stripe", name: "Stripe", fetchFrom: "2026-11-01" };
    const { id, hinweise: ohne } = await psp.speichereVerbindung(actor, { ...verbindung, eingabe: { apiKey: "rk_live_abcdefghijklmnop" } });
    expect(ohne).toEqual([]);
    const { hinweise } = await psp.speichereVerbindung(actor, { ...verbindung, id, config: { metadataKeys: "invoice_number" } });
    expect(hinweise).toHaveLength(1);
    expect(hinweise[0]).toContain("Lesezugriff auf Zahlungen und Erstattungen");
    gefragt = 0;
    const umbenannt = await psp.speichereVerbindung(actor, { ...verbindung, name: "Shop", id, config: { metadataKeys: "invoice_number" } });
    expect(umbenannt.hinweise).toEqual([]);
    expect(gefragt).toBe(0);
  });

  it("speichert geänderte Einstellungen auch, wenn Stripe gerade nicht erreichbar ist, und sagt, dass nicht geprüft wurde", async () => {
    // Die Verbindung aus dem Fall davor, mit gewählten Schlüsseln
    const { id } = (await psp.verbindungenUebersicht()).verbindungen[0]!;
    const verbindung = { provider: "stripe", name: "Shop", fetchFrom: "2026-11-01" };
    ausfall = new Error("fetch failed");
    const ergebnis = await psp.speichereVerbindung(actor, { ...verbindung, id, config: {} });
    ausfall = null;
    expect(ergebnis.hinweise).toHaveLength(1);
    expect(ergebnis.hinweise[0]).toContain("ließ sich nicht prüfen");
    expect(ergebnis.hinweise[0]).toContain("fetch failed");
    const [gespeichert] = await sql`select config from psp_connections where id = ${id}`;
    expect(gespeichert!.config).toEqual({});
  });
});
