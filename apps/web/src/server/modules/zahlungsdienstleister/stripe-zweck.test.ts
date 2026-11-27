import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Verwendungszweck aus den Metadaten der Zahlung (#1915; Reihenfolge und Werte erfunden): Der Umsatz zeigt sie, und ein
 * CSV-Export derselben Zahlung legt trotzdem nichts doppelt an.
 */

const zahlung: StripeBalanceTransaction = {
  id: "txn_meta1",
  amount: 11900,
  created: Date.UTC(2026, 10, 2, 9) / 1000,
  currency: "eur",
  description: null,
  fee: 400,
  net: 11500,
  reporting_category: "charge",
  type: "charge",
  metadata: { invoice_id: "1042", intern: "nicht zeigen", invoice_number: "RE-2026-0117" },
};

const csv = new TextEncoder().encode(
  [
    "balance_transaction_id,created_utc,reporting_category,gross,fee,net,currency,description",
    "txn_meta1,2026-11-02 09:00:00,charge,119.00,4.00,115.00,eur,",
  ].join("\n"),
);

describe.skipIf(!testDatabaseUrl)("Stripe-Zweck aus Metadaten (Postgres)", () => {
  let psp: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    psp = await import("./index.ts");
    bank = await import("../bank/index.ts");
    psp.setStripeClientFactory(
      () =>
        ({ accountId: async () => "acct_meta", darfZahlungenLesen: async () => true, balanceTransactions: async () => [zahlung] }) as unknown as StripeClient,
    );
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Speichert die eine Stripe-Verbindung; ohne `metadataKeys` wie eine Verbindung von vor #1915 (config leer) */
  async function speichern(metadataKeys?: string, apiKey?: string) {
    const [bisher] = (await psp.verbindungenUebersicht()).verbindungen;
    return psp.speichereVerbindung(actor, {
      id: bisher?.id,
      provider: "stripe",
      name: "Stripe",
      eingabe: apiKey ? { apiKey } : {},
      config: metadataKeys === undefined ? {} : { metadataKeys },
      fetchFrom: "2026-11-01",
    });
  }

  const config = async () => (await psp.verbindungenUebersicht()).verbindungen[0]!.config;

  it("speichert die Metadaten als Verwendungszweck und erkennt den CSV-Export derselben Zahlung wieder", async () => {
    const { id } = await speichern(" invoice_number, invoice_id,invoice_number, ", "rk_live_abcdefghijklmnop");
    expect(await config()).toEqual({ metadataKeys: "invoice_number, invoice_id" });
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Stripe alt', 'zahlungsdienstleister', 'stripe', 4)`;
    const result = await psp.abrufen(actor, id, new Date("2026-11-03T10:00:00Z"));
    expect(result.error).toBeNull();
    const umsaetze = await sql`select bank_reference, purpose from bank_transactions order by bank_reference`;
    expect(umsaetze.map((u) => [u.bank_reference, u.purpose])).toEqual([
      ["txn_meta1", "RE-2026-0117 1042"],
      ["txn_meta1-gebuehr", "Gebühr · txn_meta1"],
    ]);
    const konto = (await psp.verbindungenUebersicht()).verbindungen[0]!.bankAccountId!;
    expect((await bank.importStatement(actor, { bytes: csv, filename: "balance-history.csv" }, konto)).added).toBe(0);
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(2);
  });

  it("begrenzt Zahl und Länge der Schlüssel am Feld und leert sie mit leerer Angabe", async () => {
    await expect(speichern("k".repeat(41))).rejects.toMatchObject({
      message: expect.stringContaining("länger als 40"),
      felder: ["metadataKeys"],
    });
    await expect(speichern(Array.from({ length: 11 }, (_, i) => `k${i}`).join(","))).rejects.toThrow("Höchstens 10");
    expect(await config()).toEqual({ metadataKeys: "invoice_number, invoice_id" });
    // 40 Zeichen, das letzte aus zwei UTF-16-Einheiten
    const grenzfall = `${"k".repeat(39)}\u{1F600}`;
    await speichern(grenzfall);
    expect(await config()).toEqual({ metadataKeys: grenzfall });
    await speichern("");
    expect(await config()).toEqual({ metadataKeys: "" });
  });

  it("nimmt eine Verbindung ohne die Angabe, wie die Migration sie anlegt", async () => {
    await speichern();
    expect(await config()).toEqual({});
  });
});
