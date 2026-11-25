import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { weitereAngabenFeld } from "../../../components/ContactWeitereAngaben.tsx";
import { userClientError } from "../../errors.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Fehler des Servers zu Feldern in „Weitere Angaben“ (#1253): Das Formular klappt den Bereich dann auf */
describe.skipIf(!testDatabaseUrl)("Weitere Angaben am Kontakt: Fehler des Servers nennen das Feld", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  const gueltig = {
    kundennummer: "",
    name: "Muster",
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    isCustomer: true,
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Der Fehler, den der Browser bekommt, wenn der Server die Eingabe ablehnt */
  function serverFehler(aenderung: Record<string, unknown>): Error {
    const ergebnis = contacts.contactSchema.safeParse({ ...gueltig, ...aenderung });
    expect(ergebnis.success).toBe(false);
    return userClientError(ergebnis.error)!;
  }

  it("Skonto: Frist und Satz außerhalb der Grenzen", () => {
    for (const skonto of [[{ days: 121, percent: 200 }], [{ days: 0, percent: 200 }], [{ days: 10, percent: 10_000 }], [{ days: 10, percent: 0 }]]) {
      expect(weitereAngabenFeld(serverFehler({ skonto })), JSON.stringify(skonto)).toBe("skonto");
    }
  });

  it("Leitweg-ID über 46 Zeichen", () => {
    const fehler = serverFehler({ leitwegId: "9".repeat(47) });
    expect(fehler.message).toBe("Leitweg-ID: höchstens 46 Zeichen");
    expect(weitereAngabenFeld(fehler)).toBe("leitwegId");
  });

  it("Unsere Lieferantennummer über 40 Zeichen", () => {
    const fehler = serverFehler({ unsereLieferantennummer: "7".repeat(41) });
    expect(fehler.message).toBe("Unsere Lieferantennummer: höchstens 40 Zeichen");
    expect(weitereAngabenFeld(fehler)).toBe("unsereLieferantennummer");
  });

  it("Stundensatz über 100.000 €, den der Browser durchlässt, und negativer Stundensatz", () => {
    const zuHoch = serverFehler({ hourlyRateCents: 100_000_01 });
    expect(zuHoch.message).toBe("Stundensatz: höchstens 100.000 €");
    expect(weitereAngabenFeld(zuHoch)).toBe("hourlyRateCents");
    expect(weitereAngabenFeld(serverFehler({ hourlyRateCents: -1 }))).toBe("hourlyRateCents");
  });

  it("Debitor und Kreditor außerhalb des Bereichs", () => {
    expect(weitereAngabenFeld(serverFehler({ debitorNr: 5 }))).toBe("debitorNr");
    expect(weitereAngabenFeld(serverFehler({ kreditorNr: 5 }))).toBe("kreditorNr");
  });

  it("eine vergebene Nummer nennt das Feld, auch wenn der andere Kontakt wie ein Stichwort heißt", async () => {
    await leeren(sql)`truncate contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    await contacts.createContact("test-user", { ...gueltig, name: "Debitor Müller GmbH", kreditorNr: 70087 });
    const doppelt = await contacts
      .createContact("test-user", { ...gueltig, name: "Zweiter" })
      .then(() => contacts.createContact("test-user", { ...gueltig, name: "Dritter", kreditorNr: 70087 }))
      .catch((error: unknown) => error);
    expect((doppelt as Error).message).toContain("Kreditor 70087 hat schon „Debitor Müller GmbH“");
    expect(weitereAngabenFeld(userClientError(doppelt)!)).toBe("kreditorNr");
    // Eine Nummer außerhalb des Bereichs, die erst der Server prüft (clean), nennt ebenfalls das Feld
    const ausserhalb = await contacts.createContact("test-user", { ...gueltig, name: "Vierter", debitorNr: 5 }).catch((error: unknown) => error);
    expect(weitereAngabenFeld(userClientError(ausserhalb)!)).toBe("debitorNr");
  });
});

/** Das Schema allein, ohne Datenbank: Die Grenze der Nummer beim Kunden liegt bei genau 40 Zeichen */
describe("Unsere Lieferantennummer im Schema (#1253)", () => {
  const kontakt = {
    kundennummer: "",
    name: "Muster",
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
  };

  it("40 Zeichen gehen, 41 nennen das Feld und die Grenze", async () => {
    // contacts.ts liest beim Laden die Umgebung; ohne Testdatenbank genügen Platzhalter, es verbindet sich nichts
    for (const [name, wert] of Object.entries({
      DATABASE_URL: "postgres://haben@127.0.0.1:1/schema",
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    }))
      if (!process.env[name]) vi.stubEnv(name, wert);
    const { contactSchema } = await import("./contacts.ts");
    expect(contactSchema.safeParse({ ...kontakt, unsereLieferantennummer: "7".repeat(40) }).success).toBe(true);
    const fehler = userClientError(contactSchema.safeParse({ ...kontakt, unsereLieferantennummer: "7".repeat(41) }).error!)!;
    expect(fehler.message).toBe("Unsere Lieferantennummer: höchstens 40 Zeichen");
    expect(weitereAngabenFeld(fehler)).toBe("unsereLieferantennummer");
  });
});
