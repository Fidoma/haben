import { type FbMappedVoucher, isFbInvoiceImportable, mapFbInvoice } from "./map.ts";
import type { FbInvoice } from "./types.ts";

/*
 * Einnahmen aus revenue.get (#1938): Belege, die man in FastBill unter „Einnahmen“ erfasst statt sie als Rechnung zu
 * schreiben, etwa die Gutschrift einer Plattform. invoice.get liefert sie nicht. Die Antwort hat die Felder einer Rechnung
 * (https://apidocs.fastbill.com/fastbill/de/revenue.html); im echten Konto (November 2026) kam nur TYPE incoming_credit.
 * Im Altbestand sind sie Einnahmebelege wie die aus der Buchhaltung von Lexoffice: salesinvoice, negativ salescreditnote.
 */

/**
 * Was der Abruf mit einer Einnahme tut. Belegt ist am echten Konto nur incoming_credit. Entwürfe (TYPE oder STATE draft)
 * bleiben still draußen wie bei Rechnungen (isFbInvoiceImportable). Eine andere Art und eine stornierte Einnahme meldet
 * der Abruf, statt zu raten: Bei Rechnungen hebt die Stornogutschrift die Rechnung auf, für Einnahmen ist kein Gegenstück
 * belegt, und ohne es zählte die Einnahme bei Soll voll mit.
 */
export function fbRevenueKind(r: FbInvoice): "einnahme" | "entwurf" | "unbekannt" | "storniert" {
  if (!isFbInvoiceImportable(r)) return "entwurf";
  if (
    String(r.TYPE ?? "")
      .trim()
      .toLowerCase() !== "incoming_credit"
  )
    return "unbekannt";
  // Wie isCanceled in map.ts: STATE canceled oder IS_CANCELED 1
  const canceled =
    String(r.STATE ?? "")
      .trim()
      .toLowerCase() === "canceled" || String(r.IS_CANCELED ?? "").trim() === "1";
  return canceled ? "storniert" : "einnahme";
}

export function mapFbRevenue(r: FbInvoice): FbMappedVoucher {
  // Wie eine Rechnung, aber nie als Gutschrift von uns (TYPE credit) und ohne Storno-Bezug; das Vorzeichen bleibt
  const { voucher, payment } = mapFbInvoice({ ...r, TYPE: "outgoing", SUBTYPE: "standard" });
  return {
    voucher: { ...voucher, lexofficeId: `fastbill/revenue/${String(r.INVOICE_ID)}`, type: voucher.gross < 0 ? "salescreditnote" : "salesinvoice" },
    payment,
  };
}
