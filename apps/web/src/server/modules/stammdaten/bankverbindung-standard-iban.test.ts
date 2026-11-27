import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * createBankverbindung lehnt die IBAN des Standardkontos ab („Dieselbe IBAN zweimal wäre in der Auswahl
 * nicht zu unterscheiden“). Der umgekehrte Weg, die Firmendaten auf die IBAN eines weiteren Zahlungskontos zu setzen,
 * soll das ebenso verhindern. Alle Daten sind erfunden.
 */
describe.skipIf(!testDatabaseUrl)("Standard-IBAN und weitere Zahlungskonten (Postgres, #1887)", () => {
  let sql: postgres.Sql;
  let stammdaten: typeof import("./index.ts");
  let company: typeof import("./company.ts");
  let guard: typeof import("../auswertungen/settings-guard.ts");
  const actor = "test-user";
  const STANDARD = "DE89370400440532013000";
  const NORD = "DE02120300000000202051";

  beforeAll(async () => {
    sql = await setupTestDb();
    stammdaten = await import("./index.ts");
    company = await import("./company.ts");
    guard = await import("../auswertungen/settings-guard.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate contact_versions, contacts, bankverbindungen, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', ${STANDARD}, 'COBADEFFXXX', 'Commerzbank', 'ist', 'SKR03')`;
    await stammdaten.createBankverbindung(actor, { bezeichnung: "Objekt Nord", iban: NORD, bic: "", bank: "", kontoinhaber: "" });
  });

  it("Firmendaten lassen sich nicht auf die IBAN eines weiteren Zahlungskontos setzen", async () => {
    const current = company.companySchema.parse(await company.loadCompany());
    await expect(guard.saveCompany(actor, company.companySchema.parse({ ...current, iban: NORD }), "2026-11-26")).rejects.toThrow("weiteres Zahlungskonto");
    // Sonst steht dieselbe IBAN zweimal in der Auswahl (Standard und „Objekt Nord“)
    const auswahl = await stammdaten.bankverbindungAuswahl();
    const ibans = [auswahl.standardIban.replace(/\s/g, ""), ...auswahl.liste.map((b) => b.iban)];
    expect(new Set(ibans).size).toBe(ibans.length);
  });
});
