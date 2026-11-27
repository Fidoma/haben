import { formatEuro } from "@haben/core";
import type { IncomingInvoice } from "@haben/einvoice";

/* Prüfung der E-Rechnung eines Stornos aus dem Fremdsystem (#1900), ohne Datenbank */

/** Ob die E-Rechnung etwas aufhebt: Gutschrift (Code 381 u. a., Beträge schon negiert) oder Rechnung mit negativem Betrag */
export const isCancellation = (invoice: IncomingInvoice) => invoice.isCreditNote || invoice.gross < 0;

type Rate = { rate: number; base: number; tax: number };

const byRate = (taxes: Rate[]) => {
  const sums = new Map<number, Rate>();
  for (const t of taxes) {
    const sum = sums.get(t.rate) ?? { rate: t.rate, base: 0, tax: 0 };
    sums.set(t.rate, { rate: t.rate, base: sum.base + t.base, tax: sum.tax + t.tax });
  }
  return [...sums.values()].sort((a, b) => b.rate - a.rate);
};

/** Was an der E-Rechnung des Stornos nicht zur Rechnung und zu den Angaben passt, oder null */
export function cancellationMismatch(
  xml: IncomingInvoice,
  original: { number: string; issueDate: string; taxes: Rate[] },
  input: { number: string; issueDate: string },
): string | null {
  if (!isCancellation(xml)) return "die E-Rechnung ist keine Gutschrift und hat keinen negativen Betrag";
  if (xml.currency !== "EUR") return `sie lautet auf ${xml.currency}`;
  if (xml.number !== input.number) return `Nummer ${xml.number} statt ${input.number}`;
  if (xml.issueDate !== input.issueDate) return `Datum ${xml.issueDate} statt ${input.issueDate}`;
  const ref = (xml.precedingInvoices ?? []).find((r) => r.number === original.number);
  if (!ref) return `sie nennt die Rechnung ${original.number} nicht (BT-25)`;
  if (ref.issueDate && ref.issueDate !== original.issueDate)
    return `sie nennt die Rechnung ${original.number} vom ${ref.issueDate} statt vom ${original.issueDate} (BT-26)`;
  const expected = byRate(original.taxes.map((t) => ({ rate: t.rate, base: -t.base, tax: -t.tax })));
  const given = byRate(xml.taxes);
  const same =
    given.length === expected.length && given.every((t, i) => t.rate === expected[i]!.rate && t.base === expected[i]!.base && t.tax === expected[i]!.tax);
  if (!same) {
    const gross = (taxes: Rate[]) => formatEuro(taxes.reduce((n, t) => n + t.base + t.tax, 0));
    return `Netto oder Steuer je Satz heben die Rechnung nicht genau auf (Storno ${gross(given)}, Rechnung ${gross(original.taxes)}); Haben übernimmt nur das volle Storno`;
  }
  return null;
}
