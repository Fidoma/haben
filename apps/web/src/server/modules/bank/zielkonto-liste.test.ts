import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Bonus „Auf das Konto der Rechnung“ (#1887). Zwei Rechnungen über denselben Betrag an denselben Kunden,
 * eine aufs Standardkonto, eine auf ein weiteres Zahlungskonto. Die Zahlung geht auf das weitere Konto ein. Die
 * Detailansicht schlägt die Rechnung auf dieses Konto vor; Liste und „Bestätigen“ (#1440: „genau der Vorschlag, den die
 * Liste zeigt“) sollen denselben Vorschlag buchen. Alle Daten sind erfunden.
 */

const KONTO_IBAN = "DE12 1203 0000 1234 5678 90";

function dkbCsv(rows: [date: string, name: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"${KONTO_IBAN}"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [date, date, "Gebucht", name, "Testfirma", purpose, "Eingang", "", amount, "", "", ""].map((c) => `"${c}"`).join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

describe.skipIf(!testDatabaseUrl)("Zielkonto in Liste und Detailansicht des Bankabgleichs (Postgres, #1887)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    stammdaten = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, bankverbindungen, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 'ist', 'SKR03')`;
  });

  it("Liste und Bestätigen nehmen die Rechnung auf das Konto des Umsatzes, wie die Detailansicht", async () => {
    const nord = await stammdaten.createBankverbindung(actor, {
      bezeichnung: "Objekt Nord",
      iban: KONTO_IBAN.replace(/\s/g, ""),
      bic: "",
      bank: "",
      kontoinhaber: "",
    });
    const contactId = (
      await stammdaten.createContact(actor, {
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
      })
    ).id;
    const draft = (bankverbindungId: string | null) => ({
      contactId,
      bankverbindungId,
      issueDate: "2026-09-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd" as const,
      note: "",
      lines: [{ description: "Miete September", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 as const }],
    });
    const standard = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft(null))).id, kleinunternehmerStand);
    const aufNord = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft(nord.id))).id, kleinunternehmerStand);
    expect(standard.gross).toBe(aufNord.gross);
    expect(aufNord.seller?.iban).toBe(KONTO_IBAN.replace(/\s/g, ""));

    await bank.importStatement(actor, dkbCsv([["18.09.26", "Nordwerk Software GmbH", "Miete September", "1.190,00"]]), null);
    const [tx] = await sql<{ id: string }[]>`select id from bank_transactions`;

    // Detailansicht: die Rechnung auf das Konto, auf dem die Zahlung steht
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.suggestions[0]?.item.id).toBe(aufNord.id);

    // Liste: derselbe Vorschlag, und „Bestätigen“ bucht ihn
    const konten = await bank.listAccounts();
    const rows = await bank.listTransactions(
      konten.map((k) => k.id),
      "offen",
      "",
    );
    const { mitHinweisen } = await import("./umsatzauswahl.ts");
    const [row] = await mitHinweisen(rows, await bank.openItems(), await bank.ownAccounts(), konten);
    expect(row?.suggestion?.number).toBe(aufNord.number);
    expect(row?.bestaetigung).toMatchObject({ input: { kind: "invoice", invoiceId: aufNord.id } });
  });
});
