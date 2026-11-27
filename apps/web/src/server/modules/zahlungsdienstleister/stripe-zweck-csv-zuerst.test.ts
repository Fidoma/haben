import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Der CSV-Export kam vor dem Abruf mit gewählten Schlüsseln der Metadaten (#1915; eigene Datei, leere Datenbank). Aufbau wie
 * stripe-zweck.test.ts, Werte erfunden.
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

describe.skipIf(!testDatabaseUrl)("Stripe-Zweck aus Metadaten nach dem CSV-Export (Postgres)", () => {
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

  it("verbindet den Umsatz aus der Datei mit der Kennung, statt ihn neu anzulegen", async () => {
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Stripe', 'zahlungsdienstleister', 'stripe', 3)`;
    const konto = (await sql`select id from bank_accounts where provider = 'stripe'`)[0]!.id as string;
    expect((await bank.importStatement(actor, { bytes: csv, filename: "balance-history.csv" }, konto)).added).toBe(2);
    const id = await speichern("invoice_number", "rk_live_abcdefghijklmnop");
    const result = await psp.abrufen(actor, id, new Date("2026-11-03T10:00:00Z"));
    expect(result.error).toBeNull();
    expect(result.added).toBe(0);
    const [anzahl] = await sql`select count(*)::int as n from bank_transactions`;
    expect(anzahl!.n).toBe(2);
  });
});
