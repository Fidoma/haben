import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Direkte Links zwischen Buchung und Bankumsatz (#1855): Die Buchung einer Bankzuordnung kennt ihren Umsatz (Journal
 * und Kontenblatt), Rechnung und Zuordnung kennen ihre Buchungen, auch die Gegenbuchung einer Aufhebung.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

describe.skipIf(!testDatabaseUrl)("Verweise zwischen Buchung, Rechnung und Bankumsatz (#1855)", () => {
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let buchhaltung: typeof import("./index.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/index.ts");
    buchhaltung = await import("./index.ts");
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate document_settlements, document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, vat_returns, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03')`;
  });

  /** Rechnung über 1.190,00 € vom 05.03., am 20.03. bezahlt und dem Umsatz zugeordnet */
  async function bezahlteRechnung() {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-03-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistungen Februar", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["20.03.26", "20.03.26", "Gebucht", "Nordwerk Software GmbH", "Testfirma", "RE", "Eingang", "DE02100100100006820101", "1.190,00", "", "", ""],
        ]),
        filename: "maerz.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id as string, invoiceId: invoice.id, amount: 119_000 });
    const [allocation] = await sql`select id from allocations where reverses_id is null`;
    return { invoiceId: invoice.id, transactionId: tx!.id as string, allocationId: allocation!.id as string };
  }

  it("die Buchung der Zuordnung nennt im Journal und auf dem Kontenblatt ihren Umsatz", async () => {
    const { transactionId } = await bezahlteRechnung();
    const journal = await buchhaltung.loadJournal(2026, 3);
    expect(journal.find((e) => e.sourceType === "allocation")?.transactionId).toBe(transactionId);
    // Andere Herkünfte haben keinen Umsatz
    expect(journal.find((e) => e.sourceType === "invoice")?.transactionId).toBeNull();
    const forderungen = await buchhaltung.kontenblatt("1400", buchhaltung.ledgerRange(2026, "m3"));
    expect(forderungen.zeilen.find((z) => z.sourceType === "allocation")?.transactionId).toBe(transactionId);
  }, 30_000);

  it("die Rechnung kennt ihre Buchung, die Zuordnung ihre und nach der Aufhebung die Gegenbuchung", async () => {
    const { invoiceId, transactionId, allocationId } = await bezahlteRechnung();
    const [rechnung] = (await buchhaltung.buchungenZu(["invoice"], [invoiceId])).get(invoiceId) ?? [];
    expect(rechnung).toMatchObject({ date: "2026-03-05", reversal: false });
    const [journalRechnung] = await sql`select id from journal_entries where source_type = 'invoice' and source_id = ${invoiceId}`;
    expect(rechnung?.id).toBe(journalRechnung!.id);
    // Die Zahlung an der Rechnung verlinkt auf ihren Umsatz, dort steht ihre Buchung
    expect((await bank.invoicePaymentList(invoiceId)).map((z) => z.transactionId)).toEqual([transactionId]);

    expect((await bank.transactionDetail(transactionId))!.allocations.map((a) => a.buchungen)).toEqual([
      [{ id: expect.any(String), date: "2026-03-20", reversal: false }],
    ]);
    await bank.reverseAllocation(actor, allocationId, "2026-07-10");
    const [zuordnung] = (await bank.transactionDetail(transactionId))!.allocations;
    expect(zuordnung!.buchungen.map(({ date, reversal }) => ({ date, reversal }))).toEqual([
      { date: "2026-03-20", reversal: false },
      { date: "2026-07-10", reversal: true },
    ]);
  }, 30_000);

  /** Gebuchter Beleg vom 20.11. mit Leistung bis 14.12.: die Vorsteuer wird zum 14.12. freigegeben (#693) */
  async function belegMitFreigabe() {
    await sql`update company set journal_ab = 2026`;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 18, 55]), filename: "strom.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: "B-1855",
      documentDate: "2026-11-20",
      dueDate: null,
      serviceFrom: "2026-11-15",
      serviceTo: "2026-12-14",
      category: "edv",
      payment: "bank",
      note: "",
      privateShare: 0,
      amounts: [{ taxRate: 1900, net: 3_240, tax: 616 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  it("der Beleg kennt Buchung und Vorsteuerfreigabe, nach dem Storno beide Gegenbuchungen, in der Reihenfolge des Journals", async () => {
    const id = await belegMitFreigabe();
    const verweise = async () =>
      ((await buchhaltung.buchungenZu(["document", "freigabe"], [id])).get(id) ?? []).map(({ date, reversal }) => ({ date, reversal }));
    expect(await verweise()).toEqual([
      { date: "2026-11-20", reversal: false },
      { date: "2026-12-14", reversal: false },
    ]);
    await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg" }, "2026-11-25");
    expect(await verweise()).toEqual([
      { date: "2026-11-20", reversal: false },
      { date: "2026-11-20", reversal: true },
      { date: "2026-12-14", reversal: false },
      { date: "2026-12-14", reversal: true },
    ]);
  }, 30_000);

  it("der Link „Gegenbuchung“ am stornierten Beleg trifft den Storno des Belegs, nicht die spätere Umkehr der Freigabe", async () => {
    const id = await belegMitFreigabe();
    await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg" }, "2026-11-25");
    const { cancellation: storno } = await cancellation.documentCancellation(id);
    const [ziel] = await sql`select date::text, source_type from journal_entries where id = ${storno!.journalEntryId}`;
    // Der Link führt in den Monat des Stornos (cancellation.date); dort muss die Zeile stehen
    expect(ziel).toEqual({ date: storno!.date, source_type: "document" });
  }, 30_000);
});
