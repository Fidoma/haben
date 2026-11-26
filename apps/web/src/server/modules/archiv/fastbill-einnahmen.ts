import { type FastbillClient, type FbInvoice, fbRevenueKind } from "@haben/import";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { progressMessage } from "./umzug-gemeinsam.ts";

/*
 * Einnahmen aus FastBill (#1938) für die Belegliste des Abrufs (fastbill.ts). revenue.get liefert, was man in FastBill unter
 * „Einnahmen“ erfasst statt als Rechnung schreibt; archiviert und mit Beleg versehen werden sie wie die übrigen Belege.
 */

export type ListedRevenue = { kind: "revenue"; id: string; number: string; raw: FbInvoice };

/**
 * Was invoice.get schon geliefert hat, steht nur einmal im Archiv; Entwürfe bleiben still draußen, eine unbekannte Art und
 * eine stornierte Einnahme werden gemeldet (fbRevenueKind). Ein Fehler des Dienstes hält Rechnungen und Ausgaben nicht
 * auf, außer `stops` sagt, dass der Lauf enden muss (ungültiger Zugang, Abbruch).
 */
export async function listRevenues(
  client: FastbillClient,
  invoicesById: ReadonlyMap<string, FbInvoice>,
  progress: LexofficeImportProgress,
  add: (item: ListedRevenue) => Promise<void>,
  stops: (error: unknown) => boolean,
) {
  try {
    for await (const raw of client.revenues()) {
      const id = String(raw.INVOICE_ID);
      if (invoicesById.has(id)) continue;
      const number = String(raw.INVOICE_NUMBER ?? "");
      const kind = fbRevenueKind(raw);
      if (kind === "einnahme") await add({ kind: "revenue", id, number, raw });
      else if (kind === "unbekannt")
        progress.failed.push({ lexofficeId: `fastbill/revenue/${id}`, number, message: `Einnahme der Art „${String(raw.TYPE ?? "")}“ nicht übernommen.` });
      else if (kind === "storniert")
        progress.failed.push({
          lexofficeId: `fastbill/revenue/${id}`,
          number,
          message: "Stornierte Einnahme nicht übernommen: Gleiche sie mit FastBill ab und lege den Beleg in Schritt 4 als „Sonstiges“ ab.",
        });
    }
  } catch (error) {
    if (stops(error)) throw error;
    progress.failed.push({ lexofficeId: "fastbill/revenue", number: "Einnahmen", message: progressMessage(error) });
  }
}
