import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * REST-API für Angebotsentwürfe (#297): anlegen, ändern und löschen mit dem Recht angebote:entwuerfe. Festschreiben,
 * Versenden und die Rechnung aus dem Angebot bleiben in Haben; Rabatte und Zahlungsplan setzt nur die Oberfläche.
 */

describe.skipIf(!testDatabaseUrl)("REST-API: Angebotsentwürfe anlegen, ändern und löschen (Postgres, #297)", () => {
  let api: typeof import("./index.ts");
  let mcp: typeof import("../mcp/index.ts");
  let mcpServer: typeof import("../mcp/server.ts");
  let rechnungen: typeof import("../rechnungen/index.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let schemas: typeof import("./quotes-schemas.ts");
  let contactDefaults: typeof import("./schemas.ts")["CONTACT_DEFAULTS"];
  let sql: postgres.Sql;
  const actor = "test-user";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  let contactId: string;

  /** 8 Std. zu 95 € = 760 € netto */
  const line = (extra = {}) => ({ description: "Workshop Architektur", quantity: 8000, unit: "Std.", unitPrice: 9500, taxRate: 1900, ...extra });
  const optional = line({ description: "Dokumentation", quantity: 1000, unit: "Psch.", unitPrice: 50_000, kind: "optional" });

  /** Entwurf wie aus dem Editor in Haben, gültig bis 2099 */
  const draft = (overrides = {}) => ({
    contactId,
    issueDate: "2026-10-01",
    validUntil: "2099-12-31",
    serviceFrom: null,
    serviceTo: null,
    note: "",
    lines: [line()],
    ...overrides,
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    api = await import("./index.ts");
    mcp = await import("../mcp/index.ts");
    mcpServer = await import("../mcp/server.ts");
    rechnungen = await import("../rechnungen/index.ts");
    stammdaten = await import("../stammdaten/index.ts");
    schemas = await import("./quotes-schemas.ts");
    contactDefaults = (await import("./schemas.ts")).CONTACT_DEFAULTS;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    mcpServer.resetRateLimitForTests();
    await leeren(sql)`truncate mcp_calls, mcp_tokens, mail_log, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, text_blocks, contact_persons, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 21)`;
    contactId = (await stammdaten.createContact(actor, { ...contactDefaults, kundennummer: "10001", name: "Nordwerk Software GmbH" })).id;
  });

  type Scope = import("../mcp/index.ts").TokenScope;
  async function token(scopes: Scope[]) {
    await mcp.setMcpEnabled(actor, true);
    return (await mcp.createMcpToken({ name: "Angebotsassistent", days: 30, scopes }, new Date(), actor)).token;
  }

  async function call(tokenValue: string, method: string, path: string, body?: unknown) {
    const response = await api.handleApiRequest(
      new Request(`http://localhost:3000/api/v1${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${tokenValue}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      json: text ? (JSON.parse(text) as Record<string, unknown> & { error?: { code: string; message: string; issues?: { path: string }[] } }) : null,
    };
  }

  it("legt dieselbe externe Referenz auch parallel nur einmal an und liefert danach den festgeschriebenen Stand", async () => {
    const t = await token(["angebote:entwuerfe"]);
    const reference = { externalSource: "desk", externalId: "projekt-42-angebot-1" };
    const input = { contactId, ...reference, lines: [line()] };
    const results = await Promise.all([call(t, "POST", "/angebote", input), call(t, "POST", "/angebote", input)]);
    expect(results.map(({ status }) => status).sort()).toEqual([200, 201]);
    const id = String(results[0]!.json!.id);
    expect(results[1]!.json).toMatchObject({ id, ...reference });
    expect(await sql`select id from quotes`).toEqual([{ id }]);
    // PATCH lehnt Änderungen an der Referenz ab, andere Änderungen behalten sie
    expect((await call(t, "PATCH", `/angebote/${id}`, { externalId: "anders" })).status).toBe(400);
    expect((await call(t, "PATCH", `/angebote/${id}`, { externalSource: "anders" })).status).toBe(400);
    const patched = await call(t, "PATCH", `/angebote/${id}`, { note: "Bleibt unverändert" });
    expect(patched.status).toBe(200);
    expect(patched.json).toMatchObject({ id, ...reference, note: "Bleibt unverändert" });
    // Nur beide Felder zusammen sind gültig
    expect((await call(t, "POST", "/angebote", { ...input, externalId: undefined })).status).toBe(400);
    expect((await call(t, "POST", "/angebote", { ...input, externalSource: undefined })).status).toBe(400);
    // Dieselbe externalId unter anderer Quelle legt ein eigenes Angebot an
    const otherSource = await call(t, "POST", "/angebote", { ...input, externalSource: "other" });
    expect(otherSource.status).toBe(201);
    expect(otherSource.json!.id).not.toBe(id);
    // Kopieren übernimmt die externe Referenz nicht
    const copy = await rechnungen.copyQuote(actor, id, today);
    expect(copy).toMatchObject({ externalSource: null, externalId: null });
    // Löschen eines Entwurfs gibt die externe Referenz wieder frei
    expect((await call(t, "DELETE", `/angebote/${otherSource.json!.id}`)).status).toBe(204);
    const recreated = await call(t, "POST", "/angebote", { ...input, externalSource: "other" });
    expect(recreated.status).toBe(201);
    expect(recreated.json!.id).not.toBe(otherSource.json!.id);
    // Nach dem Festschreiben liefert eine Wiederholung weiter den festgeschriebenen Stand
    await rechnungen.finalizeQuote(actor, id);
    const retry = await call(t, "POST", "/angebote", { ...input, lines: [line({ unitPrice: 1_000 })] });
    expect(retry.status).toBe(200);
    expect(retry.headers.get("location")).toBe(`/api/v1/angebote/${id}`);
    expect(retry.json).toMatchObject({ id, ...reference, status: "final", net: 76_000 });
  });

  it("legt einen Entwurf mit den Vorgaben eines neuen Angebots an: gültig 30 Tage ab Angebotsdatum, Standardtexte, Sprache des Kunden", async () => {
    await stammdaten.createTextBlock(actor, {
      name: "Angebot Kopf",
      kind: "kopf",
      text: "Vielen Dank für Ihre Anfrage.",
      contactId: null,
      standardFuer: "angebot",
    });
    await stammdaten.createTextBlock(actor, {
      name: "Angebot Fuß",
      kind: "fuss",
      text: "Wir freuen uns auf Ihren Auftrag.",
      contactId: null,
      standardFuer: "angebot",
    });
    const english = await stammdaten.createContact(actor, { ...contactDefaults, name: "Harbour Labs Ltd", language: "en" });
    const t = await token(["angebote:entwuerfe"]);

    const created = await call(t, "POST", "/angebote", { contactId: english.id, issueDate: "2027-03-01", lines: [line(), optional] });
    expect(created.status).toBe(201);
    const quote = schemas.quoteSchema.parse(created.json);
    expect(quote).toMatchObject({
      status: "draft",
      listStatus: "entwurf",
      number: null,
      contactId: english.id,
      customer: "Harbour Labs Ltd",
      issueDate: "2027-03-01",
      validUntil: "2027-03-31",
      intro: "Vielen Dank für Ihre Anfrage.",
      note: "Wir freuen uns auf Ihren Auftrag.",
      language: "en",
      taxTreatment: "regulaer",
      priceMode: "netto",
      net: 76_000,
      tax: 14_440,
      gross: 90_440,
      choices: [],
      lockedAt: null,
    });
    expect(quote.lines.map((l) => [l.position, l.kind, l.net])).toEqual([
      [1, null, 76_000],
      [2, "optional", 50_000],
    ]);
    expect(created.headers.get("location")).toBe(`/api/v1/angebote/${quote.id}`);

    // Eigene Angaben gehen vor; ohne Datum gilt heute
    const own = await call(t, "POST", "/angebote", { validUntil: "2099-01-31", intro: "", note: "Bis Ende Januar.", language: "de", lines: [line()] });
    expect(own.status).toBe(201);
    expect(own.json).toMatchObject({ contactId: null, issueDate: today, validUntil: "2099-01-31", intro: "", note: "Bis Ende Januar.", language: "de" });
  });

  it("nimmt als Kleinunternehmer die Steuerbehandlung aus den Firmendaten", async () => {
    await sql`update company set kleinunternehmer = true`;
    const t = await token(["angebote:entwuerfe"]);
    const created = await call(t, "POST", "/angebote", { contactId, lines: [line({ taxRate: 0 })] });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ taxTreatment: "kleinunternehmer", net: 76_000, tax: 0, gross: 76_000 });
  });

  it("PATCH ändert nur die genannten Felder; Gesamtrabatt und Zahlungsplan aus Haben bleiben, lines ersetzt die Positionen samt Rabatt", async () => {
    const created = await rechnungen.createQuoteDraft(
      actor,
      draft({
        lines: [line({ discount: { kind: "prozent", value: 1000 } })],
        discount: { kind: "betrag", value: 6_000 },
        paymentPlan: [
          { label: "Anzahlung", share: { kind: "prozent", value: 3000 }, due: "Auftragserteilung" },
          { label: "Rest", share: { kind: "rest" }, due: "Abnahme" },
        ],
      }) as never,
    );
    const t = await token(["angebote:entwuerfe"]);
    const before = schemas.quoteSchema.parse((await call(t, "GET", `/angebote/${created.id}`)).json);
    // 760 € abzüglich 10 % in der Position und 60 € auf alles
    expect(before.net).toBe(62_400);

    const noted = await call(t, "PATCH", `/angebote/${created.id}`, { note: "Preise netto ab Werk." });
    expect(noted.status).toBe(200);
    expect(schemas.quoteSchema.parse(noted.json)).toMatchObject({ note: "Preise netto ab Werk.", net: 62_400, gross: before.gross, validUntil: "2099-12-31" });

    const relined = await call(t, "PATCH", `/angebote/${created.id}`, {
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    expect(relined.status).toBe(200);
    // Die neue Position trägt keinen Rabatt, der Gesamtrabatt von 60 € bleibt
    expect(schemas.quoteSchema.parse(relined.json)).toMatchObject({ net: 94_000, tax: 17_860, gross: 111_860, note: "Preise netto ab Werk." });
    const stored = (await rechnungen.getQuote(created.id))!;
    expect(stored.quote).toMatchObject({
      discountAmount: 6_000,
      paymentPlan: [expect.objectContaining({ label: "Anzahlung" }), expect.objectContaining({ label: "Rest" })],
    });
    expect(stored.lines).toEqual([expect.objectContaining({ description: "Beratung", discountPercent: null, discountAmount: null })]);
  });

  it("PATCH lässt jedes ungenannte Feld des Entwurfs stehen, auch die, die nur Haben setzt (quoteDraftInputOf)", async () => {
    const mara = await stammdaten.createContactPerson(actor, contactId, { name: "Mara Beispiel" });
    const created = await rechnungen.createQuoteDraft(
      actor,
      draft({
        contactPersonId: mara,
        serviceFrom: "2026-11-02",
        serviceTo: "2026-11-27",
        intro: "Wie besprochen:",
        note: "Preise ab Werk.",
        buyerOrderReference: "B-4711",
        sellerOrderReference: "A-12",
        despatchAdviceReference: "L-3",
        taxDetails: { exemption: null, ancillary: null, foreignPlace: null, assetDisposal: true },
        priceMode: "brutto",
        language: "en",
        discount: { kind: "prozent", value: 500 },
        paymentPlan: [
          { label: "Anzahlung", share: { kind: "prozent", value: 3000 }, due: "Auftragserteilung" },
          { label: "Rest", share: { kind: "rest" }, due: "Abnahme" },
        ],
        paymentPlanInConfirmation: true,
        lines: [line({ detail: "Vor Ort beim Kunden", itemNumber: "WS-8", arbeitskosten: true, discount: { kind: "prozent", value: 1000 } }), optional],
      }) as never,
    );
    const before = (await rechnungen.getQuote(created.id))!;
    const t = await token(["angebote:entwuerfe"]);

    expect((await call(t, "PATCH", `/angebote/${created.id}`, { intro: "Wie am Telefon besprochen:" })).status).toBe(200);
    const after = (await rechnungen.getQuote(created.id))!;
    const { updatedAt: _updatedAt, ...kept } = before.quote;
    expect(after.quote).toEqual({ ...kept, intro: "Wie am Telefon besprochen:", updatedAt: expect.any(Date) });
    // updateQuoteDraft schreibt die Positionen neu, mit neuen IDs
    const withoutId = ({ id: _id, ...rest }: (typeof before.lines)[number]) => rest;
    expect(after.lines.map(withoutId)).toEqual(before.lines.map(withoutId));
    // Ein Feld, das quoteDraftInputOf nicht mitnimmt, setzte jeder PATCH still auf seine Vorgabe zurück
    const input = rechnungen.quoteDraftInputOf(after.quote, after.lines);
    expect(Object.keys(input).sort()).toEqual(Object.keys(rechnungen.quoteDraftSchema.shape).sort());
    expect(Object.keys(input.lines[0]!).sort()).toEqual(Object.keys(rechnungen.quoteDraftSchema.shape.lines.element.shape).sort());
  });

  it("passen Gesamtrabatt oder Zahlungsplan aus Haben nicht zu den neuen Positionen, antwortet PATCH mit 409 und der Entwurf bleibt", async () => {
    const t = await token(["angebote:entwuerfe"]);
    const smaller = { lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 5_000, taxRate: 1900 }] };
    const withDiscount = await rechnungen.createQuoteDraft(actor, draft({ discount: { kind: "betrag", value: 6_000 } }) as never);
    const withPlan = await rechnungen.createQuoteDraft(
      actor,
      draft({
        paymentPlan: [
          { label: "Anzahlung", share: { kind: "betrag", value: 50_000 }, due: "Auftragserteilung" },
          { label: "Rest", share: { kind: "rest" }, due: "Abnahme" },
        ],
      }) as never,
    );

    for (const [quote, field] of [
      [withDiscount, "discount"],
      [withPlan, "paymentPlan"],
    ] as const) {
      const result = await call(t, "PATCH", `/angebote/${quote.id}`, smaller);
      expect(result.status, JSON.stringify(result.json)).toBe(409);
      expect(result.json!.error).toMatchObject({ code: "conflict", message: expect.stringMatching(/in Haben/) });
      expect(result.json!.error!.issues!.map((issue) => issue.path)).toEqual([field]);
      expect((await rechnungen.getQuote(quote.id))!.lines).toEqual([expect.objectContaining({ description: "Workshop Architektur" })]);
    }
  });

  it("wechselt der Kunde, entfällt der Ansprechpartner; ohne Wechsel bleibt er, auch mit der UUID in Großbuchstaben", async () => {
    const mara = await stammdaten.createContactPerson(actor, contactId, { name: "Mara Beispiel" });
    const other = await stammdaten.createContact(actor, { ...contactDefaults, name: "Südhafen Logistik GmbH" });
    const created = await rechnungen.createQuoteDraft(actor, draft({ contactPersonId: mara }) as never);
    const t = await token(["angebote:entwuerfe"]);

    expect((await call(t, "PATCH", `/angebote/${created.id}`, { intro: "Wie besprochen:" })).status).toBe(200);
    expect((await rechnungen.getQuote(created.id))!.quote.contactPersonId).toBe(mara);
    // Zod nimmt die UUID auch in Großbuchstaben an, Postgres liefert sie klein: derselbe Kunde
    expect((await call(t, "PATCH", `/angebote/${created.id}`, { contactId: contactId.toUpperCase() })).status).toBe(200);
    expect((await rechnungen.getQuote(created.id))!.quote.contactPersonId).toBe(mara);
    expect((await call(t, "PATCH", `/angebote/${created.id}`, { contactId: other.id })).status).toBe(200);
    expect((await rechnungen.getQuote(created.id))!.quote).toMatchObject({ contactId: other.id, contactPersonId: null });
  });

  it("weist unbekannte Kontakte und Kontakte ohne die Rolle Kunde ab; der Entwurf behält seinen Kunden", async () => {
    const lieferant = await stammdaten.createContact(actor, { ...contactDefaults, name: "Großhandel Papier GmbH", isCustomer: false, isSupplier: true });
    const t = await token(["angebote:entwuerfe"]);

    const supplier = await call(t, "POST", "/angebote", { contactId: lieferant.id, lines: [line()] });
    expect(supplier.status).toBe(422);
    expect(supplier.json!.error!.message).toMatch(/Großhandel Papier GmbH“ ist kein Kunde/);
    const unknown = await call(t, "POST", "/angebote", { contactId: crypto.randomUUID(), lines: [line()] });
    expect(unknown.status).toBe(422);
    expect(unknown.json!.error!.message).toMatch(/Kontakt nicht gefunden/);
    expect(await sql`select id from quotes`).toHaveLength(0);

    const created = (await call(t, "POST", "/angebote", { contactId, lines: [line()] })).json!;
    const patch = await call(t, "PATCH", `/angebote/${created.id}`, { contactId: lieferant.id });
    expect(patch.status).toBe(422);
    expect(patch.json!.error!.message).toMatch(/ist kein Kunde/);
    expect((await call(t, "GET", `/angebote/${created.id}`)).json).toMatchObject({ contactId });
  });

  it("ändert und löscht nur Entwürfe; festgeschriebene Angebote lassen sich lesen, aber nicht ändern oder löschen", async () => {
    const t = await token(["angebote:entwuerfe"]);
    const created = (await call(t, "POST", "/angebote", { contactId, lines: [line()] })).json!;
    const final = await rechnungen.finalizeQuote(actor, created.id as string);

    const read = await call(t, "GET", `/angebote/${created.id}`);
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({ status: "final", number: final.number });
    const locked = await call(t, "PATCH", `/angebote/${created.id}`, { note: "geändert" });
    expect(locked.status).toBe(409);
    expect(locked.json!.error).toMatchObject({ code: "conflict", message: expect.stringMatching(/festgeschrieben/) });
    expect((await call(t, "DELETE", `/angebote/${created.id}`)).status).toBe(409);
    expect((await rechnungen.getQuote(created.id as string))!.quote.note).toBe("");

    const other = (await call(t, "POST", "/angebote", { contactId, lines: [line()] })).json!;
    const deleted = await call(t, "DELETE", `/angebote/${other.id}`);
    expect(deleted.status).toBe(204);
    expect(deleted.json).toBeNull();
    expect((await call(t, "GET", `/angebote/${other.id}`)).status).toBe(404);
    expect((await call(t, "PATCH", `/angebote/${other.id}`, { note: "x" })).status).toBe(404);
    expect((await call(t, "DELETE", `/angebote/${other.id}`)).status).toBe(404);
  });

  it("lehnt Felder der Oberfläche und ungültige Angebote mit 400 ab, ohne etwas anzulegen", async () => {
    const t = await token(["angebote:entwuerfe"]);
    const rejected = async (body: unknown, method = "POST", path = "/angebote") => {
      const result = await call(t, method, path, body);
      expect(result.status, JSON.stringify(result.json)).toBe(400);
      return result.json!.error!.issues!.map((issue) => issue.path);
    };
    await rejected({ contactId, lines: [line()], discount: { kind: "prozent", value: 1000 } });
    await rejected({ contactId, lines: [line()], paymentPlan: [] });
    await rejected({ contactId, lines: [line({ discount: { kind: "prozent", value: 1000 } })] });
    await rejected({ contactId, lines: [] });
    await rejected({ contactId, lines: [line({ kind: "bonus" })] });
    expect(await rejected({ contactId, issueDate: "2027-03-01", validUntil: "2027-02-28", lines: [line()] })).toEqual(["validUntil"]);
    // Eine Alternative braucht ihre Hauptposition direkt darüber, und eine Position muss zur Summe zählen
    expect(await rejected({ contactId, lines: [line({ kind: "alternative" })] })).toEqual(["lines"]);
    expect(await rejected({ contactId, lines: [optional] })).toEqual(["lines"]);
    expect(await sql`select id from quotes`).toHaveLength(0);

    const created = (await call(t, "POST", "/angebote", { contactId, issueDate: "2027-03-01", lines: [line()] })).json!;
    expect(await rejected({ issueDate: "2027-05-01" }, "PATCH", `/angebote/${created.id}`)).toEqual(["validUntil"]);
    await rejected({ contactPersonId: crypto.randomUUID() }, "PATCH", `/angebote/${created.id}`);
  });

  it("verlangt angebote:entwuerfe zum Schreiben; es schließt angebote:lesen ein, Rechnungsrechte reichen nicht", async () => {
    const lesen = await token(["angebote:lesen"]);
    const entwuerfe = await token(["angebote:entwuerfe"]);
    const rechnungenEntwuerfe = await token(["rechnungen:entwuerfe"]);
    const created = (await call(entwuerfe, "POST", "/angebote", { contactId, lines: [line()] })).json!;

    expect((await call(lesen, "GET", `/angebote/${created.id}`)).status).toBe(200);
    expect((await call(lesen, "POST", "/angebote", { contactId, lines: [line()] })).status).toBe(403);
    expect((await call(lesen, "PATCH", `/angebote/${created.id}`, { note: "x" })).status).toBe(403);
    expect((await call(lesen, "DELETE", `/angebote/${created.id}`)).status).toBe(403);
    expect((await call(entwuerfe, "GET", "/angebote")).status).toBe(200);
    expect((await call(entwuerfe, "GET", "/rechnungen")).status).toBe(403);
    expect((await call(rechnungenEntwuerfe, "POST", "/angebote", { contactId, lines: [line()] })).status).toBe(403);
  });

  it("schreibt das Token als Akteur ins Änderungsprotokoll", async () => {
    const t = await token(["angebote:entwuerfe"]);
    const created = (await call(t, "POST", "/angebote", { contactId, lines: [line()] })).json!;
    await call(t, "PATCH", `/angebote/${created.id}`, { note: "Neu" });
    const tokenId = (await mcp.listMcpTokens())[0]!.id;
    const rows =
      await sql`select action from audit_log where table_name = 'quotes' and row_id = ${created.id as string} and actor = ${`api:${tokenId}:Angebotsassistent`}`;
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(["INSERT", "UPDATE"]));
  });
});
