import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

describe.skipIf(!testDatabaseUrl)("REST-API für wiederkehrende Vorlagen (#1899)", () => {
  let api: typeof import("./index.ts");
  type Scope = import("../mcp/index.ts").TokenScope;
  let mcp: typeof import("../mcp/index.ts");
  let rechnungen: typeof import("../rechnungen/index.ts");
  let sql: postgres.Sql;
  let createToken: string;
  let editToken: string;
  let contactId: string;
  const actor = "test-user";
  const collection = "/rechnungen/wiederkehrend";
  const path = (id: string) => `${collection}/${id}`;

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into "user"(id,name,email,role) values (${actor}, 'Testinhaber', 'inhaber@example.de', 'inhaber')`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
    api = await import("./index.ts");
    mcp = await import("../mcp/index.ts");
    rechnungen = await import("../rechnungen/index.ts");
    await mcp.setMcpEnabled(actor, true);
    const token = async (scopes: Scope[]) => (await mcp.createMcpToken({ name: "Test", days: 30, scopes }, new Date(), actor)).token;
    createToken = await token(["kontakte:schreiben", "rechnungen:vorlagen-anlegen"]);
    editToken = await token(["rechnungen:vorlagen-bearbeiten"]);
    const contact = await call(createToken, "POST", "/kontakte", { name: "Testkunde" });
    expect(contact.status).toBe(201);
    contactId = (await contact.json()).id;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  function call(token: string, method: string, requestPath: string, body?: object) {
    return api.handleApiRequest(
      new Request(`http://localhost:3000/api/v1${requestPath}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  async function create() {
    const response = await call(createToken, "POST", collection, {
      name: "Service",
      contactId,
      nextDate: "2026-01-31",
      recurrence: "P1M",
      note: "Alte Notiz",
      priceMode: "brutto",
      intro: "Alter Kopftext",
      lines: [{ description: "Service", quantity: 1000, unit: "Stk.", unitPrice: 5000, taxRate: 1900 }],
    });
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  }

  it("ändert nur genannte Felder und erhält die in Haben gewählten Einstellungen", async () => {
    const id = await create();
    await sql`update recurring_invoices set mode = 'festschreiben', send_by_mail = true, last_error = 'Letzter Lauf fehlgeschlagen' where id = ${id}`;
    const before = (await rechnungen.getRecurring(id))!.recurring;
    const response = await call(editToken, "PATCH", path(id), { name: "Neuer Name" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, active: false, url: `http://localhost:3000${path(id)}` });
    const after = (await rechnungen.getRecurring(id))!.recurring;
    expect(after).toEqual({ ...before, name: "Neuer Name", updatedAt: after.updatedAt });
    expect(after).toMatchObject({ active: false, mode: "festschreiben", sendByMail: true, priceMode: "brutto", note: "Alte Notiz" });
  });

  it("ersetzt Positionen, kann das Enddatum entfernen und prüft die Daten gemeinsam", async () => {
    const id = await create();
    await sql`update recurring_invoices set end_date = '2026-01-01' where id = ${id}`;
    expect((await call(editToken, "PATCH", path(id), { note: "Erledigt" })).status).toBe(200);
    expect((await call(editToken, "PATCH", path(id), { endDate: "2026-01-30" })).status).toBe(422);
    expect((await call(editToken, "PATCH", path(id), { lines: [] })).status).toBe(400);
    const lines = [{ description: "Neue Position", quantity: 1000, unit: "Stk.", unitPrice: 6000, taxRate: 1900 }];
    expect((await call(editToken, "PATCH", path(id), { endDate: null, lines })).status).toBe(200);
    expect((await rechnungen.getRecurring(id))?.recurring).toMatchObject({ endDate: null, note: "Erledigt", lines });
  });

  it("setzt beim Wechsel von Wochen auf Monate den Ankertag des bestehenden nächsten Termins", async () => {
    const id = await create();
    expect((await call(editToken, "PATCH", path(id), { recurrence: "P1W" })).status).toBe(200);
    await sql`update recurring_invoices set active = true where id = ${id}`;
    expect(await rechnungen.runDueRecurring("2026-01-31", kleinunternehmerStand)).toMatchObject({ created: 1, errors: [] });
    await sql`update recurring_invoices set active = false where id = ${id}`;
    expect((await rechnungen.getRecurring(id))?.recurring.nextDate).toBe("2026-02-07");

    expect((await call(editToken, "PATCH", path(id), { recurrence: "P1M" })).status).toBe(200);
    expect((await rechnungen.getRecurring(id))?.recurring.anchorDay).toBe(7);
  });

  it("schützt aktive Vorlagen und verlangt ein eigenes Recht zum Ändern und Löschen", async () => {
    const id = await create();
    expect((await call(createToken, "PATCH", path(id), { name: "Neu" })).status).toBe(403);
    expect((await call(createToken, "DELETE", path(id))).status).toBe(403);
    expect((await call(editToken, "PATCH", path(id), { active: true })).status).toBe(400);
    expect((await call(editToken, "PATCH", path(id), { sendByMail: true })).status).toBe(400);
    await sql`update recurring_invoices set active = true where id = ${id}`;
    expect((await call(editToken, "PATCH", path(id), { name: "Neu" })).status).toBe(409);
    expect((await rechnungen.getRecurring(id))!.recurring).toMatchObject({ active: true, name: "Service" });
    expect((await call(editToken, "DELETE", path(id))).status).toBe(204);
    expect((await call(editToken, "DELETE", path(id))).status).toBe(404);
    expect((await call(editToken, "PATCH", path(id), { name: "Neu" })).status).toBe(404);
  });

  it("löscht keine Vorlage, aus der schon ein Rechnungsentwurf entstanden ist", async () => {
    const id = await create();
    await sql`update recurring_invoices set active = true where id = ${id}`;
    const run = await rechnungen.runDueRecurring("2026-01-31", kleinunternehmerStand);
    expect(run).toMatchObject({ created: 1, errors: [] });
    expect((await call(editToken, "DELETE", path(id))).status).toBe(409);
    expect((await rechnungen.getRecurring(id))?.invoices).toHaveLength(1);
  });
});
