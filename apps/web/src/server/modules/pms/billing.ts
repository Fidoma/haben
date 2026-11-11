import { inArray, or } from "drizzle-orm";
import { db, schema } from "./database.ts";
import { createDraft, deleteDraft, listInvoices, newDraftDefaults } from "../rechnungen/index.ts";

/**
 * Einzige fachliche Schnittstelle des PMS zu einem anderen Servermodul: Rechnungen.
 * Alle Aufrufer im PMS verwenden ausschließlich diesen Adapter.
 */
export const createPmsInvoiceDraft = createDraft;
export const deletePmsInvoiceDraft = deleteDraft;
export const pmsInvoiceDefaults = newDraftDefaults;
export const listPmsInvoices = listInvoices;

/** Rechnungsdaten, die die PMS-Umsatzstatistik eindeutig Reservierungspositionen zuordnen kann. */
export async function pmsInvoiceAccounting(rootIds: string[]) {
  if (rootIds.length === 0) return { documents: [], lines: [] };
  const documents = await db
    .select({
      id: schema.invoices.id,
      rootId: schema.invoices.correctsId,
      status: schema.invoices.status,
      net: schema.invoices.net,
    })
    .from(schema.invoices)
    .where(or(inArray(schema.invoices.id, rootIds), inArray(schema.invoices.correctsId, rootIds)));
  const documentIds = documents.map((document) => document.id);
  const lines =
    documentIds.length === 0
      ? []
      : await db
          .select({ invoiceId: schema.invoiceLines.invoiceId, position: schema.invoiceLines.position, net: schema.invoiceLines.net })
          .from(schema.invoiceLines)
          .where(inArray(schema.invoiceLines.invoiceId, documentIds));
  return { documents, lines };
}
