import { describe, expect, it } from "vitest";
import { fbRevenueKind, mapFbRevenue } from "./einnahmen.ts";
import type { FbInvoice } from "./types.ts";

/*
 * Einnahmen aus revenue.get (#1938): Belege, die man in FastBill unter „Einnahmen“ erfasst, etwa eine Gutschrift einer
 * Plattform. Im echten Konto (November 2026) kamen nur TYPE incoming_credit, SUBTYPE standard, mit Datei und Zahlung,
 * in denselben Feldern wie invoice.get. Alle Werte hier sind erfunden.
 */

function revenue(overrides: Partial<FbInvoice> = {}): FbInvoice {
  return {
    INVOICE_ID: "501",
    TYPE: "incoming_credit",
    SUBTYPE: "standard",
    IS_CANCELED: "0",
    INVOICE_NUMBER: "GS-2024-3",
    INVOICE_TITLE: "Provision März",
    CUSTOMER_ID: "9",
    ORGANIZATION: "Plattform Beispiel GmbH",
    INVOICE_DATE: "2024-03-31",
    DUE_DATE: "2024-04-14",
    PAID_DATE: "2024-04-10",
    CURRENCY_CODE: "EUR",
    SUB_TOTAL: "200.00",
    VAT_TOTAL: "38.00",
    TOTAL: "238.00",
    VAT_ITEMS: [{ VAT_PERCENT: "19.00", COMPLETE_NET: "200.00", VAT_VALUE: "38.00" }],
    PAYMENTS: [{ DATE: "2024-04-10", AMOUNT: "238.00", TYPE: "Bank" }],
    DOCUMENT_URL: "https://my.fastbill.com/download/beispiel",
    ...overrides,
  };
}

describe("mapFbRevenue", () => {
  it("bildet eine empfangene Gutschrift als Einnahmebeleg mit Steuer, Kontakt und Zahlung ab", () => {
    const { voucher, payment } = mapFbRevenue(revenue());
    expect(voucher).toMatchObject({
      lexofficeId: "fastbill/revenue/501",
      type: "salesinvoice",
      direction: "einnahme",
      number: "GS-2024-3",
      date: "2024-03-31",
      status: "paid",
      contactLexofficeId: "9",
      contactName: "Plattform Beispiel GmbH",
      net: 20_000,
      tax: 3_800,
      gross: 23_800,
      taxes: [{ rate: 1900, net: 20_000, tax: 3_800 }],
      remark: "Provision März",
    });
    expect(payment).toMatchObject({ status: "balanced", openAmount: 0, paidDate: "2024-04-10" });
    expect(payment.items).toEqual([{ type: "payment", date: "2024-04-10", amount: 23_800, account: "Bank" }]);
  });

  it("hält eine Einnahme mit negativem Betrag als Gutschrift, die die Einnahmen mindert", () => {
    const { voucher } = mapFbRevenue(
      revenue({ SUB_TOTAL: "-50.00", VAT_TOTAL: "-9.50", TOTAL: "-59.50", VAT_ITEMS: [{ VAT_PERCENT: "19.00", COMPLETE_NET: "-50.00", VAT_VALUE: "-9.50" }] }),
    );
    expect(voucher).toMatchObject({ type: "salescreditnote", direction: "einnahme", gross: -5_950, net: -5_000, tax: -950 });
  });

  it("führt eine unbezahlte Einnahme als offen", () => {
    const { voucher, payment } = mapFbRevenue(revenue({ PAID_DATE: "0000-00-00 00:00:00", PAYMENTS: [] }));
    expect(voucher.status).not.toBe("paid");
    expect(payment).toMatchObject({ status: "open", openAmount: 23_800 });
  });
});

describe("fbRevenueKind", () => {
  it("übernimmt incoming_credit; Entwürfe (TYPE oder STATE draft) bleiben still draußen wie bei Rechnungen", () => {
    expect(fbRevenueKind(revenue())).toBe("einnahme");
    expect(fbRevenueKind(revenue({ TYPE: "INCOMING_CREDIT" }))).toBe("einnahme");
    expect(fbRevenueKind(revenue({ TYPE: "draft" }))).toBe("entwurf");
    expect(fbRevenueKind(revenue({ STATE: "draft" }))).toBe("entwurf");
  });

  it("meldet eine unbekannte Art und eine stornierte Einnahme, statt zu raten", () => {
    expect(fbRevenueKind(revenue({ TYPE: "outgoing" }))).toBe("unbekannt");
    // Bei Rechnungen hebt die Stornogutschrift die Rechnung auf; für eine Einnahme ist kein Gegenstück belegt
    expect(fbRevenueKind(revenue({ IS_CANCELED: "1" }))).toBe("storniert");
    expect(fbRevenueKind(revenue({ STATE: "canceled" }))).toBe("storniert");
  });
});
