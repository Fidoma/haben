import { buildEInvoice, type IncomingInvoice } from "@haben/einvoice";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleDocument } from "../../../../../../packages/einvoice/src/samples.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { cancellationMismatch } from "./fremdstorno-pruefung.ts";

/*
 * Storno einer aus dem Fremdsystem übernommenen Rechnung (#1900): Rechnung 2026-034 und Storno 2026-035 kommen als
 * ZUGFeRD aus einem anderen Programm, das Storno nennt die Rechnung in BT-25. Haben bucht das Storno zum Datum der
 * Gutschrift; danach steht nichts mehr offen. SKR03 und SKR04, Ist und Soll.
 */
const rechnung = { number: "2026-034", issueDate: "2026-10-02", taxes: [{ rate: 1900, base: 1_462_990, tax: 277_968 }] };

describe("Storno aus dem Fremdsystem prüfen", () => {
  const xml = (over: Partial<IncomingInvoice> = {}) =>
    ({
      isCreditNote: true,
      currency: "EUR",
      number: "2026-035",
      issueDate: "2026-10-02",
      precedingInvoices: [{ number: "2026-034" }],
      taxes: [{ rate: 1900, category: "S", base: -1_462_990, tax: -277_968 }],
      gross: -1_740_958,
      ...over,
    }) as IncomingInvoice;
  const input = { number: "2026-035", issueDate: "2026-10-02" };

  it("nimmt das volle Storno als Gutschrift oder als Rechnung mit negativem Betrag", () => {
    expect(cancellationMismatch(xml(), rechnung, input)).toBeNull();
    expect(cancellationMismatch(xml({ isCreditNote: false }), rechnung, input)).toBeNull();
  });

  it("lehnt Teilbeträge, fehlenden Bezug, Fremdwährung und abweichende Angaben ab", () => {
    expect(cancellationMismatch(xml({ taxes: [{ rate: 1900, category: "S", base: -100_000, tax: -19_000 }] }), rechnung, input)).toMatch(
      /nicht genau auf .*nur das volle Storno/,
    );
    expect(cancellationMismatch(xml({ precedingInvoices: [{ number: "2026-033" }] }), rechnung, input)).toMatch(/nennt die Rechnung 2026-034 nicht/);
    expect(cancellationMismatch(xml({ precedingInvoices: undefined }), rechnung, input)).toMatch(/BT-25/);
    expect(cancellationMismatch(xml({ currency: "USD" }), rechnung, input)).toMatch(/USD/);
    expect(cancellationMismatch(xml({ number: "2026-036" }), rechnung, input)).toMatch(/Nummer 2026-036/);
    expect(cancellationMismatch(xml({ isCreditNote: false, gross: 1_740_958 }), rechnung, input)).toMatch(/keine Gutschrift/);
    // BT-26: nennt die Datei ein Datum der Rechnung, muss es stimmen; ohne Datum genügt die Nummer
    expect(cancellationMismatch(xml({ precedingInvoices: [{ number: "2026-034", issueDate: "2026-09-30" }] }), rechnung, input)).toMatch(/BT-26/);
    expect(cancellationMismatch(xml({ precedingInvoices: [{ number: "2026-034", issueDate: "2026-10-02" }] }), rechnung, input)).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)("Storno aus dem Fremdsystem übernehmen (Postgres)", () => {
  let foreign: typeof import("./fremdrechnung.ts");
  let storno: typeof import("./fremdstorno.ts");
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let rechnungPdf: Uint8Array;
  let stornoPdf: Uint8Array;
  let teilstornoPdf: Uint8Array;

  beforeAll(async () => {
    sql = await setupTestDb();
    foreign = await import("./fremdrechnung.ts");
    storno = await import("./fremdstorno.ts");
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    vat = await import("../umsatzsteuer/index.ts");
    rechnungPdf = (await buildEInvoice(sampleDocument())).pdf;
    // Das Beispiel-Storno nennt die Rechnung mit dem Datum aus samples.ts; hier das der Beispiel-Rechnung (BT-26)
    const stornoDoc = { ...sampleDocument({ kind: "storno" }), corrects: { number: "2026-034", issueDate: "2026-10-02" } };
    stornoPdf = (await buildEInvoice(stornoDoc)).pdf;
    teilstornoPdf = (
      await buildEInvoice({
        ...sampleDocument({ kind: "storno", lines: [{ description: "Teil", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }] }),
        corrects: stornoDoc.corrects,
      })
    ).pdf;
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
                                   payment_term_days, skonto)
      values (1, 'Erika Mustermann', 'Lindenstraße 12', '10969', 'Berlin', 'rechnung@mustermann.example', '+49 30 1234567', '13/345/67890',
              'DE123456789', 'BE', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 14, '[]'::jsonb)`;
    const { id } = await contacts.createContact(actor, kunde);
    return id;
  }

  const kunde = {
    kundennummer: "",
    name: "Musterkunde GmbH",
    strasse: "Marktplatz 3",
    plz: "93047",
    ort: "Regensburg",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
  };

  const datei = (bytes: Uint8Array, filename: string) => ({ bytes, filename, mimeType: "application/pdf" });

  /** Rechnung 2026-034 wie über „Ausgangsrechnung hochladen“ übernehmen */
  async function rechnungUebernehmen(contactId: string) {
    const proposal = await foreign.foreignInvoiceProposal(datei(rechnungPdf, "2026-034.pdf"));
    return foreign.adoptForeignInvoiceFile(actor, { ...proposal, contactId }, datei(rechnungPdf, "2026-034.pdf"), kleinunternehmerStand);
  }

  async function stornoUebernehmen() {
    const proposal = await foreign.foreignInvoiceProposal(datei(stornoPdf, "2026-035.pdf"));
    expect(proposal.warnings).toEqual([]);
    expect(proposal.cancels).toMatchObject({ number: "2026-034", issueDate: "2026-10-02", gross: 1_740_958, problem: null });
    return storno.adoptForeignCancellationFile(
      actor,
      { invoiceId: proposal.cancels!.invoiceId, number: proposal.number, issueDate: proposal.issueDate },
      datei(stornoPdf, "2026-035.pdf"),
    );
  }

  const balances = async () =>
    Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [
        r.account,
        r.saldo,
      ]),
    );

  it.each([
    ["SKR03", "soll"],
    ["SKR04", "soll"],
    ["SKR03", "ist"],
    ["SKR04", "ist"],
  ] as const)(
    "%s, %s: Storno mit Nummer und Original aus dem Fremdsystem, danach ist nichts mehr offen",
    async (kontenrahmen, versteuerung) => {
      const contactId = await company(kontenrahmen, versteuerung);
      const { id: rechnungId } = await rechnungUebernehmen(contactId);
      const { id } = await stornoUebernehmen();

      const [row] = await sql`select kind, status, number, corrects_id, external_source, external_id, issue_date::text, net, tax, gross, pdf, xml
      from invoices where id = ${id}`;
      expect(row).toMatchObject({
        kind: "storno",
        status: "final",
        number: "2026-035",
        corrects_id: rechnungId,
        external_source: "fremdsystem",
        external_id: "2026-035",
        issue_date: "2026-10-02",
        net: -1_462_990,
        tax: -277_968,
        gross: -1_740_958,
      });
      expect(Buffer.from(row!.pdf as Uint8Array).equals(Buffer.from(stornoPdf))).toBe(true);
      expect(row!.xml).toContain("2026-034");
      // Der eigene Nummernkreis bleibt unberührt
      expect(await sql`select 1 from invoice_number_counters`).toHaveLength(0);
      // Forderung, Erlös und Umsatzsteuer (bei Ist: noch nicht fällig) heben sich auf
      expect(await balances()).toEqual({});
      // Soll: die Rechnung im Monat der Leistung (September), das Storno im Monat der Gutschrift (§ 17 Abs. 1 UStG)
      const september = await vat.computeVatFigures({ year: 2026, month: 9 });
      const oktober = await vat.computeVatFigures({ year: 2026, month: 10 });
      if (versteuerung === "soll") {
        expect(september).toMatchObject({ kz81: 1_462_990, tax81: 277_968 });
        expect(oktober).toMatchObject({ kz81: -1_462_990, tax81: -277_968 });
      } else {
        // Ist: nichts gezahlt, nichts zu melden
        expect(september).toMatchObject({ kz81: 0, tax81: 0 });
        expect(oktober).toMatchObject({ kz81: 0, tax81: 0 });
      }
      // Ein zweites Mal geht nicht: Die Rechnung ist storniert
      await expect(
        storno.adoptForeignCancellationFile(actor, { invoiceId: rechnungId, number: "2026-035", issueDate: "2026-10-02" }, datei(stornoPdf, "2026-035.pdf")),
      ).rejects.toThrow(/storniert/);
    },
    60_000,
  );

  it("Käufer des Stornos ist der der Rechnung, wie beim Storno in Haben (buyerForFinalization), auch wenn der Kontakt sich seither geändert hat (Review #1993)", async () => {
    const contactId = await company("SKR03", "soll");
    const { id: rechnungId } = await rechnungUebernehmen(contactId);
    await contacts.updateContact(actor, contactId, { ...kunde, name: "Musterkunde Neu GmbH", ort: "München", plz: "80331" });
    const { id } = await storno.adoptForeignCancellationFile(
      actor,
      { invoiceId: rechnungId, number: "2026-035", issueDate: "2026-10-02" },
      datei(stornoPdf, "2026-035.pdf"),
    );
    const [rechnung] = await sql`select buyer from invoices where id = ${rechnungId}`;
    const [beleg] = await sql`select buyer from invoices where id = ${id}`;
    expect(beleg!.buyer).toEqual(rechnung!.buyer);
  }, 60_000);

  it("lehnt ab, wenn die Rechnung eine Korrektur hat, und ohne übernommene Rechnung gibt es keinen Vorschlag", async () => {
    const contactId = await company("SKR03", "soll");
    // Ohne übernommene Rechnung: kein Storno, nur der Hinweis auf die Gutschrift
    const ohne = await foreign.foreignInvoiceProposal(datei(stornoPdf, "2026-035.pdf"));
    expect(ohne.cancels).toBeNull();
    expect(ohne.warnings).toEqual(["Das ist eine Gutschrift zu 2026-034; eine solche Rechnung aus dem Fremdsystem gibt es in Haben nicht."]);

    const { id: rechnungId } = await rechnungUebernehmen(contactId);
    // Ein Teilstorno erkennt der Vorschlag, meldet aber schon beim Einlesen, dass Haben es nicht übernimmt
    const teil = await foreign.foreignInvoiceProposal(datei(teilstornoPdf, "teil.pdf"));
    expect(teil.cancels).toMatchObject({ number: "2026-034" });
    expect(teil.cancels!.problem).toMatch(/nur das volle Storno/);
    const korrektur = await invoices.createCorrection(actor, rechnungId, "2026-10-05");
    await invoices.finalizeInvoice(actor, korrektur.id, kleinunternehmerStand);
    await expect(
      storno.adoptForeignCancellationFile(actor, { invoiceId: rechnungId, number: "2026-035", issueDate: "2026-10-02" }, datei(stornoPdf, "2026-035.pdf")),
    ).rejects.toThrow(/hat eine Korrektur/);
    expect(await sql`select 1 from invoices where kind = 'storno'`).toHaveLength(0);
  }, 60_000);
});
