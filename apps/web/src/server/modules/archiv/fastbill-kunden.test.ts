import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Telefon, Leitweg-ID, DATEV-Debitor und Ansprechpartner der Kunden aus FastBill (#1939). Feldnamen nach der API-Doku
 * (customer.get, contact.get); Namen, Nummern und Adressen erfunden.
 */
const API = "https://my.fastbill.com/api/1.0/api.php";
const KEY = "0123456789abcdef0123456789abcdef";

const CUSTOMERS = [
  {
    CUSTOMER_ID: "701",
    CUSTOMER_NUMBER: "1701",
    ORGANIZATION: "Stadtwerke Beispiel",
    COUNTRY_CODE: "DE",
    PHONE: "+49 941 1234",
    BUYER_REFERENCE: "991-12345-67",
    CUSTOMER_ACCOUNT: "10701",
  },
  // Gibt es in Haben schon (gleicher Name, ohne FastBill-Herkunft): eigene Werte bleiben, nur Leeres wird gefüllt
  {
    CUSTOMER_ID: "702",
    CUSTOMER_NUMBER: "1702",
    ORGANIZATION: "Bestand GmbH",
    COUNTRY_CODE: "DE",
    PHONE: "+49 30 999",
    BUYER_REFERENCE: "991-00000-11",
    // Schon an 701 vergeben, aber Bestand GmbH hat in Haben einen eigenen: keine Meldung
    CUSTOMER_ACCOUNT: "10701",
  },
  // Debitor schon an 701 vergeben
  { CUSTOMER_ID: "703", CUSTOMER_NUMBER: "1703", ORGANIZATION: "Doppelt GmbH", COUNTRY_CODE: "DE", CUSTOMER_ACCOUNT: "10701" },
  // Telefon besteht die Prüfung nicht
  { CUSTOMER_ID: "704", CUSTOMER_NUMBER: "1704", ORGANIZATION: "Rückruf KG", COUNTRY_CODE: "DE", PHONE: "bitte abends" },
];
const CONTACTS = [
  {
    CONTACT_ID: "31",
    CUSTOMER_ID: "701",
    FIRST_NAME: "Erika",
    LAST_NAME: "Muster",
    POSITION: "Buchhaltung",
    EMAIL: "buchhaltung@example.de",
    PHONE: "0941 5678",
  },
  // Ungültige E-Mail: Person ohne E-Mail übernehmen
  { CONTACT_ID: "32", CUSTOMER_ID: "701", FIRST_NAME: "Max", LAST_NAME: "Beispiel", EMAIL: "keine-adresse" },
  // Kunde unbekannt: auslassen
  { CONTACT_ID: "33", CUSTOMER_ID: "999", FIRST_NAME: "Nora", LAST_NAME: "Niemand" },
];

function fakeFastbill(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== API) return new Response("", { headers: { "content-type": "text/html" } });
    const body = JSON.parse(String(init?.body)) as { SERVICE: string; OFFSET: number };
    const page = (key: string, items: unknown[]) => new Response(JSON.stringify({ RESPONSE: { [key]: body.OFFSET === 0 ? items : [] } }));
    if (body.SERVICE === "customer.get") return page("CUSTOMERS", CUSTOMERS);
    if (body.SERVICE === "contact.get") return page("CONTACTS", CONTACTS);
    return page("ITEMS", []);
  }) as typeof fetch;
}

describe.skipIf(!testDatabaseUrl)("Kunden aus FastBill mit Telefon, Leitweg-ID, Debitor und Ansprechpartnern (Postgres, #1939)", () => {
  let sql: postgres.Sql;
  let fastbill: typeof import("./fastbill.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    fastbill = await import("./fastbill.ts");
    const importPkg = await import("@haben/import");
    fastbill.setFastbillClientFactory(
      (o) => new importPkg.FastbillClient({ ...o, fetch: fakeFastbill(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await sql`select set_config('haben.actor', 'test', false)`;
    await sql`insert into contacts (name, is_customer, telefon, leitweg_id, debitor_nr) values ('Bestand GmbH', true, '+49 40 111', '991-77777-22', 10800)`;
    await fastbill.saveFastbillKey(actor, { email: "inhaber@example.de", apiKey: KEY, callsPerHour: 50 });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const contacts = () => sql`select fastbill_id, name, telefon, leitweg_id, debitor_nr from contacts order by name`.then((rows) => rows.map((r) => ({ ...r })));
  const persons = () =>
    sql`select c.fastbill_id, p.name, p.email, p.telefon, p.funktion from contact_persons p join contacts c on c.id = p.contact_id order by p.name`.then(
      (rows) => rows.map((r) => ({ ...r })),
    );

  it("übernimmt Telefon, Leitweg-ID und Debitor; Ungültiges und Vergebenes nennt der Abruf", async () => {
    await fastbill.startFastbillImport(actor, { wait: true });
    const run = await fastbill.latestFastbillImport();
    expect(run).toMatchObject({ status: "fertig" });
    expect(await contacts()).toEqual([
      { fastbill_id: "702", name: "Bestand GmbH", telefon: "+49 40 111", leitweg_id: "991-77777-22", debitor_nr: 10_800 },
      { fastbill_id: "703", name: "Doppelt GmbH", telefon: "", leitweg_id: "", debitor_nr: null },
      { fastbill_id: "704", name: "Rückruf KG", telefon: "", leitweg_id: "", debitor_nr: null },
      { fastbill_id: "701", name: "Stadtwerke Beispiel", telefon: "+49 941 1234", leitweg_id: "991-12345-67", debitor_nr: 10_701 },
    ]);
    expect(run!.progress.failed.map((f) => [f.lexofficeId, f.number])).toEqual([
      ["fastbill/customer/703", "1703"],
      ["fastbill/customer/704", "1704"],
    ]);
    expect(run!.progress.failed[0]!.message).toMatch(/Debitor 10701/);
    expect(run!.progress.failed[1]!.message).toMatch(/Telefon/);
  });

  it("legt Ansprechpartner am Kunden an, ohne ungültige E-Mail; ohne bekannten Kunden nicht", async () => {
    expect(await persons()).toEqual([
      { fastbill_id: "701", name: "Erika Muster", email: "buchhaltung@example.de", telefon: "0941 5678", funktion: "Buchhaltung" },
      { fastbill_id: "701", name: "Max Beispiel", email: "", telefon: "", funktion: "" },
    ]);
  });

  it("ein zweiter Abruf legt nichts doppelt an, überschreibt nichts und meldet nicht mehr, was in Haben behoben ist", async () => {
    // In Haben nachgetragen: Telefon für 704, ein eigener Debitor für 703; das Telefon von 701 geändert
    await sql`update contacts set telefon = '+49 941 0000' where fastbill_id = '701'`;
    await sql`update contacts set telefon = '+49 89 4711' where fastbill_id = '704'`;
    await sql`update contacts set debitor_nr = 10703 where fastbill_id = '703'`;
    await fastbill.startFastbillImport(actor, { wait: true });
    expect(await persons()).toHaveLength(2);
    expect((await contacts()).find((c) => c.fastbill_id === "701")).toMatchObject({ telefon: "+49 941 0000", debitor_nr: 10_701 });
    // Sonst würde die Liste der fehlgeschlagenen Belege nie leer
    expect((await fastbill.latestFastbillImport())!.progress.failed).toEqual([]);
  });
});
