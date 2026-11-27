import { withActor } from "../../db/actor.ts";
import { contactPersonProblem } from "../stammdaten/index.ts";
import { draftInputOf } from "./external-reference.ts";
import { InvoiceError } from "./invoice-error.ts";
import { draftSchema } from "./draft-schema.ts";
import { assertCustomer, insertDraft } from "./invoice-drafts.ts";
import { replacementProblem } from "./invoice-replacement.ts";
import { getInvoice, type Invoice } from "./invoices.ts";
import { uebernommeneBankverbindung } from "./beleg-bankverbindung.ts";
import { mitVorlage } from "./beleg-platzhalter.ts";

/** Warum sich eine Rechnung nicht kopieren lässt; null = sie lässt sich kopieren */
function copyProblem(invoice: Pick<Invoice, "kind" | "variant">): string | null {
  if (invoice.kind !== "rechnung") return "Stornorechnungen und Korrekturen lassen sich nicht kopieren.";
  if (invoice.variant !== null) return "Abschlags- und Schlussrechnungen lassen sich nicht kopieren; sie entstehen aus dem Angebot.";
  return null;
}

/**
 * Kopie für die nächste ähnliche Rechnung oder gezielter Ersatz derselben Leistung.
 * Anhänge bleiben am ursprünglichen Beleg. Nur beim Austausch werden Leistungszeitraum, Angebot und Kurs übernommen.
 */
export async function copyInvoice(actor: string, id: string, today: string, { replacement = false }: { replacement?: boolean } = {}): Promise<Invoice> {
  const data = await getInvoice(id);
  if (!data) throw new InvoiceError("Rechnung nicht gefunden.");
  const { invoice, lines } = data;
  const problem = copyProblem(invoice);
  if (problem) throw new InvoiceError(problem);
  if (replacement && invoice.status !== "final") throw new InvoiceError("Ein Entwurf kann keine ausgestellte Rechnung ersetzen.");
  const paid = invoice.paymentMethod === "bereits_bezahlt";
  return withActor(actor, async (tx) => {
    await assertCustomer(tx, invoice.contactId);
    const personActive = (await contactPersonProblem(tx, invoice.contactId, invoice.contactPersonId)) === null;
    const input = draftSchema.parse({
      ...draftInputOf(invoice, lines),
      // Mit Platzhaltern, wie im Entwurf des Originals, nicht mit dessen Werten (#1334)
      ...mitVorlage(invoice),
      contactPersonId: personActive ? invoice.contactPersonId : null,
      bankverbindungId: await uebernommeneBankverbindung(tx, invoice),
      issueDate: today,
      serviceFrom: replacement ? invoice.serviceFrom : null,
      serviceTo: replacement ? invoice.serviceTo : null,
      exchangeRate: null,
      exchangeRateDate: null,
      paymentMethod: paid && !replacement ? "ueberweisung" : invoice.paymentMethod,
      paidVia: replacement ? invoice.paidVia : null,
      paidOn: replacement ? invoice.paidOn : null,
      quoteId: replacement ? invoice.quoteId : null,
      advanceType: null,
      replacesInvoiceId: replacement ? invoice.id : null,
      deducts: [],
    });
    const draft = await insertDraft(tx, input);
    if (replacement) {
      const problem = await replacementProblem(draft, invoice, tx);
      if (problem) throw new InvoiceError(`${problem}.`);
    }
    return draft;
  });
}
