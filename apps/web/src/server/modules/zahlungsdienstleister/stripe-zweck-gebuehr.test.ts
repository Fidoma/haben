import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Haben erkennt Gebühren eines Zahlungsdienstleisters daran, dass der Zweck mit „Gebühr“ beginnt (Sammelrechnung). Ein
 * gewählter Metadatenwert, der so beginnt (#1915, Werte erfunden), darf Zahlung und Erstattung nicht dazu machen.
 */

const basis = { created: Date.UTC(2026, 10, 2, 9) / 1000, currency: "eur", description: null };
const metadata = { titel: "Gebühr Kursanmeldung" };
const bewegungen: StripeBalanceTransaction[] = [
  { ...basis, id: "txn_g1", amount: 11900, fee: 400, net: 11500, reporting_category: "charge", type: "charge", metadata },
  { ...basis, id: "txn_g2", amount: -5000, fee: 0, net: -5000, reporting_category: "refund", type: "refund", metadata },
];

describe.skipIf(!testDatabaseUrl)("Stripe-Zweck aus Metadaten und die Gebühren des Monats (Postgres)", () => {
  let psp: typeof import("./index.ts");
  let sammel: typeof import("../bank/sammelrechnung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    psp = await import("./index.ts");
    sammel = await import("../bank/sammelrechnung.ts");
    psp.setStripeClientFactory(
      () =>
        ({
          accountId: async () => "acct_gebuehr",
          darfZahlungenLesen: async () => true,
          balanceTransactions: async () => bewegungen,
        }) as unknown as StripeClient,
    );
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("zählt Zahlung und Erstattung nicht zu den Gebühren, auch wenn ihr Metadatenwert mit „Gebühr“ beginnt", async () => {
    const { id } = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Stripe",
      eingabe: { apiKey: "rk_live_abcdefghijklmnop" },
      config: { metadataKeys: "titel" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.abrufen(actor, id, new Date("2026-11-03T10:00:00Z"))).error).toBeNull();
    const [gebuehr] = await sql`
      select bank_account_id, booking_date::text as tag, purpose from bank_transactions where bank_reference = ${"txn_g1-gebuehr"}`;
    const { sammelrechnung } = await sammel.sammelrechnungVorschlag(
      {
        amount: -400,
        bookingDate: gebuehr!.tag,
        purpose: gebuehr!.purpose,
        counterpartyName: "Stripe",
        bankAccountId: gebuehr!.bank_account_id,
        open: -400,
      },
      "zahlungsdienstleister",
      [],
    );
    expect(sammelrechnung?.summe).toBe(-400);
  });
});
