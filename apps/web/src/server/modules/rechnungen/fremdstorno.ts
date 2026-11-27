import { readEInvoice, type IncomingInvoice } from "@haben/einvoice";
import { cancellationMismatch } from "./fremdstorno-pruefung.ts";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { isUniqueViolation } from "../../errors.ts";
import { openBooks } from "../buchhaltung/index.ts";
import { lockInvoice } from "./advance-vat.ts";
import { originalProblem } from "./correction-checks.ts";
import { FREMDSYSTEM, fremdNummerSchema, looksLikePdf } from "./fremdsystem.ts";
import { assertNichtAusgebucht } from "./invoice-cancellation.ts";
import { InvoiceError } from "./invoice-error.ts";
import { sha256 } from "./invoice-finalize.ts";
import { postInvoice } from "./invoice-replacement-posting.ts";
import { getInvoice, type Invoice } from "./invoices.ts";
import type { RebuiltInvoice } from "./positionen-nachbilden.ts";
import { createTakenOverInvoice } from "./rechnung-uebernehmen.ts";
import { versteuerungIssues } from "./versteuerung-pruefung.ts";

/*
 * Storno einer aus dem Fremdsystem übernommenen Rechnung (#1900): Das Fremdsystem hat die Rechnung storniert und eine
 * E-Rechnung darüber verschickt, die sich mit BT-25 auf die Rechnung bezieht. Haben legt dazu ein festgeschriebenes Storno
 * an, mit Nummer, PDF und XML aus dem Fremdsystem, und bucht es wie ein Storno in Haben (postInvoice, zum Datum der
 * Gutschrift). Nur das volle Storno: Netto und Steuer je Satz heben die Rechnung genau auf; Teilbeträge und Dateien ohne
 * E-Rechnung kommen später (Umfang laut Maintainer im Issue).
 *
 * Quellen: Berichtigung der Steuer bei Änderung der Bemessungsgrundlage nach § 17 Abs. 1 UStG (im Zeitraum der Änderung),
 * vorausgegangene Rechnung BG-3 (BT-25, BT-26) und Gutschrift UNTDID 1001 Code 381 nach EN 16931,
 * Aufbewahrung in der ausgestellten Form nach § 14b UStG. https://www.gesetze-im-internet.de/ustg_1980/__17.html
 */

export const foreignCancellationSchema = z.object({
  /** Die übernommene Rechnung, die das Storno aufhebt */
  invoiceId: z.uuid(),
  /** Nummer des Stornos im Fremdsystem; sie bleibt unverändert */
  number: fremdNummerSchema,
  issueDate: z.iso.date(),
});

export type ForeignCancellationInput = z.input<typeof foreignCancellationSchema>;

/**
 * Die aus dem Fremdsystem übernommene Rechnung, auf die sich eine Gutschrift bezieht (BT-25), oder null, wenn keine oder
 * mehrere passen. Die Nummer allein genügt: Fremdsystem-Rechnungen sind je Nummer eindeutig (invoices_external_ref).
 */
export async function cancelledForeignInvoice(preceding: IncomingInvoice["precedingInvoices"], q: Db | Tx = db): Promise<Invoice | null> {
  const numbers = [...new Set((preceding ?? []).map((ref) => ref.number))];
  if (numbers.length === 0) return null;
  const found = await q
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.externalSource, FREMDSYSTEM),
        inArray(schema.invoices.externalId, numbers),
        eq(schema.invoices.kind, "rechnung"),
        eq(schema.invoices.status, "final"),
      ),
    );
  return found.length === 1 ? found[0]! : null;
}

/** Steuer je Satz einer festgeschriebenen Rechnung */
const taxesOf = (q: Db | Tx, id: string) =>
  q
    .select({ rate: schema.invoiceTaxes.rate, base: schema.invoiceTaxes.base, tax: schema.invoiceTaxes.tax })
    .from(schema.invoiceTaxes)
    .where(eq(schema.invoiceTaxes.invoiceId, id));

/**
 * Vorschlag beim Einlesen: die Rechnung, die die Gutschrift aufhebt, und was schon jetzt gegen die Übernahme spricht
 * (Beträge, BT-26), damit der Dialog es vor dem Klick zeigt. Ob die Rechnung storniert, korrigiert oder ausgebucht ist,
 * prüft erst die Übernahme unter Sperre.
 */
export async function cancellationProposal(xml: IncomingInvoice, q: Db | Tx = db) {
  const invoice = await cancelledForeignInvoice(xml.precedingInvoices, q);
  if (!invoice) return null;
  const problem = cancellationMismatch(
    xml,
    { number: invoice.number!, issueDate: invoice.issueDate, taxes: await taxesOf(q, invoice.id) },
    { number: xml.number, issueDate: xml.issueDate },
  );
  return {
    invoiceId: invoice.id,
    number: invoice.number!,
    issueDate: invoice.issueDate,
    gross: invoice.gross,
    contactName: invoice.buyer?.name ?? null,
    problem: problem && `Die E-Rechnung passt nicht: ${problem}.`,
  };
}

/** Die übernommene Rechnung, gesperrt, wenn sie sich stornieren lässt; sonst der Grund als InvoiceError */
async function cancellableOriginal(tx: Tx, id: string, issueDate: string) {
  await lockInvoice(tx, id);
  const data = await getInvoice(id, tx);
  const original = data?.invoice;
  if (!data || !original || original.externalSource !== FREMDSYSTEM || original.kind !== "rechnung" || original.status !== "final")
    throw new InvoiceError("Das Storno bezieht sich auf keine aus dem Fremdsystem übernommene Rechnung.");
  const problem = await originalProblem(original, tx);
  if (problem) throw new InvoiceError(`${problem}.`);
  const [correction] = await tx
    .select({ number: schema.invoices.number })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.correctsId, id), eq(schema.invoices.kind, "korrektur"), eq(schema.invoices.status, "final")))
    .limit(1);
  if (correction)
    throw new InvoiceError(
      `Die Rechnung ${original.number} hat eine Korrektur (${correction.number}). Ein Storno aus dem Fremdsystem übernimmt Haben nur für Rechnungen ohne Korrektur.`,
    );
  await assertNichtAusgebucht(tx, [id]);
  if (issueDate < original.issueDate) throw new InvoiceError(`Das Storno ist älter als die Rechnung ${original.number}.`);
  return { original, lines: data.lines, taxes: await taxesOf(tx, id) };
}

/**
 * Übernimmt das Storno als festgeschriebenen Beleg und bucht es. Ohne lesbare E-Rechnung lehnt Haben ab: Nur sie belegt
 * Bezug (BT-25) und Beträge; die Angaben von Hand kommen später.
 */
export async function adoptForeignCancellationFile(
  actor: string,
  raw: ForeignCancellationInput,
  file: { bytes: Uint8Array; filename: string; mimeType: string },
): Promise<{ id: string }> {
  const input = foreignCancellationSchema.parse(raw);
  if (!looksLikePdf(file.bytes)) throw new InvoiceError("Das Original muss ein PDF sein.");
  const read = await readEInvoice(file).catch(() => null);
  if (!read) throw new InvoiceError("Ein Storno aus dem Fremdsystem übernimmt Haben nur aus einer E-Rechnung (ZUGFeRD) im PDF.");
  try {
    return await withActor(actor, async (tx) => {
      const company = await openBooks(tx);
      const { original, lines, taxes } = await cancellableOriginal(tx, input.invoiceId, input.issueDate);
      const problem = cancellationMismatch(read.invoice, { number: original.number!, issueDate: original.issueDate, taxes }, input);
      if (problem) throw new InvoiceError(`Die E-Rechnung in der Datei passt nicht: ${problem}.`);
      const issues = await versteuerungIssues(company, input.issueDate, tx);
      if (issues.length > 0) throw new InvoiceError(`Noch nicht bereit: ${issues.join(", ")}.`);
      const [contact] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, original.contactId!));
      if (!contact) throw new InvoiceError("Der Kunde der Rechnung fehlt.");

      const totals = {
        net: -original.net,
        tax: -original.tax,
        gross: -original.gross,
        taxes: taxes.map((t) => ({ rate: t.rate, base: -t.base, tax: -t.tax })).sort((a, b) => b.rate - a.rate),
      };
      const storno = await createTakenOverInvoice(tx, {
        company,
        contact,
        number: input.number,
        issueDate: input.issueDate,
        dueDate: input.issueDate,
        paymentTermDays: 0,
        serviceFrom: original.serviceFrom,
        serviceTo: original.serviceTo,
        serviceDate: original.serviceDate,
        taxTreatment: original.taxTreatment,
        exemptionReason: original.exemptionReason,
        taxDetails: original.taxDetails,
        note: `Storno der Rechnung ${original.number} aus dem Fremdsystem übernommen; das PDF ist das Original.`,
        priceMode: original.priceMode,
        totals,
        // Positionen der Rechnung mit umgekehrtem Vorzeichen, wie beim Storno in Haben (negatedLines)
        lines: lines.map((l) => ({
          position: l.position,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: -l.unitPrice,
          taxRate: l.taxRate,
          net: -l.net,
        })) as RebuiltInvoice["lines"],
        pdf: file.bytes,
        pdfSha256: sha256(file.bytes),
        xml: read.xml,
        origin: { externalSource: FREMDSYSTEM, externalId: input.number },
        storno: { correctsId: original.id, buyer: original.buyer },
      });
      await postInvoice(tx, storno, totals, company, original, `Storno ${input.number} aus dem Fremdsystem · ${contact.name}`);
      return { id: storno.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "invoices_external_ref") || isUniqueViolation(error, "invoices_number_unique"))
      throw new InvoiceError(`Die Nummer ${input.number} gibt es in Haben schon.`);
    throw error;
  }
}
