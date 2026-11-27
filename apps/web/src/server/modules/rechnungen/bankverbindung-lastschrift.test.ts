import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Lastschrift mit weiteren Bankverbindungen (#1887): Eingezogen wird auf das Gläubigerkonto aus den Firmendaten. Auch ohne
 * Wahl (Abo, API) und bei einem Kunden mit eigener Vorgabe nennen Rechnung und Storno den Standard. Alle Daten sind erfunden.
 */
describe.skipIf(!testDatabaseUrl)("Lastschrift mit weiteren Bankverbindungen (Postgres, #1887)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let mandates: typeof import("../stammdaten/sepa-mandate.ts");
  const actor = "test-user";
  const STANDARD = "DE89370400440532013000";
  const NORD = "DE02120300000000202051";
  let contactId: string;
  let nordId: string;
  let mandateId: string;

  const kunde = {
    kundennummer: "",
    name: "Nordwerk Software GmbH",
    strasse: "Hafenstraße 5",
    plz: "20457",
    ort: "Hamburg",
    land: "DE",
    email: "buchhaltung@nordwerk.example",
    ustId: "",
    iban: "DE75512108001245126199",
    leitwegId: "",
    defaultFormat: null,
  };

  const draftInput = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-09-05",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Wartung September", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 as const }],
    ...overrides,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    stammdaten = await import("../stammdaten/index.ts");
    mandates = await import("../stammdaten/sepa-mandate.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, recurring_invoices,
      invoice_number_counters, sepa_mandate_files, sepa_mandate_revocations, sepa_mandates, contact_versions, contacts, bankverbindungen, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung, kontenrahmen, glaeubiger_id)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', ${STANDARD}, 'COBADEFFXXX', 'Commerzbank', 'ist', 'SKR03', 'DE98ZZZ09999999999')`;
    nordId = (await stammdaten.createBankverbindung(actor, { bezeichnung: "Objekt Nord", iban: NORD, bic: "", bank: "", kontoinhaber: "" })).id;
    contactId = (await stammdaten.createContact(actor, { ...kunde, bankverbindungId: nordId })).id;
    mandateId = await mandates.createMandate(
      actor,
      contactId,
      {
        reference: "KD-1042-01",
        signedOn: "2026-08-01",
        scheme: "CORE",
        firstSequence: "FRST",
        debtorName: "Nordwerk Software GmbH",
        debtorIban: "DE75512108001245126199",
      },
      "2026-09-05",
    );
  });

  it("Storno einer Lastschrift-Rechnung (Kunde mit Vorgabe, ohne Wahl wie Abo und API) nennt dieselbe Bankverbindung wie die Rechnung", async () => {
    const draft = await invoices.createDraft(actor, draftInput({ paymentMethod: "lastschrift", sepaMandateId: mandateId }));
    expect(draft.bankverbindungId).toBeNull();
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    expect(invoice.seller?.iban).toBe(STANDARD);
    const storno = await invoices.cancelInvoice(actor, draft.id, "2026-09-06");
    expect(storno.seller?.iban).toBe(invoice.seller?.iban);
  });
});
