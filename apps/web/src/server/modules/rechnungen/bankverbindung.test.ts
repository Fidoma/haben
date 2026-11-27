import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Weitere Zahlungskonten (#1887): Das Konto aus den Firmendaten bleibt der Standard. Gewählt am Kontakt (bevorzugt) oder am
 * Entwurf, steht das Zahlungskonto nach dem Festschreiben im Verkäufer, im PDF und in der E-Rechnung (BT-84, BT-85,
 * BT-86, EN 16931 BG-17). Festgeschrieben gilt nur diese Kopie: Storno, Korrektur, Angebot → Rechnung und Kopie finden
 * das Konto über ihre IBAN, und ein Zahlungskonto lässt sich jederzeit löschen. Keine Buchung hängt daran; SKR03 genügt.
 * Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Weitere Zahlungskonten an Rechnung, Angebot und Kontakt (Postgres, #1887)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let quotes: typeof import("./quotes.ts");
  let document: typeof import("./invoice-document.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let integrity: typeof import("../auswertungen/integrity.ts");
  let db: typeof import("../../db/index.ts").db;
  const actor = "test-user";
  const STANDARD = "DE89370400440532013000";
  const NORD = "DE02120300000000202051";
  let contactId: string;
  let nordId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    quotes = await import("./quotes.ts");
    document = await import("./invoice-document.ts");
    stammdaten = await import("../stammdaten/index.ts");
    integrity = await import("../auswertungen/integrity.ts");
    db = (await import("../../db/index.ts")).db;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate quote_lines, quotes, invoice_lines, invoices, invoice_number_counters, quote_number_counters, contact_versions, contacts, bankverbindungen, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', ${STANDARD}, 'COBADEFFXXX', 'Commerzbank', 'ist', 'SKR03')`;
    nordId = (
      await stammdaten.createBankverbindung(actor, {
        bezeichnung: "Objekt Nord",
        iban: NORD,
        bic: "BYLADEM1001",
        bank: "Deutsche Kreditbank",
        kontoinhaber: "Testfirma Objekt Nord",
      })
    ).id;
    contactId = (await stammdaten.createContact(actor, kunde)).id;
  });

  const kunde = {
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
  };

  const draftInput = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-09-05",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Miete September", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 as const }],
    ...overrides,
  });

  /** Zahlungsempfänger in der CII-XML (BG-17) */
  const konto = (xml: string | null) => xml?.match(/<ram:PayeePartyCreditorFinancialAccount>([\s\S]*?)<\/ram:PayeePartyCreditorFinancialAccount>/)?.[1] ?? "";

  it("prüft IBAN und BIC, lehnt die Standard-IBAN und doppelte ab", async () => {
    expect(
      stammdaten.bankverbindungSchema.parse({ bezeichnung: " Rücklage ", iban: "de02 1203 0000 0000 2020 51", bic: "", bank: "", kontoinhaber: "" }),
    ).toMatchObject({
      bezeichnung: "Rücklage",
      iban: NORD,
    });
    expect(stammdaten.bankverbindungSchema.safeParse({ bezeichnung: "X", iban: "DE02120300000000202052", bic: "", bank: "", kontoinhaber: "" }).success).toBe(
      false,
    );
    const leer = { bic: "", bank: "", kontoinhaber: "" };
    await expect(stammdaten.createBankverbindung(actor, { bezeichnung: "Doppelt", iban: NORD, ...leer })).rejects.toThrow("Objekt Nord");
    await expect(stammdaten.createBankverbindung(actor, { bezeichnung: "Standard", iban: STANDARD, ...leer })).rejects.toThrow("Standardkonto");
  });

  it("löscht ein Zahlungskonto, das festgeschriebene Belege nennen: sie behalten die Kopie, Entwürfe und Kontakte nehmen den Standard", async () => {
    await stammdaten.updateContact(actor, contactId, { ...kunde, bankverbindungId: nordId });
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput())).id, kleinunternehmerStand);
    // Festgeschrieben gilt nur die Kopie im Verkäufer, der Verweis ist leer
    expect(final.bankverbindungId).toBeNull();
    // Die Datenbank erzwingt das: Mit Verweis lässt sich keine Rechnung und kein Angebot festschreiben
    const pruefungen =
      await sql`select conname from pg_constraint where conname in ('invoices_bankverbindung_entwurf', 'quotes_bankverbindung_entwurf') order by conname`;
    expect(pruefungen.map((p) => p.conname)).toEqual(["invoices_bankverbindung_entwurf", "quotes_bankverbindung_entwurf"]);
    expect(final.seller?.iban).toBe(NORD);
    const entwurf = await invoices.createDraft(actor, draftInput());
    expect(entwurf.bankverbindungId).toBe(nordId);
    const siegelVorher = await sql`select * from seals order by id`;

    await stammdaten.deleteBankverbindung(actor, nordId);

    expect(await stammdaten.listBankverbindungen()).toEqual([]);
    expect((await invoices.getInvoice(entwurf.id))?.invoice.bankverbindungId).toBeNull();
    expect((await sql`select bankverbindung_id from contacts where id = ${contactId}`)[0]!.bankverbindung_id).toBeNull();
    expect((await invoices.getInvoice(final.id))?.invoice.seller?.iban).toBe(NORD);
    expect(await sql`select * from seals order by id`).toEqual(siegelVorher);
    // Nur die Rechnung dieses Tests: Audit-Log und Hash-Kette laufen über alle Tests der Datei weiter
    expect((await integrity.checkIntegrity("2026-09-10")).problems.filter((p) => p.zeile === final.id)).toEqual([]);
    // Neue Entwürfe nennen den Standard; ein gelöschtes Konto lässt sich nicht mehr wählen
    expect((await invoices.createDraft(actor, draftInput())).bankverbindungId).toBeNull();
    await expect(invoices.createDraft(actor, draftInput({ bankverbindungId: nordId }))).rejects.toThrow("gibt es nicht mehr");
  });

  it("Vorgabe am Kontakt: neuer Entwurf ohne Wahl bekommt sie; festgeschrieben stehen IBAN, BIC und Inhaber im Verkäufer und in der XML", async () => {
    await stammdaten.updateContact(actor, contactId, { ...kunde, bankverbindungId: nordId });
    const draft = await invoices.createDraft(actor, draftInput());
    expect(draft.bankverbindungId).toBe(nordId);
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);

    expect(invoice.seller).toMatchObject({ iban: NORD, bic: "BYLADEM1001", bank: "Deutsche Kreditbank", kontoinhaber: "Testfirma Objekt Nord" });
    expect(konto(invoice.xml)).toContain(`<ram:IBANID>${NORD}</ram:IBANID>`);
    expect(konto(invoice.xml)).toContain("<ram:AccountName>Testfirma Objekt Nord</ram:AccountName>");
    expect(invoice.xml).not.toContain(STANDARD);

    // Spätere Änderungen an der Bankverbindung berühren die festgeschriebene Rechnung nicht
    await stammdaten.updateBankverbindung(actor, nordId, { bezeichnung: "Objekt Nord", iban: "DE75512108001245126199", bic: "", bank: "", kontoinhaber: "" });
    expect((await invoices.getInvoice(draft.id))?.invoice.seller?.iban).toBe(NORD);
    expect((await integrity.checkIntegrity("2026-09-10")).problems.filter((p) => p.zeile === draft.id)).toEqual([]);
  });

  it("Wahl im Entwurf: null ist der Standard, ohne Angabe bleibt die bisherige, ein anderer Kunde bringt seine Vorgabe mit", async () => {
    const draft = await invoices.createDraft(actor, draftInput({ bankverbindungId: nordId }));
    expect(draft.bankverbindungId).toBe(nordId);
    // Ohne Angabe (API, Zeiteinträge) bleibt die Wahl
    expect((await invoices.updateDraft(actor, draft.id, draftInput())).bankverbindungId).toBe(nordId);
    const standard = await invoices.updateDraft(actor, draft.id, draftInput({ bankverbindungId: null }));
    expect(standard.bankverbindungId).toBeNull();
    const invoice = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    expect(invoice.seller).toMatchObject({ iban: STANDARD, bic: "COBADEFFXXX", bank: "Commerzbank" });
    expect(konto(invoice.xml)).toContain(`<ram:IBANID>${STANDARD}</ram:IBANID>`);
  });

  it("Bankabgleich: offene Rechnungen nennen ihr Zielkonto, sobald eine auf ein weiteres Zahlungskonto lautet", async () => {
    const { openItems } = await import("../bank/offene-posten.ts");
    const standard = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput())).id, kleinunternehmerStand);
    expect((await openItems()).find((i) => i.id === standard.id)?.zielIban).toBeUndefined();
    const nord = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput({ bankverbindungId: nordId }))).id, kleinunternehmerStand);
    const items = await openItems();
    expect(items.find((i) => i.id === nord.id)?.zielIban).toBe(NORD);
    expect(items.find((i) => i.id === standard.id)?.zielIban).toBe(STANDARD);
  });

  it("Storno nennt das weitere Zahlungskonto der Rechnung; ist es gelöscht, das heutige Standardkonto", async () => {
    const erste = await invoices.createDraft(actor, draftInput({ bankverbindungId: nordId }));
    await invoices.finalizeInvoice(actor, erste.id, kleinunternehmerStand);
    const storno = await invoices.cancelInvoice(actor, erste.id, "2026-09-06");
    expect(storno.bankverbindungId).toBeNull();
    expect(storno.seller).toMatchObject({ iban: NORD, bic: "BYLADEM1001", kontoinhaber: "Testfirma Objekt Nord" });

    const zweite = await invoices.createDraft(actor, draftInput({ bankverbindungId: nordId }));
    await invoices.finalizeInvoice(actor, zweite.id, kleinunternehmerStand);
    await stammdaten.deleteBankverbindung(actor, nordId);
    expect((await invoices.cancelInvoice(actor, zweite.id, "2026-09-06")).seller?.iban).toBe(STANDARD);
  });

  it("Korrektur einer Rechnung aufs Standardkonto nennt das heutige Standardkonto, auch nach einem Wechsel der Firmen-IBAN", async () => {
    const rechnung = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput())).id, kleinunternehmerStand);
    expect(rechnung.seller?.iban).toBe(STANDARD);
    // Das alte Konto ist aufgelöst; in den Firmendaten steht ein neues
    await sql`update company set iban = 'DE75512108001245126199', bic = '', bank = 'Neue Bank' where id = 1`;
    const korrektur = await invoices.createCorrection(actor, rechnung.id, "2026-10-01");
    expect(korrektur.bankverbindungId).toBeNull();
    const fest = await invoices.finalizeInvoice(actor, korrektur.id, kleinunternehmerStand);
    expect(fest.seller).toMatchObject({ iban: "DE75512108001245126199", bank: "Neue Bank" });
  });

  it("Angebot: Wahl im Angebot, beim Festschreiben im Verkäufer, und die Rechnung aus dem Angebot übernimmt sie", async () => {
    const quote = await quotes.createQuoteDraft(actor, {
      contactId,
      bankverbindungId: nordId,
      issueDate: "2026-09-05",
      validUntil: "2026-10-05",
      serviceFrom: null,
      serviceTo: null,
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const final = await quotes.finalizeQuote(actor, quote.id);
    expect(final.seller?.iban).toBe(NORD);
    expect(final.bankverbindungId).toBeNull();
    // Die Rechnung findet das Konto über die IBAN in der Kopie des Angebots
    const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-09-10");
    expect(invoice.bankverbindungId).toBe(nordId);
  });

  it("Kopie einer festgeschriebenen Rechnung: Konto über die IBAN, Standard bleibt Standard, ein gelöschtes Konto wird zur Vorgabe des Kunden", async () => {
    const nord = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput({ bankverbindungId: nordId }))).id, kleinunternehmerStand);
    const standard = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, draftInput({ bankverbindungId: null }))).id,
      kleinunternehmerStand,
    );
    expect((await invoices.copyInvoice(actor, nord.id, "2026-09-10")).bankverbindungId).toBe(nordId);
    expect((await invoices.copyInvoice(actor, standard.id, "2026-09-10")).bankverbindungId).toBeNull();
    const sued = await stammdaten.createBankverbindung(actor, {
      bezeichnung: "Objekt Süd",
      iban: "DE75512108001245126199",
      bic: "",
      bank: "",
      kontoinhaber: "",
    });
    await stammdaten.updateContact(actor, contactId, { ...kunde, bankverbindungId: sued.id });
    await stammdaten.deleteBankverbindung(actor, nordId);
    expect((await invoices.copyInvoice(actor, nord.id, "2026-09-10")).bankverbindungId).toBe(sued.id);
  });

  it("Lastschrift: auf dem Beleg steht der Standard, denn eingezogen wird auf das Gläubigerkonto", async () => {
    const company = await stammdaten.loadCompany();
    expect((await document.draftSeller(db, company, { bankverbindungId: nordId, paymentMethod: "lastschrift" })).iban).toBe(STANDARD);
    expect((await document.draftSeller(db, company, { bankverbindungId: nordId, paymentMethod: "ueberweisung" })).iban).toBe(NORD);
  });
});
