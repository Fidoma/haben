import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Umsätze als Kleinunternehmer in Kz 48 (#1268): Die Anleitung zur UStVA 2026 nennt unter Kz 48 die Umsätze nach § 19
 * Abs. 1 UStG und ordnet den Gesamtbetrag dem Voranmeldungszeitraum der Leistungsausführung zu, Anzahlungen ausgenommen,
 * ohne Ausnahme für die Ist-Versteuerung. Gesendete Voranmeldungen ohne diese Umsätze bleiben, wie sie sind.
 */
describe.skipIf(!testDatabaseUrl)("Kleinunternehmer-Umsätze in Kz 48 (Postgres)", () => {
  let vat: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let cash: typeof import("../bank/cash-income.ts");
  let sql: postgres.Sql;
  const actor = "kz48-ku-test";
  const september = { year: 2026, month: 9 };
  const oktober = { year: 2026, month: 10 };
  const november = { year: 2026, month: 11 };
  let contactId: string;
  let nummer = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("./index.ts");
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    cash = await import("../bank/cash-income.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions, bank_imports,
      bank_accounts, cash_entries, journal_lines, journal_entries, invoice_lines, invoice_taxes, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung,
        kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              '', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, true)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  }

  /** Rechnung als Kleinunternehmer vom 03.10.2026 über 800,00 € für eine Leistung im September */
  async function rechnung() {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-10-03",
      serviceFrom: "2026-09-01",
      serviceTo: "2026-09-30",
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: "kleinunternehmer",
      lines: [{ description: "Webdesign", quantity: 1000, unit: "Psch.", unitPrice: 80_000, taxRate: 0 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  /** Festgeschriebene Rechnung direkt in der Datenbank, für Anzahlung, Schlussrechnung und Storno */
  async function direkt(werte: Record<string, unknown>, net: number, abzuege: { von: string; net: number }[] = []) {
    const [row] = await sql`insert into invoices ${sql({
      contact_id: contactId,
      tax_treatment: "kleinunternehmer",
      due_date: "2026-12-31",
      net,
      tax: 0,
      gross: net,
      ...werte,
    } as Record<string, string | number | null>)} returning id, kind`;
    await sql`insert into invoice_taxes (invoice_id, rate, base, tax) values (${row!.id}, 0, ${net}, 0)`;
    let position = 0;
    for (const a of abzuege)
      await sql`insert into invoice_lines (invoice_id, position, description, quantity, unit, unit_price, tax_rate, net, deduction_of)
        values (${row!.id}, ${position++}, 'Abzug', 1000, 'Psch.', ${a.net}, 0, ${a.net}, ${a.von})`;
    await sql`update invoices set status = 'final', number = ${`KU-${++nummer}`}, locked_at = now()
      ${row!.kind === "rechnung" ? sql`` : sql`, reduction_rule = 'rueckgewaehr'`} where id = ${row!.id}`;
    return row!.id as string;
  }

  /** Zahlungseingang (positiv) oder Rückzahlung (negativ) über die Bank, der Rechnung zugeordnet */
  async function zahlung(invoiceId: string, datum: string, betrag: number) {
    const tag = `${datum.slice(8)}.${datum.slice(5, 7)}.${datum.slice(2, 4)}`;
    const zweck = `Zahlung ${invoiceId} ${datum} ${betrag}`;
    const euro = `${betrag < 0 ? "-" : ""}${Math.trunc(Math.abs(betrag) / 100)},${String(Math.abs(betrag) % 100).padStart(2, "0")}`;
    const csv = `"Girokonto";"DE89370400440532013000"\n\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"${tag}";"${tag}";"Gebucht";"Nordwerk";"Testfirma";"${zweck}";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${datum}-${betrag}.csv` }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${zweck}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount: betrag });
  }

  /** Rechnungskorrektur, die das Entgelt um `minderung` mindert */
  async function korrektur(originalId: string, datum: string, minderung: number) {
    const draft = await invoices.createCorrection(actor, originalId, datum);
    await invoices.updateDraft(actor, draft.id, {
      contactId,
      issueDate: datum,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 0,
      format: "zugferd",
      note: "",
      taxTreatment: "kleinunternehmer",
      lines: [{ description: "Nachlass", quantity: 1000, unit: "Psch.", unitPrice: -minderung, taxRate: 0 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`${kontenrahmen}/${versteuerung}: Kz 48 im Monat der Leistung, nicht der Rechnung oder Zahlung`, async () => {
        await firma(kontenrahmen, versteuerung);
        const inv = await rechnung();
        const csv = `"Girokonto";"DE89370400440532013000"\n\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"05.11.26";"05.11.26";"Gebucht";"Nordwerk";"Testfirma";"${inv.number}";"Eingang";"DE02100100100006820101";"800,00";"";"";""\n`;
        await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${inv.number}.csv` }, null);
        const [tx] = await sql`select id from bank_transactions where purpose = ${inv.number}`;
        await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: inv.id, amount: 80_000 });

        expect(await vat.computeVatFigures(september)).toMatchObject({ kz48: 80_000, kz48Kleinunternehmer: 80_000 });
        expect((await vat.computeVatFigures(oktober)).kz48).toBe(0);
        expect((await vat.computeVatFigures(november)).kz48).toBe(0);
        const entwurf = await vat.saveDraft(actor, september, { mode: "berechnet" });
        expect(entwurf.kz48).toBe(80_000);
        expect(new TextDecoder("latin1").decode((await vat.meinElsterUpload(entwurf.id)).bytes)).toContain("<Kz48>800</Kz48>");
      });
    }

  for (const [kontenrahmen, versteuerung] of [
    ["SKR04", "ist"],
    ["SKR03", "soll"],
  ] as const)
    it(`${kontenrahmen}/${versteuerung}: Bareinnahme und direkt gebuchte Erlöse ohne Rechnung zählen am Tag der Zahlung`, async () => {
      // Ohne Rechnung kennt Haben keinen anderen Tag (bareinnahme.ts, direkt-kategorie.ts); auch das sind Umsätze nach § 19 Abs. 1 UStG
      await firma(kontenrahmen, versteuerung);
      await cash.createCashIncome(
        actor,
        { date: "2026-10-12", amount: 20_000, text: "Markt", steuer: { behandlung: "kleinunternehmer", steuersatz: 0 } },
        "2026-11-23",
      );
      const csv = `"Girokonto";"DE89370400440532013000"\n\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"15.10.26";"15.10.26";"Gebucht";"Privatkunde";"Testfirma";"Reparatur";"Eingang";"DE02100100100006820101";"150,00";"";"";""\n`;
      await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "direkt.csv" }, null);
      const [tx] = await sql`select id from bank_transactions where purpose = 'Reparatur'`;
      await bank.allocate(actor, { kind: "kategorie", transactionId: tx!.id, amount: 15_000, kategorie: { kategorie: "erloese", steuersatz: 0 } });

      const figures = await vat.computeVatFigures(oktober);
      expect(figures).toMatchObject({ kz48: 35_000, kz48Kleinunternehmer: 35_000 });
      expect(figures.kleinunternehmerUmsaetze.map((r) => [r.type, r.base])).toEqual([
        ["direkt", 15_000],
        ["kasse", 20_000],
      ]);
    });

  it("Rechnung von vor Version 0.9 ohne festgeschriebenen Leistungstag zählt wie bei Soll nach dem Rechnungsdatum", async () => {
    // docs/umsatzsteuer.md, Leistungstag bei Soll-Versteuerung: ohne eingefrorenen Tag zählt das Rechnungsdatum
    await firma("SKR03", "ist");
    await direkt({ issue_date: "2026-11-04", service_from: "2026-10-01", service_to: "2026-10-31" }, 50_000);

    expect((await vat.computeVatFigures(oktober)).kz48Kleinunternehmer).toBe(0);
    expect((await vat.computeVatFigures(november)).kz48Kleinunternehmer).toBe(50_000);
  });

  it("Storno einer unbezahlten Rechnung zählt im Monat des Stornos, mit umgekehrtem Vorzeichen", async () => {
    await firma("SKR03", "ist");
    const original = await direkt({ issue_date: "2026-09-10", service_date: "2026-09-10" }, 50_000);
    await direkt({ kind: "storno", corrects_id: original, issue_date: "2026-11-02" }, -50_000);

    expect((await vat.computeVatFigures(september)).kz48).toBe(50_000);
    expect((await vat.computeVatFigures(november)).kz48Kleinunternehmer).toBe(-50_000);
  });

  /*
   * Schon bezahltes Entgelt mindern Storno und Korrektur erst mit der Rückzahlung, wie in Kz 81 und 86 (#1228; UStAE 17.1
   * Abs. 2 Satz 3 und Abs. 8 Satz 5). So gilt für Kz 43 und 48 eine Regel (Tristan in #1745)
   */
  for (const [kontenrahmen, versteuerung] of [
    ["SKR04", "ist"],
    ["SKR03", "soll"],
  ] as const)
    it(`${kontenrahmen}/${versteuerung}: Storno einer bezahlten Rechnung mindert Kz 48 erst mit der Rückzahlung, je Rate`, async () => {
      await firma(kontenrahmen, versteuerung);
      const inv = await rechnung();
      await zahlung(inv.id, "2026-10-20", 80_000);
      const storno = await invoices.cancelInvoice(actor, inv.id, "2026-11-10");

      expect((await vat.computeVatFigures(september)).kz48).toBe(80_000);
      expect(await vat.computeVatFigures(november)).toMatchObject({ kz48: 0, kz48Kleinunternehmer: 0 });
      await zahlung(storno.id, "2026-12-03", -30_000);
      expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz48: -30_000, kz48Kleinunternehmer: -30_000 });
      await zahlung(storno.id, "2027-01-14", -50_000);
      expect(await vat.computeVatFigures({ year: 2027, month: 1 })).toMatchObject({ kz48: -50_000, kz48Kleinunternehmer: -50_000 });
      expect((await vat.computeVatFigures(november)).kz48).toBe(0);
    });

  it("SKR03/ist: Korrektur einer teils bezahlten Rechnung mindert sofort nur den unbezahlten Teil, den Rest mit der Rückzahlung", async () => {
    await firma("SKR03", "ist");
    const inv = await rechnung();
    await zahlung(inv.id, "2026-10-20", 75_000);
    // 750 € bezahlt, Entgelt jetzt 700 €: 50 € Überzahlung warten auf die Rückzahlung
    const k = await korrektur(inv.id, "2026-11-10", 10_000);

    expect(await vat.computeVatFigures(november)).toMatchObject({ kz48: -5_000, kz48Kleinunternehmer: -5_000 });
    await zahlung(k.id, "2026-12-03", -5_000);
    expect((await vat.computeVatFigures({ year: 2026, month: 12 })).kz48).toBe(-5_000);
  });

  it("SKR04/soll: Korrektur einer bezahlten Rechnung mindert Kz 48 bis zur Rückzahlung nicht", async () => {
    // Verrechnung ohne Zahlung ist keine Rückzahlung (#1228)
    await firma("SKR04", "soll");
    const inv = await rechnung();
    await zahlung(inv.id, "2026-10-20", 80_000);
    await korrektur(inv.id, "2026-11-10", 10_000);

    const figures = await vat.computeVatFigures(november);
    expect(figures).toMatchObject({ kz48: 0, kz48Kleinunternehmer: 0 });
    // Die Liste unter Kz 48 nennt die Korrektur und den bis zur Rückzahlung gehaltenen Betrag
    expect(figures.kleinunternehmerUmsaetze.map((r) => r.base).sort((a, b) => a - b)).toEqual([-10_000, 10_000]);
  });

  it("Anzahlung zählt nicht, die Schlussrechnung mit der ganzen Leistung im Monat der Leistung", async () => {
    await firma("SKR04", "soll");
    const anzahlung = await direkt({ variant: "abschlag", advance_type: "anzahlung", issue_date: "2026-09-05" }, 30_000);
    await direkt({ variant: "schluss", issue_date: "2026-11-04", service_from: "2026-10-01", service_to: "2026-10-31", service_date: "2026-10-31" }, 70_000, [
      { von: anzahlung, net: -30_000 },
    ]);

    expect((await vat.computeVatFigures(september)).kz48).toBe(0);
    expect(await vat.computeVatFigures(oktober)).toMatchObject({ kz48: 100_000, kz48Kleinunternehmer: 100_000 });
    expect((await vat.computeVatFigures(november)).kz48).toBe(0);
  });

  it("Storno der Korrektur einer Anzahlung zählt nicht", async () => {
    // cancelInvoice storniert jede Korrektur für sich: Das Storno verweist auf die Korrektur, nicht auf die Anzahlung
    await firma("SKR03", "ist");
    const anzahlung = await direkt({ variant: "abschlag", advance_type: "anzahlung", issue_date: "2026-09-05" }, 30_000);
    const korrektur = await direkt({ kind: "korrektur", corrects_id: anzahlung, issue_date: "2026-10-02" }, -5_000);
    await direkt({ kind: "storno", corrects_id: anzahlung, issue_date: "2026-11-03" }, -30_000);
    await direkt({ kind: "storno", corrects_id: korrektur, issue_date: "2026-11-03" }, 5_000);

    expect((await vat.computeVatFigures(oktober)).kz48).toBe(0);
    expect((await vat.computeVatFigures(november)).kz48).toBe(0);
  });

  it("Teilleistung zählt im eigenen Monat, die Schlussrechnung nur mit dem Rest", async () => {
    await firma("SKR03", "soll");
    const teil = await direkt(
      { variant: "abschlag", advance_type: "teilleistung", issue_date: "2026-09-20", service_to: "2026-09-15", service_date: "2026-09-15" },
      30_000,
    );
    await direkt({ variant: "schluss", issue_date: "2026-10-28", service_date: "2026-10-28" }, 70_000, [{ von: teil, net: -30_000 }]);

    expect((await vat.computeVatFigures(september)).kz48).toBe(30_000);
    expect((await vat.computeVatFigures(oktober)).kz48).toBe(70_000);
  });

  for (const [kontenrahmen, versteuerung] of [
    ["SKR04", "ist"],
    ["SKR03", "soll"],
  ] as const)
    it(`${kontenrahmen}/${versteuerung}: Skonto mindert die Umsätze als Kleinunternehmer im Monat der Ausbuchung`, async () => {
      // Anleitung zur UStVA 2026, Allgemein: „Bitte berücksichtigen Sie Entgelterhöhungen und Entgeltminderungen bei den
      // Bemessungsgrundlagen.“ Wie Storno und Korrektur (§ 17 UStG) im Monat der Minderung
      await firma(kontenrahmen, versteuerung);
      const inv = await rechnung();
      const csv = `"Girokonto";"DE89370400440532013000"\n\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"05.11.26";"05.11.26";"Gebucht";"Nordwerk";"Testfirma";"${inv.number}";"Eingang";"DE02100100100006820101";"784,00";"";"";""\n`;
      await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${inv.number}.csv` }, null);
      const [tx] = await sql`select id from bank_transactions where purpose = ${inv.number}`;
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: inv.id, amount: 78_400 });
      await bank.writeOff(actor, { kind: "skonto", invoiceId: inv.id, date: "2026-11-05" });

      expect((await vat.computeVatFigures(september)).kz48).toBe(80_000);
      expect(await vat.computeVatFigures(november)).toMatchObject({ kz48: -1_600, kz48Kleinunternehmer: -1_600 });
    });

  it("Vor 2025 stehen die Umsätze als Kleinunternehmer nicht in Kz 48", async () => {
    // Erst seit 2025 sind sie steuerfrei: Kz 48 der UStVA 2024 nennt nur § 4 Nr. 8 bis 29, die der UStVA 2025 auch § 19
    // Abs. 1 (ERiC 44.3.6.0, UStVA-2024.xsd und UStVA-2025.xsd, Element Kz48)
    await firma("SKR03", "soll");
    const vorjahr = await direkt({ issue_date: "2024-12-10", service_date: "2024-12-10" }, 50_000);
    await direkt({ issue_date: "2025-01-10", service_date: "2025-01-10" }, 40_000);
    // Das Storno im Januar 2025 mindert einen Umsatz von 2024, der nicht in Kz 48 stand
    await direkt({ kind: "storno", corrects_id: vorjahr, issue_date: "2025-01-20" }, -50_000);

    expect(await vat.computeVatFigures({ year: 2024, month: 12 })).toMatchObject({ kz48: 0, kz48Kleinunternehmer: 0, kleinunternehmerUmsaetze: [] });
    expect(await vat.computeVatFigures({ year: 2025, month: 1 })).toMatchObject({ kz48: 40_000, kz48Kleinunternehmer: 40_000 });
  });

  it("SKR04/ist: Storno samt Korrektur einer bezahlten Rechnung über den Jahreswechsel, Rückzahlung im Folgejahr", async () => {
    await firma("SKR04", "ist");
    const inv = await rechnung();
    await zahlung(inv.id, "2026-10-20", 80_000);
    await korrektur(inv.id, "2026-12-10", 10_000);
    const storno = await invoices.cancelInvoice(actor, inv.id, "2027-01-05");

    expect((await vat.computeVatFigures({ year: 2026, month: 12 })).kz48).toBe(0);
    expect((await vat.computeVatFigures({ year: 2027, month: 1 })).kz48).toBe(0);
    await zahlung(storno.id, "2027-02-03", -80_000);
    expect((await vat.computeVatFigures({ year: 2027, month: 2 })).kz48).toBe(-80_000);
    expect((await vat.computeVatFigures({ year: 2027, month: 41 })).kz48).toBe(-80_000);
  });

  it("GmbH: Storno einer bezahlten Schlussrechnung (Verfahren deferred, #750) hält das Bezahlte wie bei Einzelunternehmen", async () => {
    await firma("SKR04", "soll");
    await sql`update company set rechtsform = 'gmbh' where id = 1`;
    const anzahlung = await direkt({ variant: "abschlag", advance_type: "anzahlung", advance_accounting: "deferred", issue_date: "2026-09-05" }, 30_000);
    const schluss = await direkt({ variant: "schluss", advance_accounting: "deferred", issue_date: "2026-11-04", service_date: "2026-10-31" }, 70_000, [
      { von: anzahlung, net: -30_000 },
    ]);
    await zahlung(schluss, "2026-11-06", 70_000);
    // Storno der Schlussrechnung im November; die 700 € darauf sind nicht zurückgezahlt
    await direkt({ kind: "storno", corrects_id: schluss, advance_accounting: "deferred", issue_date: "2026-11-20" }, -70_000, [
      { von: anzahlung, net: 30_000 },
    ]);

    // Unbezahlt ist nur die Anzahlung (300 €): Nur sie mindert sofort, die 700 € erst mit der Rückzahlung
    expect((await vat.computeVatFigures(november)).kz48).toBe(-30_000);
  });

  /*
   * Die Schlussrechnung zählt mit der abgezogenen Anzahlung, ihr Storno ebenso. Die bezahlte Anzahlung hält Kz 48 bis zur
   * Rückzahlung oder bis zum Leistungsmonat einer neuen Schlussrechnung, die sie wieder abzieht (Entscheidung in #1745)
   */
  for (const [kontenrahmen, versteuerung] of [
    ["SKR04", "ist"],
    ["SKR03", "soll"],
  ] as const) {
    it(`${kontenrahmen}/${versteuerung}: Storno einer Schlussrechnung mit bezahlter Anzahlung mindert Kz 48 erst mit der Rückzahlung`, async () => {
      await firma(kontenrahmen, versteuerung);
      const anzahlung = await direkt({ variant: "abschlag", advance_type: "anzahlung", issue_date: "2026-09-05" }, 30_000);
      await zahlung(anzahlung, "2026-09-10", 30_000);
      const schluss = await direkt({ variant: "schluss", issue_date: "2026-11-04", service_date: "2026-10-31" }, 70_000, [{ von: anzahlung, net: -30_000 }]);
      await zahlung(schluss, "2026-11-06", 70_000);
      await direkt({ kind: "storno", corrects_id: schluss, issue_date: "2026-11-20" }, -70_000, [{ von: anzahlung, net: 30_000 }]);

      expect((await vat.computeVatFigures(oktober)).kz48).toBe(100_000);
      // 1.000 € bezahlt (300 € Anzahlung, 700 € Rest), nichts zurückgezahlt
      expect((await vat.computeVatFigures(november)).kz48).toBe(0);
      // Zurückgezahlt wird eine Anzahlung über ihr Storno
      const anzahlungStorno = await direkt({ kind: "storno", corrects_id: anzahlung, issue_date: "2026-12-02" }, -30_000);
      await zahlung(anzahlungStorno, "2026-12-03", -30_000);
      expect((await vat.computeVatFigures({ year: 2026, month: 12 })).kz48).toBe(-30_000);
      expect((await vat.computeVatFigures(november)).kz48).toBe(0);
    });

    it(`${kontenrahmen}/${versteuerung}: Neue Schlussrechnung mit derselben Anzahlung beendet das Festhalten im Monat ihrer Leistung`, async () => {
      await firma(kontenrahmen, versteuerung);
      const monat = (year: number, month: number) => vat.computeVatFigures({ year, month }).then((f) => f.kz48);
      const anzahlung = await direkt({ variant: "abschlag", advance_type: "anzahlung", issue_date: "2026-09-05" }, 30_000);
      await zahlung(anzahlung, "2026-09-10", 30_000);
      const alt = await direkt({ variant: "schluss", issue_date: "2026-11-04", service_date: "2026-10-31" }, 70_000, [{ von: anzahlung, net: -30_000 }]);
      await zahlung(alt, "2026-11-06", 70_000);
      const altStorno = await direkt({ kind: "storno", corrects_id: alt, issue_date: "2026-11-20" }, -70_000, [{ von: anzahlung, net: 30_000 }]);
      const neu = await direkt({ variant: "schluss", issue_date: "2026-12-10", service_date: "2026-12-08" }, 70_000, [{ von: anzahlung, net: -30_000 }]);

      expect(await monat(2026, 11)).toBe(0);
      // Neue Schlussrechnung 1.000 €; die festgehaltenen 300 € Anzahlung enden in ihrem Leistungsmonat
      expect(await monat(2026, 12)).toBe(70_000);
      // Der Auftrag fällt ganz weg: Jetzt hält das Storno der neuen Schlussrechnung die Anzahlung, nicht das alte
      await direkt({ kind: "storno", corrects_id: neu, issue_date: "2027-01-15" }, -70_000, [{ von: anzahlung, net: 30_000 }]);
      expect(await monat(2027, 1)).toBe(-70_000);
      const anzahlungStorno = await direkt({ kind: "storno", corrects_id: anzahlung, issue_date: "2027-02-02" }, -30_000);
      await zahlung(anzahlungStorno, "2027-02-05", -30_000);
      expect(await monat(2027, 2)).toBe(-30_000);
      await zahlung(altStorno, "2027-03-04", -70_000);
      expect(await monat(2027, 3)).toBe(-70_000);
      // Alles zurückgezahlt: über alle Monate nichts doppelt
      let summe = 0;
      for (const [year, month] of [
        [2026, 10],
        [2026, 11],
        [2026, 12],
        [2027, 1],
        [2027, 2],
        [2027, 3],
      ] as const)
        summe += await monat(year, month);
      expect(summe).toBe(0);
    });
  }

  /*
   * GmbH und UG (Verfahren deferred, #750): Der Ersatz einer stornierten Schlussrechnung übernimmt deren Zahlungen, das
   * Papierstorno eröffnet keine Erstattung (docs/rechnungen.md, „Schlussrechnung bei GmbH und UG ersetzen“). Das Bezahlte
   * hält Kz 48 deshalb nur bis zum Leistungstag des Ersatzes, wie die Anzahlung bei einer neuen Schlussrechnung
   */
  for (const [kontenrahmen, versteuerung] of [
    ["SKR04", "ist"],
    ["SKR03", "soll"],
  ] as const)
    it(`${kontenrahmen}/${versteuerung}: GmbH: Ersatz einer bezahlten, stornierten Schlussrechnung zählt die Leistung in Kz 48 einmal`, async () => {
      await firma(kontenrahmen, versteuerung);
      await sql`update company set rechtsform = 'gmbh' where id = 1`;
      const festschreiben = async (werte: Partial<Parameters<typeof invoices.createDraft>[1]>, betrag: number) => {
        const draft = await invoices.createDraft(actor, {
          contactId,
          issueDate: "2026-09-05",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          taxTreatment: "kleinunternehmer",
          lines: [{ description: "Webdesign", quantity: 1000, unit: "Psch.", unitPrice: betrag, taxRate: 0 }],
          ...werte,
        });
        return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
      };
      const leistung = { serviceFrom: "2026-10-01", serviceTo: "2026-10-31", variant: "schluss" } as const;
      const anzahlung = await festschreiben({ variant: "abschlag", advanceType: "anzahlung" }, 30_000);
      await zahlung(anzahlung.id, "2026-09-10", 30_000);
      const alt = await festschreiben({ ...leistung, issueDate: "2026-11-04", deducts: [anzahlung.id] }, 100_000);
      await zahlung(alt.id, "2026-11-06", 70_000);
      await invoices.cancelInvoice(actor, alt.id, "2026-11-20");
      const ersatz = await festschreiben({ ...leistung, issueDate: "2026-11-21", deducts: [anzahlung.id] }, 100_000);
      expect(ersatz).toMatchObject({ advanceAccounting: "deferred", replacesInvoiceId: alt.id });

      // Alte Schlussrechnung und Ersatz je 1.000 € im Monat der Leistung, das Papierstorno mindert im November
      expect((await vat.computeVatFigures(oktober)).kz48).toBe(200_000);
      expect((await vat.computeVatFigures(november)).kz48).toBe(-100_000);
    });

  it("Gesendete Voranmeldung von vor #1268 meldet keine Abweichung, ein anderer Wert schon", async () => {
    await firma("SKR03", "soll");
    await rechnung();
    const entwurf = await vat.saveDraft(actor, september, { mode: "berechnet" });
    // So steht eine früher gesendete Anmeldung da: Kz 48 ohne die Umsätze als Kleinunternehmer, ohne Zuordnung (#1811)
    await sql`update vat_returns set kz48 = 0, small_business_rule = null, status = 'sent', sent_at = now() where id = ${entwurf.id}`;
    expect(await vat.gesendeteAbweichungen([2026])).toEqual([]);

    await sql`update vat_returns set kz48 = 12300 where id = ${entwurf.id}`;
    expect(await vat.gesendeteAbweichungen([2026])).toEqual([{ period: september, feld: "Kz 48", gesendet: 12_300, journal: 80_000 }]);
  });

  // #1811: Kz 48 ohne die Umsätze als Kleinunternehmer gilt nur bei Anmeldungen als gleich, deren berechnete Werte vor
  // #1268 entstanden sind. Danach gespeicherte melden jede spätere Änderung, auch auf den Wert ohne diese Umsätze.
  const senden = (id: string) => sql`update vat_returns set status = 'sent', sent_at = clock_timestamp() where id = ${id}`;
  const nachher = { period: september, feld: "Kz 48", gesendet: 0, journal: 80_000 };

  for (const [kontenrahmen, versteuerung] of [
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)
    it(`${kontenrahmen}/${versteuerung}: Nach dem Update gesendet, fällt eine spätere Rechnung für den Monat auf (#1811)`, async () => {
      await firma(kontenrahmen, versteuerung);
      const entwurf = await vat.saveDraft(actor, september, { mode: "berechnet" });
      expect(entwurf).toMatchObject({ kz48: 0, smallBusinessRule: "leistung" });
      await senden(entwurf.id);
      await rechnung();
      expect(await vat.gesendeteAbweichungen([2026])).toEqual([nachher]);
    });

  it("Die Datenbank nimmt in small_business_rule nur „leistung“ oder nichts (#1811)", async () => {
    await firma("SKR03", "ist");
    const entwurf = await vat.saveDraft(actor, september, { mode: "berechnet" });
    await expect(sql`update vat_returns set small_business_rule = 'zahlung' where id = ${entwurf.id}`).rejects.toThrow(/vat_returns_small_business_rule/);
  });

  it("SKR04/ist: Von Hand überschrieben, zählen die beim Speichern berechneten Werte samt Umsätzen als Kleinunternehmer (#1811)", async () => {
    await firma("SKR04", "ist");
    const entwurf = await vat.saveDraft(actor, september, { mode: "manuell", reason: "Werte aus der alten Buchhaltung", kz81: 0, kz86: 0, kz66: 0 });
    expect(entwurf.smallBusinessRule).toBe("leistung");
    await senden(entwurf.id);
    await rechnung();
    expect(await vat.gesendeteAbweichungen([2026])).toEqual([nachher]);
  });

  it("SKR03/soll: Die Berichtigung übernimmt mit den berechneten Werten deren Zuordnung (#1811)", async () => {
    await firma("SKR03", "soll");
    const erste = await vat.saveDraft(actor, september, { mode: "manuell", reason: "Werte aus der alten Buchhaltung", kz81: 0, kz86: 0, kz66: 0 });
    await senden(erste.id);
    const berichtigung = await vat.createCorrection(actor, september);
    expect(berichtigung.smallBusinessRule).toBe("leistung");
    await senden(berichtigung.id);
    await rechnung();
    expect(await vat.gesendeteAbweichungen([2026])).toEqual([nachher]);

    // Eine Anmeldung von vor #1268 berichtigt, bleiben deren berechnete Werte und mit ihnen die Ausnahme
    await sql`update vat_returns set small_business_rule = null where id = ${berichtigung.id}`;
    const zweite = await vat.createCorrection(actor, september);
    expect(zweite.smallBusinessRule).toBeNull();
    await senden(zweite.id);
    expect(await vat.gesendeteAbweichungen([2026])).toEqual([]);
  });
});
