import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { firma, kunde } from "./test-liquiditaet.ts";

/*
 * Dauerbelege und wiederkehrende Rechnungen in der Liquiditätsvorschau (#1381) gegen Postgres: je Termin ab dem nächsten
 * bis zum Ende des Horizonts bzw. zum Enddatum, Vorsteuer nur mit ausgewiesener Steuer und ohne Privatanteil, Umsatzsteuer
 * der Rechnung bei Ist zur Fälligkeit, bei Soll im Monat der Leistung wie beim Lauf. SKR03 mit Ist, SKR04 mit Soll.
 */

describe.skipIf(!testDatabaseUrl)("Liquiditätsvorschau: Dauerbelege und wiederkehrende Rechnungen (Postgres)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("../stammdaten/contacts.ts");
  let dauerbelege: typeof import("./dauerbelege.ts");
  let wiederkehrend: typeof import("./wiederkehrend.ts");
  let kontext: typeof import("./kontext.ts");
  let vorschau: typeof import("./vorschau.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("../stammdaten/contacts.ts");
    dauerbelege = await import("./dauerbelege.ts");
    wiederkehrend = await import("./wiederkehrend.ts");
    kontext = await import("./kontext.ts");
    vorschau = await import("./vorschau.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function dauerbeleg(
    name: string,
    felder: { status?: string; payment?: string; taxShown?: boolean; privateShare?: number; category?: string; amounts: object[] } & Record<string, unknown>,
  ) {
    const [row] = await sql<{ id: string }[]>`insert into recurring_documents (name, status, supplier_name, category, payment, private_share,
        amounts, tax_shown, recurrence, anchor_day, start_date, next_date, end_date, due_days, sha256, filename, mime_type, size)
      values (${name}, ${felder.status ?? "aktiv"}, 'Vermieter', ${felder.category ?? "miete"}, ${felder.payment ?? "bank"}, ${felder.privateShare ?? 0},
              ${JSON.stringify(felder.amounts)}::jsonb, ${felder.taxShown ?? false}, ${String(felder.recurrence ?? "P1M")}, ${Number(felder.anchor ?? 1)},
              '2026-01-01', ${String(felder.next ?? "2026-12-01")}, ${(felder.end as string | undefined) ?? null}, ${Number(felder.dueDays ?? 0)},
              ${"b".repeat(64)}, 'vertrag.pdf', 'application/pdf', 1)
      returning id`;
    return row!.id;
  }

  it("Dauerbelege mit Zahlung Bank je Termin; Vorsteuer nur ausgewiesen und ohne Privatanteil; privat, Kasse und pausiert fehlen", async () => {
    await firma(sql, { kontenrahmen: "SKR03", versteuerung: "ist" });
    const miete = await dauerbeleg("Miete", {
      amounts: [{ taxRate: 1900, net: 100_000, tax: 19_000 }],
      taxShown: true,
      privateShare: 20,
      dueDays: 3,
      end: "2027-01-31",
    });
    // Monatsletzter, vierteljährlich, ohne Steuerausweis
    const abo = await dauerbeleg("Abo", { amounts: [{ taxRate: 0, net: 5_000, tax: 0 }], recurrence: "P3M", anchor: 31, next: "2026-11-30" });
    await dauerbeleg("Privat bezahlt", { amounts: [{ taxRate: 0, net: 1_000, tax: 0 }], payment: "privat" });
    await dauerbeleg("Bar", { amounts: [{ taxRate: 0, net: 1_000, tax: 0 }], payment: "kasse" });
    await dauerbeleg("Pause", { amounts: [{ taxRate: 0, net: 1_000, tax: 0 }], status: "pausiert" });

    const posten = await dauerbelege.dauerbelegPosten(await kontext.ladeKontext("2026-11-20", "13w"));
    const miet = { betrag: 119_000, richtung: "aus", text: "Miete · Vermieter", quelle: { art: "dauerbeleg", id: miete }, sicherheit: "erwartet" };
    // Nach dem nächsten Termin sortiert, wie die Liste der Dauerbelege
    expect(posten).toEqual([
      // Der nächste Termin am 28.02.2027 liegt nach den 13 Wochen
      { datum: "2026-11-30", betrag: 5_000, richtung: "aus", text: "Abo · Vermieter", quelle: { art: "dauerbeleg", id: abo }, sicherheit: "erwartet" },
      // 19 € Steuer, davon 80 % betrieblich, nach Belegdatum
      { ...miet, datum: "2026-12-04", steuer: { betrag: -15_200, datum: "2026-12-01" } },
      { ...miet, datum: "2027-01-04", steuer: { betrag: -15_200, datum: "2027-01-01" } },
    ]);
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("erwartet die Vorsteuer eines Dauerbelegs so, wie die Buchung sie abzieht (%s, %s)", async (kontenrahmen, versteuerung) => {
    await firma(sql, { kontenrahmen, versteuerung });
    const einmal = { taxShown: true, next: "2026-12-01", end: "2026-12-31" };
    // Gebucht wird je Satz der private Teil gerundet, der betriebliche ist der Rest (splitPrivateShare in documentRatePosting):
    // 10 ct zu 25 % privat sind 3 ct privat und 7 ct abziehbar, nicht 7,5 ct auf 8 gerundet
    const halb = await dauerbeleg("Halber Cent", { ...einmal, privateShare: 25, amounts: [{ taxRate: 1900, net: 53, tax: 10 }] });
    // Zwei Sätze zu je 10 ct: je Satz 7 ct, zusammen 14 ct, nicht 75 % der Summe von 20 ct
    const zwei = await dauerbeleg("Zwei Sätze", {
      ...einmal,
      privateShare: 25,
      amounts: [
        { taxRate: 1900, net: 53, tax: 10 },
        { taxRate: 700, net: 143, tax: 10 },
      ],
    });
    // Zollbescheid: der ganze Betrag ist Vorsteuer (Kz 62), auch ohne Steuerausweis (einfuhrumsatzsteuerPosting)
    const zoll = await dauerbeleg("Zoll", {
      next: "2026-12-01",
      end: "2026-12-31",
      category: "einfuhrumsatzsteuer",
      amounts: [{ taxRate: 0, net: 38_000, tax: 0 }],
    });
    const vorsteuer = async () =>
      new Map((await dauerbelege.dauerbelegPosten(await kontext.ladeKontext("2026-11-20", "13w"))).map((p) => [p.quelle.id, p.steuer?.betrag ?? 0]));
    expect(await vorsteuer()).toEqual(
      new Map([
        [halb, -7],
        [zwei, -14],
        [zoll, -38_000],
      ]),
    );

    // Nur steuerfreie Umsätze ohne Vorsteuerabzug (Firmendaten): die Buchung zieht nichts ab, die Vorschau erwartet nichts
    await sql`update company set ohne_vorsteuerabzug = true`;
    expect(await vorsteuer()).toEqual(
      new Map([
        [halb, 0],
        [zwei, 0],
        [zoll, 0],
      ]),
    );
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("wiederkehrende Rechnungen je Termin zur Fälligkeit, inaktive fehlen (%s, %s)", async (kontenrahmen, versteuerung) => {
    await firma(sql, { kontenrahmen, versteuerung });
    const contactId = await kunde(contacts);
    const vorlage = async (name: string, active: boolean) => {
      const lines = [{ description: "Wartung", quantity: 1000, unit: "Monat", unitPrice: 100_000, taxRate: 1900 }];
      const [row] = await sql<{ id: string }[]>`insert into recurring_invoices (name, active, contact_id, payment_term_days, lines,
          recurrence, anchor_day, next_date)
        values (${name}, ${active}, ${contactId}, 14, ${JSON.stringify(lines)}::jsonb, 'P1M', 15, '2026-12-15') returning id`;
      return row!.id;
    };
    const wartung = await vorlage("Wartung", true);
    await vorlage("Alt", false);

    const posten = await wiederkehrend.wiederkehrendPosten(await kontext.ladeKontext("2026-11-20", "13w"));
    const ist = versteuerung === "ist";
    // 15.12. + 14 = 29.12.; 15.01. + 14 = 29.01.; 15.02. + 14 = 01.03., nach dem Horizont (der Kern lässt ihn weg).
    // Soll: Leistungszeitraum „laufend“ ist der Rechnungsmonat, ausgeführt an seinem letzten Tag
    expect(posten.map((p) => [p.datum, p.betrag, p.richtung, p.sicherheit, p.quelle.id, p.steuer])).toEqual([
      ["2026-12-29", 119_000, "ein", "erwartet", wartung, { betrag: 19_000, datum: ist ? "2026-12-29" : "2026-12-31" }],
      ["2027-01-29", 119_000, "ein", "erwartet", wartung, { betrag: 19_000, datum: ist ? "2027-01-29" : "2027-01-31" }],
      ["2027-03-01", 119_000, "ein", "erwartet", wartung, { betrag: 19_000, datum: ist ? "2027-03-01" : "2027-02-28" }],
    ]);
    expect(posten[0]?.text).toBe("Wartung · Nordwerk Software GmbH");
  });

  it("Soll (SKR04): Umsatzsteuer im Monat der Leistung, auch bei „vorher“ und Intervall über einem Monat", async () => {
    await firma(sql, { kontenrahmen: "SKR04", versteuerung: "soll" });
    await sql`insert into vat_frequencies (year, from_month, frequency) values (2026, 1, 'monatlich')`;
    const contactId = await kunde(contacts);
    const lines = [{ description: "Wartung", quantity: 1000, unit: "Monat", unitPrice: 100_000, taxRate: 1900 }];
    const vorlage = async (name: string, recurrence: string, servicePeriod: string) => {
      const [row] = await sql<{ id: string }[]>`insert into recurring_invoices (name, active, contact_id, payment_term_days, lines,
          recurrence, anchor_day, next_date, service_period)
        values (${name}, true, ${contactId}, 14, ${JSON.stringify(lines)}::jsonb, ${recurrence}, 15, '2026-12-15', ${servicePeriod}) returning id`;
      return row!.id;
    };
    const abrechnung = await vorlage("Abrechnung", "P1M", "vorher");
    const quartal = await vorlage("Quartal", "P3M", "laufend");
    const woche = await vorlage("Woche", "P2W", "laufend");

    const posten = await wiederkehrend.wiederkehrendPosten(await kontext.ladeKontext("2026-11-20", "13w"));
    // Wie der Lauf (invoiceForDate, invoice-finalize.ts): „vorher“ am 15.12. rechnet den November ab, ausgeführt am 30.11.;
    // vierteljährlich „laufend“ am 15.12. deckt Dezember bis Februar, ausgeführt am 28.02.2027
    expect(posten.filter((p) => p.quelle.id !== woche).map((p) => [p.quelle.id, p.datum, p.steuer])).toEqual([
      [abrechnung, "2026-12-29", { betrag: 19_000, datum: "2026-11-30" }],
      [abrechnung, "2027-01-29", { betrag: 19_000, datum: "2026-12-31" }],
      [abrechnung, "2027-03-01", { betrag: 19_000, datum: "2027-01-31" }],
      [quartal, "2026-12-29", { betrag: 19_000, datum: "2027-02-28" }],
    ]);
    // Alle 2 Wochen (#1695): Termine im Abstand von 14 Tagen, „laufend“ deckt die 14 Tage ab dem Rechnungsdatum
    expect(posten.filter((p) => p.quelle.id === woche).map((p) => [p.datum, p.steuer?.datum])).toEqual([
      ["2026-12-29", "2026-12-28"],
      ["2027-01-12", "2027-01-11"],
      ["2027-01-26", "2027-01-25"],
      ["2027-02-09", "2027-02-08"],
      ["2027-02-23", "2027-02-22"],
    ]);

    // Die 190 € gehören in die Umsatzsteuer November, fällig am 10.12.2026 (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 1 UStG)
    const bericht = await vorschau.liquiditaetsvorschau("2026-11-20", "4w");
    const ust = bericht.vorschau.zeitraeume.flatMap((z) => z.posten).filter((p) => p.quelle.art === "umsatzsteuer");
    expect(ust.map((p) => [p.datum, p.richtung, p.betrag, p.text])).toEqual([["2026-12-10", "aus", 19_000, "Umsatzsteuer November 2026"]]);
  }, 30_000);
});
