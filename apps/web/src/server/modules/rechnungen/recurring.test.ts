import type { Recurrence } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

describe.skipIf(!testDatabaseUrl)("Wiederkehrende Rechnungen (Postgres)", () => {
  let recurring: typeof import("./recurring.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    recurring = await import("./recurring.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, invoice_lines, invoices, recurring_invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "rechnung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  const template = (overrides: Partial<import("./recurring.ts").RecurringInput> = {}) => ({
    name: "Wartung Nordwerk",
    active: true,
    contactId,
    format: "zugferd" as const,
    paymentTermDays: 14,
    note: "Abrechnung {zeitraum}",
    taxTreatment: "regulaer" as const,
    exemptionReason: "",
    lines: [{ description: "Wartung {monat} {jahr}", quantity: 1000, unit: "Psch." as const, unitPrice: 50_000, taxRate: 1900 as const }],
    recurrence: "P1M" as Recurrence,
    nextDate: "2026-08-31",
    endDate: null,
    servicePeriod: "laufend" as const,
    mode: "entwurf" as const,
    ...overrides,
  });

  it("übernimmt die Einleitung mit Platzhaltern in die Rechnung", async () => {
    await recurring.createRecurring(actor, template({ intro: "Leistungen {zeitraum} gemäß Wartungsvertrag", nextDate: "2026-09-30", endDate: "2026-09-30" }));
    await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand);
    const rows = await sql`select intro, note from invoices`;
    expect(rows.map((r) => ({ ...r }))).toEqual([{ intro: "Leistungen September 2026 gemäß Wartungsvertrag", note: "Abrechnung September 2026" }]);
  });

  it("übernimmt den gewählten Aufbewahrungshinweis aus der Vorlage in jeden Lauf und lässt ihn wieder ausschalten", async () => {
    const input = template({ ...{ propertyRetention: true }, nextDate: "2026-09-30", endDate: "2026-10-30" });
    const created = await recurring.createRecurring(actor, input);
    expect(created).toMatchObject({ propertyRetention: true });
    expect((await recurring.runDueRecurring("2026-09-30", kleinunternehmerStand)).created).toBe(1);
    const disabled = { ...input, propertyRetention: false, nextDate: "2026-10-30" };
    await recurring.updateRecurring(actor, created.id, disabled);
    expect((await recurring.runDueRecurring("2026-10-30", kleinunternehmerStand)).created).toBe(1);
    const rows = await sql`select property_retention from invoices order by issue_date`;
    expect(rows.map((row) => row.property_retention)).toEqual([true, false]);
  });

  it("übernimmt den Text zur Position mit Platzhaltern in die Rechnung", async () => {
    const lines = [{ ...template().lines[0]!, detail: "Leistungszeitraum {zeitraum}\nlaut Wartungsvertrag" }];
    await recurring.createRecurring(actor, template({ lines, nextDate: "2026-09-30", endDate: "2026-09-30" }));
    await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand);
    const rows = await sql`select description, detail from invoice_lines`;
    expect(rows.map((r) => ({ ...r }))).toEqual([{ description: "Wartung September 2026", detail: "Leistungszeitraum September 2026\nlaut Wartungsvertrag" }]);
  });

  it("Vorlagen von vor dem Text zur Position erzeugen Positionen ohne Text", async () => {
    const created = await recurring.createRecurring(actor, template({ nextDate: "2026-09-30", endDate: "2026-09-30" }));
    await sql`update recurring_invoices set lines = jsonb_build_array((lines -> 0) - 'detail') where id = ${created.id}`;
    await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand);
    const [line] = await sql`select detail from invoice_lines`;
    expect(line?.detail).toBe("");
  });

  it("holt verpasste Termine als Entwürfe nach, mit Platzhaltern und Leistungszeitraum", async () => {
    const created = await recurring.createRecurring(actor, template());
    expect(await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand)).toEqual({ created: 2, finalized: 0, mailed: 0, errors: [] });
    const rows = await sql`select i.issue_date::text, i.service_from::text, i.service_to::text, i.status, i.note, l.description
      from invoices i join invoice_lines l on l.invoice_id = i.id order by i.issue_date`;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      {
        issue_date: "2026-08-31",
        service_from: "2026-08-01",
        service_to: "2026-08-31",
        status: "draft",
        note: "Abrechnung August 2026",
        description: "Wartung August 2026",
      },
      {
        issue_date: "2026-09-30",
        service_from: "2026-09-01",
        service_to: "2026-09-30",
        status: "draft",
        note: "Abrechnung September 2026",
        description: "Wartung September 2026",
      },
    ]);
    const [after] = await sql`select next_date::text, active from recurring_invoices where id = ${created.id}`;
    expect(after).toEqual({ next_date: "2026-10-31", active: true });
    // Ein zweiter Lauf am selben Tag legt nichts doppelt an
    expect((await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand)).created).toBe(0);
  });

  it("wöchentlich: Termine über den Jahreswechsel, Leistungszeitraum je Woche (#1691)", async () => {
    const created = await recurring.createRecurring(actor, template({ recurrence: "P1W", nextDate: "2026-12-21" }));
    expect(created).toMatchObject({ recurrence: "P1W" });
    expect((await recurring.runDueRecurring("2027-01-05", kleinunternehmerStand)).created).toBe(3);
    const rows = await sql`select issue_date, service_from, service_to, note from invoices order by issue_date`;
    expect(rows.map((r) => [r.issue_date, r.service_from, r.service_to, r.note])).toEqual([
      ["2026-12-21", "2026-12-21", "2026-12-27", "Abrechnung 21.12.2026 – 27.12.2026"],
      ["2026-12-28", "2026-12-28", "2027-01-03", "Abrechnung 28.12.2026 – 03.01.2027"],
      ["2027-01-04", "2027-01-04", "2027-01-10", "Abrechnung 04.01.2027 – 10.01.2027"],
    ]);
    const [next] = await sql`select next_date from recurring_invoices where id = ${created.id}`;
    expect(next!.next_date).toBe("2027-01-11");
  });

  it("alle 2 Wochen, vergangener Zeitraum; Wechsel auf Monate; unbekannte Intervalle abgelehnt", async () => {
    const input = template({ recurrence: "P2W", nextDate: "2026-11-23", servicePeriod: "vorher" });
    const created = await recurring.createRecurring(actor, input);
    expect((await recurring.runDueRecurring("2026-12-07", kleinunternehmerStand)).created).toBe(2);
    const rows = await sql`select issue_date, service_from, service_to from invoices order by issue_date`;
    expect(rows.map((r) => [r.issue_date, r.service_from, r.service_to])).toEqual([
      ["2026-11-23", "2026-11-09", "2026-11-22"],
      ["2026-12-07", "2026-11-23", "2026-12-06"],
    ]);
    const monthly = await recurring.updateRecurring(actor, created.id, { ...input, recurrence: "P1M", nextDate: "2026-12-21" });
    expect(monthly).toMatchObject({ recurrence: "P1M" });
    await expect(recurring.updateRecurring(actor, created.id, { ...input, recurrence: "P3W" as Recurrence })).rejects.toThrow("Intervall nicht unterstützt.");
    await expect(recurring.createRecurring(actor, template({ recurrence: "P12M" as Recurrence }))).rejects.toThrow("Intervall nicht unterstützt.");
  });

  it("Wechsel von Wochen auf Monate nimmt den Ankertag vom nächsten Termin, auch wenn er unverändert bleibt", async () => {
    const input = template({ recurrence: "P2W", nextDate: "2026-11-23" });
    const created = await recurring.createRecurring(actor, input);
    await recurring.runDueRecurring("2026-11-23", kleinunternehmerStand);
    const [after] = await sql`select next_date from recurring_invoices where id = ${created.id}`;
    expect(after!.next_date).toBe("2026-12-07");
    const monthly = await recurring.updateRecurring(actor, created.id, { ...input, recurrence: "P1M", nextDate: "2026-12-07" });
    expect(monthly.anchorDay).toBe(7);
  });

  it("schreibt fest und endet nach dem Enddatum", async () => {
    const created = await recurring.createRecurring(actor, template({ mode: "festschreiben", nextDate: "2026-09-01", endDate: "2026-10-15" }));
    expect(await recurring.runDueRecurring("2026-12-01", kleinunternehmerStand)).toEqual({ created: 2, finalized: 2, mailed: 0, errors: [] });
    const numbers = await sql`select number from invoices where status = 'final' order by number`;
    expect(numbers.map((r) => r.number)).toEqual(["2026-001", "2026-002"]);
    const [after] = await sql`select active from recurring_invoices where id = ${created.id}`;
    expect(after?.active).toBe(false);
  });

  it("lässt den Entwurf stehen, wenn das Festschreiben scheitert", async () => {
    await sql`update company set iban = ''`;
    const created = await recurring.createRecurring(actor, template({ mode: "festschreiben", nextDate: "2026-10-01" }));
    const result = await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand);
    expect(result).toMatchObject({ created: 1, finalized: 0 });
    expect(result.errors[0]).toContain("IBAN fehlt");
    const [row] = await sql`select status from invoices`;
    expect(row?.status).toBe("draft");
    const [after] = await sql`select last_error, next_date::text from recurring_invoices where id = ${created.id}`;
    expect(after).toMatchObject({ next_date: "2026-11-01" });
    expect(after?.last_error).toContain("als Entwurf angelegt");
  });

  it("ein unerwarteter Fehler einer Vorlage hält die übrigen nicht auf", async () => {
    const broken = await recurring.createRecurring(actor, template({ name: "Kaputt", nextDate: "2026-10-01" }));
    // Betrag jenseits von int4: das Anlegen scheitert in Postgres
    await sql`update recurring_invoices set lines = jsonb_set(lines, '{0,unitPrice}', '100000000000') where id = ${broken.id}`;
    await recurring.createRecurring(actor, template({ name: "Heil", nextDate: "2026-10-01" }));
    const result = await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand);
    expect(result.created).toBe(1);
    // „Interner Fehler“ mit der Fehler-ID der Zeile im Log, damit der Betreiber sie findet (#1860)
    const intern = /^Interner Fehler \(Fehler-ID [0-9a-f]{8}\)\. Details stehen im Server-Log\.$/;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.replace(/^Kaputt: /, "")).toMatch(intern);
    const [after] = await sql`select last_error, next_date::text from recurring_invoices where id = ${broken.id}`;
    expect(after).toMatchObject({ next_date: "2026-10-01" });
    expect(after?.last_error).toBe(result.errors[0]!.replace(/^Kaputt: /, ""));
  });

  it("zwei gleichzeitige Läufe legen jeden Termin nur einmal an", async () => {
    await recurring.createRecurring(actor, template());
    const [a, b] = await Promise.all([
      recurring.runDueRecurring("2026-10-02", kleinunternehmerStand),
      recurring.runDueRecurring("2026-10-02", kleinunternehmerStand),
    ]);
    expect(a.errors.concat(b.errors)).toEqual([]);
    const [count] = await sql`select count(*)::int as n from invoices`;
    expect(count?.n).toBe(2);
  });

  it("Vorlage mit Rechnungen lässt sich nicht löschen", async () => {
    const created = await recurring.createRecurring(actor, template({ nextDate: "2026-10-01" }));
    await recurring.runDueRecurring("2026-10-02", kleinunternehmerStand);
    await expect(recurring.deleteRecurring(actor, created.id)).rejects.toThrow("Deaktiviere");
    const unused = await recurring.createRecurring(actor, template({ nextDate: "2027-01-01" }));
    await recurring.deleteRecurring(actor, unused.id);
  });
});
