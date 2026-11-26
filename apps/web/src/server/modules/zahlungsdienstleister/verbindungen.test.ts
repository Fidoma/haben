import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PayPalClient, PayPalClientOptions, StripeBalanceTransaction, StripeClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Gemeinsame Anbindung der Zahlungsdienstleister gegen Postgres (#1729): mehrere Verbindungen beim selben Anbieter, jede in ihr
 * eigenes Konto; dasselbe Konto beim Anbieter nur einmal; Umzug der Zugänge aus stripe_connections und paypal_connections.
 * Der Stripe-Client ist nachgebaut; Kennungen und Beträge sind erfunden.
 */

const drizzle = (name: string) => readFileSync(new URL(`../../../../drizzle/${name}`, import.meta.url), "utf8");
const statements = (text: string) => text.split("--> statement-breakpoint").map((s) => s.trim());

const HEUTE = new Date("2026-11-07T10:00:00Z");

/** Je Schlüssel ein Konto bei Stripe mit einer Zahlung */
const KONTEN: Record<string, { acct: string; txn: string; betrag: number }> = {
  rk_live_shopdeaaaaaaaa: { acct: "acct_shop", txn: "txn_shop1", betrag: 11900 },
  rk_live_kurseaaaaaaaaa: { acct: "acct_kurse", txn: "txn_kurse1", betrag: 4900 },
  rk_live_wechselaaaaaaa: { acct: "acct_wechsel", txn: "txn_wechsel1", betrag: 2500 },
  rk_live_neuverbundenaa: { acct: "acct_neuverbunden", txn: "txn_neuverbunden1", betrag: 1500 },
};

function zahlung(txn: string, betrag: number): StripeBalanceTransaction {
  return {
    id: txn,
    object: "balance_transaction",
    amount: betrag,
    created: Math.floor(Date.parse("2026-11-05T09:00:00Z") / 1000),
    currency: "eur",
    description: `Zahlung ${txn}`,
    fee: 0,
    net: betrag,
    reporting_category: "charge",
    source: `ch_${txn}`,
    status: "available",
    type: "charge",
  } as StripeBalanceTransaction;
}

const fake = (apiKey: string) => {
  const konto = KONTEN[apiKey] ?? { acct: "acct_alt", txn: "txn_alt1", betrag: 1000 };
  return { accountId: async () => konto.acct, balanceTransactions: async () => [zahlung(konto.txn, konto.betrag)] } as unknown as StripeClient;
};

describe.skipIf(!testDatabaseUrl)("Verbindungen zu Zahlungsdienstleistern (Postgres)", () => {
  let psp: typeof import("./index.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    psp = await import("./index.ts");
    crypto = await import("../../crypto.ts");
    psp.setStripeClientFactory((options) => fake(options.apiKey));
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function konto(name: string, provider: string, ledgerIndex: number) {
    const [row] =
      await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values (${name}, 'zahlungsdienstleister', ${provider}, ${ledgerIndex}) returning id`;
    return row!.id as string;
  }

  it("holt bei einer Verbindung ohne Konto (aus dem Umzug, vor #1729 möglich) nichts und sagt, was fehlt", async () => {
    const zugang = crypto.encrypt(new TextEncoder().encode(JSON.stringify({ art: "schluessel", apiKey: "rk_live_ohnekontoaaaaa" })));
    const id = (
      await sql`insert into psp_connections (provider, name, account_id, key_hint, ciphertext, fetch_from, abruf_start)
        values ('stripe', 'Stripe', 'acct_ohne', 'aaaa', ${zugang}, '2026-11-01', '2026-11-01') returning id`
    )[0]!.id as string;
    const result = await psp.abrufen(actor, id, HEUTE);
    expect(result.accountName).toBeNull();
    expect(result.messages.join(" ")).toContain("noch kein Konto");
    expect((await sql`select fetch_from::text as f from psp_connections where id = ${id}`)[0]!.f).toBe("2026-11-01");
    await sql`delete from psp_connections where id = ${id}`;
  });

  it("ruft zwei Stripe-Verbindungen mit eigenem Namen je in ihr eigenes Konto ab", async () => {
    const shopKonto = await konto("Stripe Shop", "stripe", 1);
    const kurseKonto = await konto("Stripe Kurse", "stripe", 2);
    const shop = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Shop DE",
      bankAccountId: shopKonto,
      eingabe: { apiKey: "rk_live_shopdeaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    const kurse = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Online-Kurse",
      bankAccountId: kurseKonto,
      eingabe: { apiKey: "rk_live_kurseaaaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.abrufen(actor, shop, HEUTE)).accountName).toBe("Stripe Shop");
    expect((await psp.abrufen(actor, kurse, HEUTE)).accountName).toBe("Stripe Kurse");
    const umsaetze = await sql`select bank_account_id, amount from bank_transactions order by amount`;
    expect(umsaetze.map((u) => [u.bank_account_id, u.amount])).toEqual([
      [kurseKonto, 4900],
      [shopKonto, 11900],
    ]);
    const { verbindungen } = await psp.verbindungenUebersicht();
    expect(verbindungen.map((v) => [v.name, v.accountId, v.kontoName])).toEqual([
      ["Shop DE", "acct_shop", "Stripe Shop"],
      ["Online-Kurse", "acct_kurse", "Stripe Kurse"],
    ]);
  });

  it("lehnt dasselbe Stripe-Konto ein zweites Mal ab und ein Konto, das schon eine Verbindung nutzt", async () => {
    const drittes = await konto("Stripe drei", "stripe", 3);
    await expect(
      psp.speichereVerbindung(actor, {
        provider: "stripe",
        name: "Doppelt",
        bankAccountId: drittes,
        eingabe: { apiKey: "rk_live_shopdeaaaaaaaa" },
        fetchFrom: "2026-11-01",
      }),
    ).rejects.toThrow("Dieses Stripe-Konto ist schon als „Shop DE“ verbunden.");
    const [shopKonto] = await sql`select id from bank_accounts where name = 'Stripe Shop'`;
    await expect(
      psp.speichereVerbindung(actor, {
        provider: "stripe",
        name: "Neu",
        bankAccountId: shopKonto!.id,
        eingabe: { apiKey: "rk_live_neuaaaaaaaaaaa" },
        fetchFrom: "2026-11-01",
      }),
    ).rejects.toThrow("Das Konto Stripe Shop nutzt schon die Verbindung „Shop DE“.");
    const paypalKonto = await konto("PayPal", "paypal", 4);
    await expect(
      psp.speichereVerbindung(actor, {
        provider: "stripe",
        name: "Falsch",
        bankAccountId: paypalKonto,
        eingabe: { apiKey: "rk_live_neuaaaaaaaaaaa" },
        fetchFrom: "2026-11-01",
      }),
    ).rejects.toThrow("Das Konto gehört nicht zu diesem Zahlungsdienstleister.");
    expect(await sql`select count(*)::int as n from psp_connections`).toEqual([{ n: 2 }]);
  });

  it("prüft einen Zugang, ohne etwas zu speichern, und erkennt ein schon verbundenes Konto beim Anbieter (#1951)", async () => {
    const zaehlen = async () =>
      (
        await sql`select (select count(*) from psp_connections)::int as v, (select count(*) from bank_accounts)::int as k, (select count(*) from audit_log)::int as a`
      )[0];
    const vorher = await zaehlen();
    const schon = await psp.zugangPruefen("stripe", { apiKey: "rk_live_shopdeaaaaaaaa" }, {});
    expect(schon.accountId).toBe("acct_shop");
    expect(schon.schonVerbunden).toMatchObject({ name: "Shop DE", text: "Dieses Stripe-Konto ist schon als „Shop DE“ verbunden." });
    expect(schon.konto).toBeNull();
    // Ein neues Konto beim Anbieter: „Automatisch“ nimmt das freie Konto „Stripe drei“ aus dem Test davor
    const neu = await psp.zugangPruefen("stripe", { apiKey: "rk_live_neuverbundenaa" }, {});
    expect(neu).toMatchObject({ accountId: "acct_neuverbunden", keyHint: "enaa", schonVerbunden: null, gebunden: false, hinweise: [] });
    expect(neu.konto?.name).toBe("Stripe drei");
    await expect(psp.zugangPruefen("stripe", { apiKey: "rk_test_aaaaaaaaaaaaaa" }, {})).rejects.toThrow("Haben ruft nur Live-Umsätze ab");
    expect(await zaehlen()).toEqual(vorher);
  });

  it("zieht die Zugänge aus stripe_connections und paypal_connections mit Schlüssel, Abrufstand, Rhythmus und Konto um", async () => {
    await sql`delete from psp_connections`;
    const [stripeKonto] = await sql`select id from bank_accounts where name = 'Stripe Shop'`;
    const [paypalKonto] = await sql`select id from bank_accounts where name = 'PayPal'`;
    // Die Tabellen von vor #1729, wie die Migrationen sie angelegt haben
    for (const s of [...statements(drizzle("0305_paypal_zugang.sql")), ...statements(drizzle("0307_stripe_zugang.sql"))]) await sql.unsafe(s);
    const schluessel = crypto.encrypt(new TextEncoder().encode("rk_live_altaaaaaaaaaaa"));
    const paypalZugang = crypto.encrypt(new TextEncoder().encode(JSON.stringify({ clientId: "client-alt", clientSecret: "geheim-alt" })));
    await sql`insert into stripe_connections (account_id, key_hint, ciphertext, fetch_from, abruf_start, rhythmus, last_error)
      values ('acct_alt', 'aaaa', ${schluessel}, '2026-10-20', '2026-01-01', 'stuendlich', 'Abruf fehlgeschlagen: alt')`;
    await sql`insert into paypal_connections (account_id, key_hint, sandbox, ciphertext, zeitzone, fetch_from, abruf_start, rhythmus)
      values ('HAENDLERALT', '-alt', true, ${paypalZugang}, 'Europe/Vienna', '2026-10-15', '2026-02-01', 'woechentlich')`;
    // Nur der Umzug: Tabelle und Trigger stehen schon (0331 und der Anfang von 0332)
    for (const s of statements(drizzle("0332_psp_verbindungen_umzug.sql")).filter((s) => /^(--.*\n)*INSERT/m.test(s))) await sql.unsafe(s);
    for (const s of statements(drizzle("0333_psp_verbindungen_alte_tabellen.sql"))) await sql.unsafe(s);

    const rows =
      await sql`select provider, name, bank_account_id, account_id, key_hint, config, fetch_from::text as f, abruf_start::text as a, rhythmus, last_error
      from psp_connections order by provider`;
    expect(rows).toEqual([
      {
        provider: "paypal",
        name: "PayPal",
        bank_account_id: paypalKonto!.id,
        account_id: "HAENDLERALT",
        key_hint: "-alt",
        config: { sandbox: true, zeitzone: "Europe/Vienna" },
        f: "2026-10-15",
        a: "2026-02-01",
        rhythmus: "woechentlich",
        last_error: null,
      },
      {
        provider: "stripe",
        name: "Stripe",
        bank_account_id: stripeKonto!.id,
        account_id: "acct_alt",
        key_hint: "aaaa",
        config: {},
        f: "2026-10-20",
        a: "2026-01-01",
        rhythmus: "stuendlich",
        last_error: "Abruf fehlgeschlagen: alt",
      },
    ]);
    // Die Adapter lesen die alten Formen des Zugangs
    const idVon = async (p: string) => (await sql`select id from psp_connections where provider = ${p}`)[0]!.id as string;
    const stripeId = await idVon("stripe");
    const paypalId = await idVon("paypal");
    expect((await psp.ladeVerbindung(stripeId))!.zugang).toEqual({ art: "schluessel", apiKey: "rk_live_altaaaaaaaaaaa" });
    expect((await psp.ladeVerbindung(paypalId))!.zugang).toEqual({ art: "client", clientId: "client-alt", clientSecret: "geheim-alt" });
    // Und rufen damit ab: der Schlüssel geht an Stripe, der Stand rückt vor
    const result = await psp.abrufen(actor, stripeId, HEUTE);
    expect(result.error).toBeNull();
    expect((await sql`select fetch_from::text as f, last_error from psp_connections where id = ${stripeId}`)[0]).toEqual({ f: "2026-11-04", last_error: null });
    // PayPal ebenso: Client-ID, Secret und Sandbox aus dem Umzug gehen an PayPal
    const anPayPal: PayPalClientOptions[] = [];
    psp.setPayPalClientFactory((options) => {
      anPayPal.push(options);
      return { accountId: async () => "HAENDLERALT", transactions: async () => [] } as unknown as PayPalClient;
    });
    expect((await psp.abrufen(actor, paypalId, HEUTE)).error).toBeNull();
    expect(anPayPal).toEqual([expect.objectContaining({ clientId: "client-alt", clientSecret: "geheim-alt", environment: "sandbox" })]);
    expect((await sql`select last_error from psp_connections where id = ${paypalId}`)[0]).toEqual({ last_error: null });
  });

  it("lehnt ein anderes Konto in Haben ab, wenn der Abruf schon an ein Konto gebunden ist", async () => {
    // Die Quellenbindung (import_sources) hält das Stripe-Konto am Konto des ersten Abrufs; ein Wechsel ließe jeden weiteren
    // Abruf mit „Die Quelle des Abrufs ist schon mit einem anderen Konto verbunden“ scheitern
    const erstes = await konto("Stripe Wechsel A", "stripe", 5);
    const zweites = await konto("Stripe Wechsel B", "stripe", 6);
    const id = await psp.speichereVerbindung(actor, {
      provider: "stripe",
      name: "Wechsel",
      bankAccountId: erstes,
      eingabe: { apiKey: "rk_live_wechselaaaaaaa" },
      fetchFrom: "2026-11-01",
    });
    expect((await psp.abrufen(actor, id, HEUTE)).error).toBeNull();
    await expect(psp.speichereVerbindung(actor, { id, provider: "stripe", name: "Wechsel", bankAccountId: zweites, fetchFrom: "2026-11-01" })).rejects.toThrow(
      "Dieses Stripe-Konto ist schon mit dem Konto Stripe Wechsel A verbunden",
    );
    expect((await psp.abrufen(actor, id, new Date(HEUTE.getTime() + 60 * 60 * 1000))).error).toBeNull();
  });

  it("nimmt bei „Automatisch“ das Konto, an das der Abruf schon gebunden ist, auch nach dem Entfernen", async () => {
    // Das älteste freie Konto wäre ein anderes als das der Quellenbindung; die Verbindung schriebe sonst nie wieder
    await konto("Stripe Neu Älter", "stripe", 7);
    const gebunden = await konto("Stripe Neu Gebunden", "stripe", 8);
    const eingabe = { apiKey: "rk_live_neuverbundenaa" };
    const erste = await psp.speichereVerbindung(actor, { provider: "stripe", name: "Neu", bankAccountId: gebunden, eingabe, fetchFrom: "2026-11-01" });
    expect((await psp.abrufen(actor, erste, HEUTE)).error).toBeNull();
    await psp.entferneVerbindung(actor, erste);
    const zweite = await psp.speichereVerbindung(actor, { provider: "stripe", name: "Neu", bankAccountId: null, eingabe, fetchFrom: "2026-11-01" });
    expect((await psp.ladeVerbindung(zweite))!.row.bankAccountId).toBe(gebunden);
    expect((await psp.abrufen(actor, zweite, new Date(HEUTE.getTime() + 2 * 60 * 60 * 1000))).error).toBeNull();
  });

  it("legt ohne freies Konto eines mit dem Namen der Verbindung an, bis alle neun Verrechnungskonten belegt sind", async () => {
    // Das Konto „PayPal“ nutzt schon die umgezogene Verbindung; die zweite bekommt ihr eigenes
    let haendler = 0;
    psp.setPayPalClientFactory(() => ({ accountId: async () => `HAENDLER${++haendler}`, transactions: async () => [] }) as unknown as PayPalClient);
    const neue = (name: string) =>
      psp.speichereVerbindung(actor, { provider: "paypal", name, eingabe: { clientId: `client-${name}`, clientSecret: "geheim" }, fetchFrom: "2026-11-01" });
    const zweite = await neue("PayPal Zwei");
    const [konto] =
      await sql`select b.name, b.purpose, b.provider, b.ledger_index from psp_connections c join bank_accounts b on b.id = c.bank_account_id where c.id = ${zweite}`;
    expect(konto).toEqual({ name: "PayPal Zwei", purpose: "zahlungsdienstleister", provider: "paypal", ledger_index: expect.any(Number) });
    expect((await psp.abrufen(actor, zweite, HEUTE)).accountName).toBe("PayPal Zwei");
    // Bis alle neun Nummern vergeben sind, dann mit Meldung und ohne halbe Verbindung
    const frei = (await sql`select 9 - count(*)::int as frei from bank_accounts where ledger_index is not null`)[0]!.frei as number;
    for (let i = 0; i < frei; i++) await neue(`PayPal ${i + 3}`);
    const vorher = (await sql`select count(*)::int as n from psp_connections`)[0]!.n;
    await expect(neue("PayPal Zuviel")).rejects.toThrow("schon neun Zahlungsdienstleister");
    expect((await sql`select count(*)::int as n from psp_connections`)[0]!.n).toBe(vorher);
  });

  it("schreibt Änderungen ins Protokoll, ohne den Zugang", async () => {
    const audit = await sql`select new_value::text as v from audit_log where table_name = 'psp_connections'`;
    expect(audit.length).toBeGreaterThan(0);
    for (const { v } of audit) {
      expect(v ?? "").not.toContain("ciphertext");
      expect(v ?? "").not.toContain("rk_live");
    }
  });
});
