import { discountFromColumns, type UnitLabel } from "@haben/core";
import type { Quote, QuoteDraftInput, QuoteLine } from "./quotes.ts";

/**
 * Eingabe des Editors aus einem gespeicherten Angebotsentwurf, wie die Seite /angebote/$id sie aufbaut. Grundlage für
 * Änderungen über die REST-API: Was ein Aufruf nicht nennt, bleibt wie gespeichert, auch Rabatte und Zahlungsplan, die
 * die API selbst nicht setzt.
 */
export function quoteDraftInputOf(quote: Quote, lines: QuoteLine[]): QuoteDraftInput {
  return {
    contactId: quote.contactId,
    contactPersonId: quote.contactPersonId,
    bankverbindungId: quote.bankverbindungId,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    serviceFrom: quote.serviceFrom,
    serviceTo: quote.serviceTo,
    intro: quote.intro,
    note: quote.note,
    buyerOrderReference: quote.buyerOrderReference,
    sellerOrderReference: quote.sellerOrderReference,
    despatchAdviceReference: quote.despatchAdviceReference,
    taxTreatment: quote.taxTreatment,
    exemptionReason: quote.exemptionReason,
    taxDetails: quote.taxDetails,
    priceMode: quote.priceMode,
    language: quote.language,
    discount: discountFromColumns(quote.discountPercent, quote.discountAmount),
    paymentPlan: quote.paymentPlan,
    paymentPlanInConfirmation: quote.paymentPlanInConfirmation,
    lines: lines.map((line) => ({
      description: line.description,
      detail: line.detail,
      itemNumber: line.itemNumber,
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate as 1900 | 700 | 0,
      discount: discountFromColumns(line.discountPercent, line.discountAmount),
      kind: line.kind,
      arbeitskosten: line.arbeitskosten,
    })),
  };
}
