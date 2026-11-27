import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Geänderte Schlüssel der Metadaten (#1915; Werte erfunden): Der nächste Abruf holt mit Überlappung dieselbe Zahlung mit
 * anderem Zweck. Das ist weder ein Konflikt noch eine Dublette, der übernommene Umsatz behält seinen Zweck.
 */

const zahlung: StripeBalanceTransaction = {
  id: "txn_aendern",
  amount: 11900,
  created: Date.UTC(2026, 10, 2, 9) / 1000,
  currency: "eur",
  description: null,
  fee: 400,
  net: 11500,
  reporting_category: "charge",
  type: "charge",
  metadata: { invoice_id: "1042", invoice_number: "RE-2026-0117" },
};

describe.skipIf(!testDatabaseUrl)("Stripe-Abruf nach geänderten Schlüsseln der Metadaten (Postgres)", () => {
  let psp: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    psp = await import("./index.ts");
    psp.setStripeClientFactory(
      () =>
        ({
          accountId: async () => "acct_aendern",
          darfZahlungenLesen: async () => true,
          balanceTransactions: async () => [zahlung],
        }) as unknown as StripeClient,
    );
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  const umsaetze = async () =>
    (await sql`select bank_reference, purpose from bank_transactions order by bank_reference`).map((u) => [u.bank_reference, u.purpose]);

  it("legt nichts doppelt an, meldet keinen Konflikt und lässt den Zweck stehen", async () => {
    const verbindung = { provider: "stripe", name: "Stripe", fetchFrom: "2026-11-01" };
    const id = await psp.speichereVerbindung(actor, {
      ...verbindung,
      eingabe: { apiKey: "rk_live_abcdefghijklmnop" },
      config: { metadataKeys: "invoice_number" },
    });
    expect((await psp.abrufen(actor, id, new Date("2026-11-03T10:00:00Z"))).error).toBeNull();
    const vorher = await umsaetze();
    expect(vorher).toEqual([
      ["txn_aendern", "RE-2026-0117"],
      ["txn_aendern-gebuehr", "Gebühr · txn_aendern"],
    ]);
    for (const [metadataKeys, tag] of [
      ["invoice_id", "04"],
      ["", "05"],
    ] as const) {
      await psp.speichereVerbindung(actor, { ...verbindung, id, config: { metadataKeys } });
      const erneut = await psp.abrufen(actor, id, new Date(`2026-11-${tag}T10:00:00Z`));
      expect(erneut.error).toBeNull();
      expect(erneut.added).toBe(0);
      expect(await umsaetze()).toEqual(vorher);
    }
    expect((await psp.verbindungenUebersicht()).verbindungen[0]!.konflikte).toEqual([]);
  });
});
