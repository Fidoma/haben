import { describe, expect, it } from "vitest";
import { withDedupHashes } from "../dedup.ts";
import { findHeaderRow } from "../table.ts";
import { isStripeHeader, parseStripe } from "../psp.ts";
import { stripeBatch } from "./batch.ts";
import { type StripeBalanceTransaction, StripeClient } from "./client.ts";
import { stripeStatement } from "./statement.ts";
import { metadatenZweck } from "./zweck.ts";

// Erfundene Werte; Reihenfolge wie in einem Payment Intent: Rechnungs-ID, Kundennummer, Rechnungsnummer
const ALLE = ["invoice_id", "customer_number", "invoice_number"];

const txn = (over: Partial<StripeBalanceTransaction> = {}): StripeBalanceTransaction => ({
  id: "txn_1",
  amount: 11900,
  created: Date.UTC(2026, 10, 2, 9) / 1000,
  currency: "eur",
  description: null,
  fee: 400,
  net: 11500,
  reporting_category: "charge",
  type: "charge",
  metadata: { invoice_id: "1042", customer_number: "5001", invoice_number: "RE-2026-0117" },
  ...over,
});

describe("metadatenZweck", () => {
  it("nimmt die gewählten Schlüssel in der gewählten Reihenfolge, nicht in der von Stripe", () => {
    expect(metadatenZweck(txn(), ["invoice_number", "invoice_id"])).toBe("RE-2026-0117 1042");
    expect(metadatenZweck(txn(), ALLE)).toBe("1042 5001 RE-2026-0117");
  });

  it("nennt ohne Auswahl, ohne passenden Wert, bei Auszahlung und Gebühr und ohne Metadaten nichts", () => {
    expect(metadatenZweck(txn(), [])).toBeUndefined();
    expect(metadatenZweck(txn(), ["fehlt", "toString"])).toBeUndefined();
    expect(metadatenZweck(txn({ reporting_category: "payout" }), ALLE)).toBeUndefined();
    expect(metadatenZweck(txn({ reporting_category: "fee" }), ALLE)).toBeUndefined();
    expect(metadatenZweck(txn({ metadata: undefined }), ALLE)).toBeUndefined();
  });

  it("gilt nur für Zahlung, Erstattung und Streit, nicht für Transfer, Aufladung und Ähnliches", () => {
    for (const reporting_category of ["topup", "transfer", "contribution", "platform_earning", "risk_reserved_funds", "advance"]) {
      expect(metadatenZweck(txn({ reporting_category }), ALLE)).toBeUndefined();
    }
    expect(metadatenZweck(txn({ reporting_category: "refund" }), ALLE)).toBeDefined();
  });

  // Kategorien und ihre Typen: https://docs.stripe.com/reports/reporting-categories (charge_failure: payment_failure_refund,
  // die später fehlgeschlagene SEPA- oder ACH-Zahlung; partial_capture_reversal: refund, nicht eingezogener Teil)
  it("gilt auch für die fehlgeschlagene Zahlung und die Rückbuchung eines teilweisen Einzugs", () => {
    for (const [reporting_category, type] of [
      ["charge_failure", "payment_failure_refund"],
      ["partial_capture_reversal", "refund"],
    ] as const) {
      const zeile = stripeStatement([txn({ reporting_category, type, amount: -11900, fee: 0, net: -11900 })], ["invoice_number"]).transactions[0]!;
      expect(zeile.purpose).toBe("RE-2026-0117");
      expect(zeile.hashPurpose).toBe(`${reporting_category} · txn_1`);
    }
  });

  it("zerschneidet beim Kürzen kein Zeichen aus zwei Codeeinheiten", () => {
    const zweck = metadatenZweck(txn({ metadata: { a: "x".repeat(499) + "\u{1F600}" } }), ["a"])!;
    expect(zweck.endsWith("\u{1F600}")).toBe(true);
    expect(Array.from(zweck)).toHaveLength(500);
  });

  it("lässt fehlende Schlüssel weg und kürzt und glättet lange oder mehrzeilige Werte", () => {
    expect(metadatenZweck(txn(), ["fehlt", "invoice_number"])).toBe("RE-2026-0117");
    expect(metadatenZweck(txn({ metadata: { a: "x\ny", b: "z".repeat(600) } }), ["a", "b"])!.length).toBeLessThanOrEqual(500);
    expect(metadatenZweck(txn({ metadata: { a: "x\ny" } }), ["a"])).toBe("x y");
  });
});

describe("Zweck im Abruf", () => {
  const statement = stripeStatement([txn()], ALLE);
  const [zahlung, gebuehr] = statement.transactions;

  it("zeigt die Metadaten bei der Zahlung, die Gebühr bleibt", () => {
    expect(zahlung!.purpose).toBe("1042 5001 RE-2026-0117");
    expect(gebuehr!.purpose).toBe("Gebühr · txn_1");
    expect(
      stripeBatch({
        externalAccountId: "acct_1",
        transactions: [txn()],
        dateFrom: "2026-11-01",
        dateTo: "2026-11-03",
        fetchedAt: "2026-11-03T06:00:00Z",
        fetchId: "a",
      }).movements[0]!.purpose,
    ).toBe("charge");
  });

  it("erkennt dieselbe Zeile des CSV-Exports am Dubletten-Hash wieder", () => {
    const rows = [
      ["balance_transaction_id", "created_utc", "reporting_category", "gross", "fee", "net", "currency", "description"],
      ["txn_1", "2026-11-02 09:00:00", "charge", "119.00", "4.00", "115.00", "eur", ""],
    ];
    const csv = parseStripe(rows, findHeaderRow(rows, isStripeHeader));
    expect(withDedupHashes(statement.transactions).map((t) => t.dedupHash)).toEqual(withDedupHashes(csv.transactions).map((t) => t.dedupHash));
  });

  it("lässt den Zweck ohne Metadaten wie beim Export", () => {
    const ohne = stripeStatement([txn({ metadata: undefined })], ALLE).transactions[0]!;
    expect(ohne.purpose).toBe("charge · txn_1");
    expect(ohne.hashPurpose).toBeUndefined();
    expect(stripeStatement([txn()]).transactions[0]!.purpose).toBe("charge · txn_1");
  });
});

describe("StripeClient: Metadaten", () => {
  const roh = (source: unknown, id: string) => ({
    id,
    amount: 100,
    created: 1_790_000_000,
    currency: "eur",
    fee: 0,
    net: 100,
    type: "charge",
    reporting_category: "charge",
    source,
  });

  it("liest sie aus dem Charge, bei Erstattung aus dem der Zahlung, ohne leere Werte", async () => {
    const body = {
      data: [
        roh({ id: "ch_1", metadata: { invoice_id: "1042", customer_number: "5001", invoice_number: "RE-2026-0117", leer: " " } }, "txn_c"),
        roh({ id: "re_1", charge: { id: "ch_1", metadata: { invoice_id: "1042" }, balance_transaction: "txn_c" } }, "txn_r"),
        roh({ id: "ch_2", metadata: {} }, "txn_n"),
        roh({ id: "tr_1", metadata: { invoice_number: "INTERN-7" } }, "txn_t"),
        roh({ id: "re_2", metadata: { invoice_number: "INTERN-8" } }, "txn_o"),
      ],
      has_more: false,
    };
    const fetchMock = (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    const all = await new StripeClient({ apiKey: "rk_live_abcdefghijkl", fetch: fetchMock }).balanceTransactions("2026-09-01", "2026-10-31");
    expect(all.map((t) => t.metadata)).toEqual([
      { invoice_id: "1042", customer_number: "5001", invoice_number: "RE-2026-0117" },
      { invoice_id: "1042" },
      undefined,
      undefined,
      undefined,
    ]);
  });
});
