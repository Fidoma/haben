import { EricGeprueftClient } from "../../test-eric.ts";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Nachrichten an das Finanzamt (Postgres)", () => {
  let finanzamt: typeof import("./finanzamt.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    finanzamt = await import("./finanzamt.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate elster_certificates, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland, versteuerung, kontenrahmen, einkunftsart)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY', 'ist', 'SKR03', 'selbstaendig')`;
  });

  const jahr = new Date().getFullYear();
  const antrag = { topic: "vorauszahlung" as const, quartal: "Q4" as const, jahr, text: "Bitte herabsetzen.", figures: { wanted: 100_000 } };
  const nachricht = { topic: "nachricht" as const, betreff: "Rückfrage", text: "Gewinn 01.01.–30.06.", figures: null };

  it("prüft und sendet testweise, speichert Text, Werte und XML", async () => {
    const client = new EricGeprueftClient();
    expect((await finanzamt.sendMessage(actor, antrag, client, { kind: "validate" })).ok).toBe(true);
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "test", pin: "1234" })).rejects.toThrow(/Zertifikat/);
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
    const tested = await finanzamt.sendMessage(actor, antrag, client, { kind: "test", pin: "1234" });
    expect(tested.ok).toBe(true);
    expect(tested.pdf).toBeUndefined();
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "send", pin: "1234", herstellerId: "12345" })).rejects.toThrow(/Ohne ERiC/);

    const rows = await sql`select topic, kind, ok, betreff, figures, request_xml from elster_messages order by created_at`;
    expect(rows.map((r) => [r.topic, r.kind, r.ok])).toEqual([
      ["vorauszahlung", "validate", true],
      ["vorauszahlung", "test", true],
    ]);
    expect(rows[0]!.figures).toEqual({ wanted: 100_000 });
    expect(rows[0]!.betreff).toBe(`Anpassung der Einkommensteuer-Vorauszahlungen ab dem 4. Quartal ${jahr}`);
    expect(rows[1]!.request_xml).toContain("<DatenArt>AnpassungVorauszahlung</DatenArt>");
    expect(rows[1]!.request_xml).toContain("<Begruendung>Bitte herabsetzen.</Begruendung>");
    expect(rows[1]!.request_xml).toContain(`<Steuerart>0030</Steuerart>\n<Quartal>Q4</Quartal>\n<Jahr>${jahr}</Jahr>`);
    expect(rows[1]!.request_xml).toContain("<Hausnummer>1</Hausnummer>");
    expect((await finanzamt.listMessages()).map((m) => m.kind)).toEqual(["test", "validate"]);
    await expect(sql`delete from elster_messages`).rejects.toThrow();
  });

  it("freie Nachricht als Sonstige Nachricht mit Betreff, Text im Zeichensatz von ELSTER", async () => {
    const client = new EricGeprueftClient();
    expect((await finanzamt.sendMessage(actor, nachricht, client, { kind: "validate" })).ok).toBe(true);
    const [row] = await sql`select topic, betreff, request_xml from elster_messages order by created_at desc limit 1`;
    expect(row!.topic).toBe("nachricht");
    expect(row!.betreff).toBe("Rückfrage");
    expect(row!.request_xml).toContain("<DatenArt>SonstigeNachrichten</DatenArt>");
    expect(row!.request_xml).toContain("<Text>Gewinn 01.01.-30.06.</Text>");
  });

  it("Antrag: Jahr außerhalb dessen, was ELSTER annimmt, und Quartal außerhalb der Liste", async () => {
    const client = new EricGeprueftClient();
    await expect(finanzamt.sendMessage(actor, { ...antrag, jahr: jahr - 4 }, client, { kind: "validate" })).rejects.toThrow(/Das Jahr muss zwischen/);
    await expect(finanzamt.sendMessage(actor, { ...antrag, quartal: "Q5" as never }, client, { kind: "validate" })).rejects.toThrow(/Q1/);
  });

  it("lehnt leere Nachrichten und Anschriften ohne Hausnummer ab", async () => {
    const client = new EricGeprueftClient();
    await expect(finanzamt.sendMessage(actor, { ...nachricht, betreff: " " }, client, { kind: "validate" })).rejects.toThrow(/Betreff/);
    await expect(finanzamt.sendMessage(actor, { ...antrag, text: " " }, client, { kind: "validate" })).rejects.toThrow(/Text/);
    await sql`update company set strasse = 'Am Markt'`;
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "validate" })).rejects.toThrow(/Hausnummer/);
  });

  it("GmbH und UG: kein Antrag zu Einkommensteuer-Vorauszahlungen, freie Nachrichten schon", async () => {
    const client = new EricGeprueftClient();
    await sql`update company set rechtsform = 'gmbh', einkunftsart = null, name = 'Testfirma GmbH'`;
    // elster_messages ist nur anhängen; gezählt wird, was dieser Test schreibt
    const vorher = (await sql`select count(*)::int as n from elster_messages`)[0]!.n as number;
    await expect(finanzamt.sendMessage(actor, antrag, client, { kind: "validate" })).rejects.toThrow(/nur im Einzelunternehmen/);
    expect((await finanzamt.sendMessage(actor, nachricht, client, { kind: "validate" })).ok).toBe(true);
    const neu = await sql`select topic from elster_messages order by created_at desc limit 1`;
    expect((await sql`select count(*)::int as n from elster_messages`)[0]!.n).toBe(vorher + 1);
    expect(neu[0]!.topic).toBe("nachricht");
  });

  it("rechnet den Gewinn aufs Jahr hoch", async () => {
    const basis = await finanzamt.prepaymentBasis("2026-07-02");
    expect(basis).toMatchObject({ year: 2026, until: "2026-07-02", profitSoFar: 0, profitForecast: 0, einkunftsart: "selbstaendig" });
    expect(basis.prognose).toMatchObject({ einkommensteuer: 0, gesamt: 0, jeQuartal: 0 });
  });

  it("schätzt die Steuer mit den Angaben des Vorjahres, wenn es fürs laufende Jahr keine gibt", async () => {
    const incomeTax = await import("../jahreserklaerung/income-tax.ts");
    await leeren(sql)`truncate income_tax_inputs`;
    expect((await finanzamt.prepaymentBasis("2026-07-02")).angabenAus).toBeNull();
    await incomeTax.saveEstAngaben(actor, 2025, { vorsorge: { a: { pkv: 500_000 } } });
    const basis = await finanzamt.prepaymentBasis("2026-07-02");
    expect(basis.angabenAus).toBe(2025);
    expect(basis.prognose.vorsorge).toBe(500_000);
    await incomeTax.saveEstAngaben(actor, 2023, {});
    await sql`delete from income_tax_inputs where year = 2025`;
    expect((await finanzamt.prepaymentBasis("2026-07-02")).angabenAus).toBeNull();
  });

  describe("Bankverbindung ändern", () => {
    let taxpayer: typeof import("../stammdaten/taxpayer.ts");
    beforeAll(async () => {
      taxpayer = await import("../stammdaten/taxpayer.ts");
    });
    const person = { idnr: "86095742719", anrede: "Herrn" as const, vorname: "Max", name: "Muster", geburtsdatum: "1980-03-15" };

    it("braucht die persönlichen Angaben und eine gültige IBAN", async () => {
      const client = new EricGeprueftClient();
      await expect(finanzamt.sendBankChange(actor, { iban: "DE89370400440532013000" }, client, { kind: "validate" })).rejects.toThrow(/Persönliche Angaben/);
      await taxpayer.saveTaxpayer(actor, { a: person });
      await expect(finanzamt.sendBankChange(actor, { iban: "DE00370400440532013000" }, client, { kind: "validate" })).rejects.toThrow(/IBAN/);
    });

    it("sendet testweise und speichert den Vorgang im Verlauf", async () => {
      const client = new EricGeprueftClient();
      await taxpayer.saveTaxpayer(actor, { a: person });
      await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
      const result = await finanzamt.sendBankChange(actor, { iban: "de89 3704 0044 0532 0130 00" }, client, { kind: "test", pin: "1234" });
      expect(result.ok).toBe(true);
      const [row] = await sql`select topic, kind, text, figures, request_xml from elster_messages where topic = 'bankverbindung'`;
      expect(row).toMatchObject({ topic: "bankverbindung", kind: "test", figures: { iban: "DE89370400440532013000" } });
      expect(row!.text).toContain("DE89 3704 0044 0532 0130 00");
      expect(row!.request_xml).toContain("<IBAN>DE89370400440532013000</IBAN>");
      expect(row!.request_xml).toContain("<Geburtsdatum>15.03.1980</Geburtsdatum>");
      expect(row!.request_xml).toContain(`<Empfaenger id="F">9198</Empfaenger>`);
    });
  });

  describe("Persönliche Angaben", () => {
    let taxpayer: typeof import("../stammdaten/taxpayer.ts");
    beforeAll(async () => {
      taxpayer = await import("../stammdaten/taxpayer.ts");
    });

    it("prüft die Identifikationsnummer und verlangt bei Zusammenveranlagung den Ehegatten", async () => {
      const a = { idnr: "86095742719", anrede: "Frau" as const, vorname: "Erika", name: "Muster", geburtsdatum: "1985-01-02" };
      await expect(taxpayer.saveTaxpayer(actor, { a: { ...a, idnr: "12345678901" } })).rejects.toThrow(/Identifikationsnummer/);
      await expect(taxpayer.saveTaxpayer(actor, { a, veranlagung: "zusammen" })).rejects.toThrow(/Ehegatten/);
      await taxpayer.saveTaxpayer(actor, { a: { ...a, idnr: "86 095 742 719" } });
      expect(await taxpayer.loadTaxpayer()).toEqual({ a: { ...a, religion: "11", beruf: "" } });
      const [audit] = await sql`select new_value from audit_log where table_name = 'company' order by id desc limit 1`;
      expect(audit!.new_value.taxpayer.a.idnr).toBe("86095742719");
    });
  });
});
