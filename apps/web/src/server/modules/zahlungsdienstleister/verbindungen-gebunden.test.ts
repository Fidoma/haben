import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StripeBalanceTransaction, StripeClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Konto der Quellenbindung (#306) beim Speichern einer Verbindung (#1729): Nach dem Entfernen kann eine andere Verbindung das
 * gebundene Konto übernommen haben. Die erneute Verbindung zum alten Stripe-Konto muss das mit einer Meldung sagen, statt an
 * der Datenbank zu scheitern. Der Stripe-Client ist nachgebaut; Kennungen und Beträge sind erfunden.
 */

const HEUTE = new Date("2026-11-07T10:00:00Z");

const KONTEN: Record<string, string> = {
  rk_live_alteaaaaaaaaaa: "acct_alt",
  rk_live_andereaaaaaaaa: "acct_andere",
  rk_live_dritteaaaaaaaa: "acct_dritte",
  rk_live_vierteaaaaaaaa: "acct_vierte",
};

const fake = (apiKey: string) =>
  ({
    accountId: async () => KONTEN[apiKey] ?? "acct_unbekannt",
    balanceTransactions: async () => [
      {
        id: `txn_${KONTEN[apiKey]}`,
        object: "balance_transaction",
        amount: 1000,
        created: Math.floor(Date.parse("2026-11-05T09:00:00Z") / 1000),
        currency: "eur",
        description: "Zahlung",
        fee: 0,
        net: 1000,
        reporting_category: "charge",
        source: `ch_${KONTEN[apiKey]}`,
        status: "available",
        type: "charge",
      } as StripeBalanceTransaction,
    ],
  }) as unknown as StripeClient;

describe.skipIf(!testDatabaseUrl)("Verbindung zu einem schon gebundenen Konto des Anbieters (Postgres)", () => {
  let psp: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    psp = await import("./index.ts");
    psp.setStripeClientFactory((options) => fake(options.apiKey));
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("gibt einem anderen Stripe-Konto nicht das Konto, an das ein früheres gebunden ist; das frühere bekommt es wieder", async () => {
    const { id: erste } = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Alt",
      eingabe: { apiKey: "rk_live_alteaaaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.abrufen(actor, erste, HEUTE)).error).toBeNull();
    const gebunden = (await psp.ladeVerbindung(erste))!.row.bankAccountId!;
    await psp.entferneVerbindung(actor, erste);
    // „Automatisch“ nimmt das frei gewordene Konto nicht: Es enthält die Umsätze des alten Stripe-Kontos (ein Konto, eine Quelle, #306)
    const { id: andere } = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Andere",
      eingabe: { apiKey: "rk_live_andereaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.ladeVerbindung(andere))!.row.bankAccountId).not.toBe(gebunden);
    // Gewählt wird es auch nicht (vor dem ersten Abruf; danach hält schon die eigene Quellenbindung die Verbindung)
    await expect(
      psp.speichereVerbindung(actor, { id: andere, provider: "stripe", name: "Andere", bankAccountId: gebunden, fetchFrom: "2026-11-01" }),
    ).rejects.toThrow("bekommt schon die Umsätze eines anderen Stripe-Kontos");
    expect((await psp.abrufen(actor, andere, HEUTE)).error).toBeNull();
    // Das alte Stripe-Konto schreibt wieder in sein Konto
    const { id: wieder } = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Alt wieder",
      eingabe: { apiKey: "rk_live_alteaaaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.ladeVerbindung(wieder))!.row.bankAccountId).toBe(gebunden);
    await psp.entferneVerbindung(actor, wieder);
  });

  it("meldet, welche Verbindung das gebundene Konto nutzt, statt an der Datenbank zu scheitern (Stand von vor dieser Prüfung)", async () => {
    // So konnte es vor der Prüfung oben entstehen: eine andere Verbindung im gebundenen Konto
    const [alt] = await sql`select bank_account_id as id from import_sources where external_account_id = 'acct_alt'`;
    const andere = (await sql`select id from psp_connections where name = 'Andere'`)[0]!.id as string;
    await sql`update psp_connections set bank_account_id = ${alt!.id} where id = ${andere}`;
    const wieder = psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Alt wieder",
      eingabe: { apiKey: "rk_live_alteaaaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    await expect(wieder).rejects.toBeInstanceOf(psp.ZahlungsdienstleisterError);
    await expect(wieder).rejects.toThrow("„Andere“");
  });

  it("behält beim Wechsel auf ein anderes Stripe-Konto mit „Automatisch“ nicht das schon gebundene Konto", async () => {
    const { id } = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Wechsel Alt",
      eingabe: { apiKey: "rk_live_dritteaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.abrufen(actor, id, HEUTE)).error).toBeNull();
    const gebunden = (await psp.ladeVerbindung(id))!.row.bankAccountId!;
    // Kontowechsel auf ein neues Stripe-Konto mit „Automatisch“: das bisherige Konto gehört schon zu acct_dritte (#306)
    await psp.speichereVerbindung(actor, {
      id,
      provider: "stripe",
      name: "Wechsel Neu",
      bankAccountId: null,
      eingabe: { apiKey: "rk_live_vierteaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.ladeVerbindung(id))!.row.bankAccountId).not.toBe(gebunden);
  });
});
