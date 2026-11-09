import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("PMS-Reservierungen (Postgres)", () => {
  let reservations: typeof import("./reservations.ts");
  let sql: postgres.Sql;
  const actor = "pms-reservierungen-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    reservations = await import("./reservations.ts");
  }, 30_000);

  afterAll(async () => sql?.end());

  beforeEach(async () => {
    await sql`truncate pms_reservation_items, pms_reservations, pms_rooms, contacts, articles cascade`;
  });

  async function room(number = "101", archived = false) {
    const [row] = await sql`insert into pms_rooms (number, archived_at) values (${number}, ${archived ? "2026-11-09T12:00:00Z" : null}) returning id`;
    return row!.id as string;
  }

  async function contact({ customer = true, archived = false, name = " Erika Muster " } = {}) {
    const [row] = await sql`
      insert into contacts (name, is_customer, is_supplier, archived_at)
      values (${name}, ${customer}, ${!customer}, ${archived ? "2026-11-09T12:00:00Z" : null}) returning id
    `;
    return row!.id as string;
  }

  async function article(description = "Übernachtung", unitPrice = 12_500, archived = false) {
    const [row] = await sql`
      insert into articles (description, unit, unit_price, tax_rate, archived_at)
      values (${description}, 'Nacht', ${unitPrice}, 1900, ${archived ? "2026-11-09T12:00:00Z" : null}) returning id
    `;
    return row!.id as string;
  }

  const input = (roomId: string, contactId: string, arrivalDate = "2027-01-10", departureDate = "2027-01-12") => ({
    contactId,
    items: [{ roomId, arrivalDate, departureDate, description: "  Ruhiges Zimmer  " }],
  });

  it("legt mehrere Positionen getrimmt an und listet Zimmer und Kunde", async () => {
    const roomId = await room("101");
    const secondRoomId = await room("102");
    const contactId = await contact({ name: "Erika Muster" });
    const created = await reservations.createReservation(actor, {
      contactId,
      items: [
        input(roomId, contactId).items[0]!,
        { roomId: secondRoomId, arrivalDate: "2027-01-12", departureDate: "2027-01-15", description: "  Mit Balkon  " },
      ],
    });
    expect(created).toMatchObject({ contactId, status: "confirmed", items: [{ description: "Ruhiges Zimmer" }, { description: "Mit Balkon" }] });
    expect(await reservations.listReservations()).toMatchObject([{ contactName: "Erika Muster", items: [{ roomNumber: "101" }, { roomNumber: "102" }] }]);
  });

  it("speichert Artikel und vereinbarten Preis unabhängig vom aktuellen Artikelpreis", async () => {
    const roomId = await room();
    const contactId = await contact();
    const articleId = await article("Doppelzimmer", 15_000);
    const created = await reservations.createReservation(actor, {
      contactId,
      items: [{ ...input(roomId, contactId).items[0]!, articleId, unitPrice: 13_500 }],
    });
    await sql`update articles set unit_price = 18000 where id = ${articleId}`;
    expect(created.items[0]).toMatchObject({ articleId, unitPrice: 13_500 });
    expect((await reservations.listReservations())[0]!.items[0]).toMatchObject({ articleId, articleDescription: "Doppelzimmer", unitPrice: 13_500 });
  });

  it("weist unbekannte und archivierte Artikel ab", async () => {
    const roomId = await room();
    const contactId = await contact();
    const unknown = "00000000-0000-4000-8000-000000000000";
    await expect(
      reservations.createReservation(actor, { contactId, items: [{ ...input(roomId, contactId).items[0]!, articleId: unknown, unitPrice: 1000 }] }),
    ).rejects.toThrow("Artikel nicht gefunden");
    await expect(
      reservations.createReservation(actor, {
        contactId,
        items: [{ ...input(roomId, contactId).items[0]!, articleId: await article("Alt", 1000, true), unitPrice: 1000 }],
      }),
    ).rejects.toThrow("Artikel ist archiviert");
  });

  it("verlangt ein aktives Zimmer und einen aktiven Kunden", async () => {
    const customerId = await contact();
    await expect(reservations.createReservation(actor, input(await room("1", true), customerId))).rejects.toThrow("Das Zimmer ist archiviert.");
    await expect(reservations.createReservation(actor, input(await room("2"), await contact({ customer: false })))).rejects.toThrow("keine Kundenrolle");
    await expect(reservations.createReservation(actor, input(await room("3"), await contact({ archived: true })))).rejects.toThrow("Kunde ist archiviert");
  });

  it("weist unbekannte Zimmer und Kontakte als Fachfehler ab", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    await expect(reservations.createReservation(actor, input(unknown, await contact()))).rejects.toThrow("Zimmer nicht gefunden");
    await expect(reservations.createReservation(actor, input(await room(), unknown))).rejects.toThrow("Kontakt nicht gefunden");
  });

  it("weist ungültige Zeiträume und zu lange Beschreibungen ab", async () => {
    const roomId = await room();
    const contactId = await contact();
    await expect(reservations.createReservation(actor, input(roomId, contactId, "2027-01-10", "2027-01-10"))).rejects.toThrow("nach der Anreise");
    await expect(
      reservations.createReservation(actor, { contactId, items: [{ ...input(roomId, contactId).items[0]!, arrivalDate: "2027-02-30" }] }),
    ).rejects.toThrow("gültiges Datum");
    await expect(
      reservations.createReservation(actor, { contactId, items: [{ ...input(roomId, contactId).items[0]!, description: "x".repeat(2001) }] }),
    ).rejects.toThrow("2.000");
    await expect(reservations.createReservation(actor, { contactId, items: [] })).rejects.toThrow("Mindestens eine Position");
  });

  it("erlaubt angrenzende Aufenthalte und gleiche Zeiträume in verschiedenen Zimmern", async () => {
    const firstRoom = await room("1");
    const secondRoom = await room("2");
    const contactId = await contact();
    await reservations.createReservation(actor, input(firstRoom, contactId, "2027-01-10", "2027-01-12"));
    await reservations.createReservation(actor, input(firstRoom, contactId, "2027-01-12", "2027-01-14"));
    await reservations.createReservation(actor, input(secondRoom, contactId, "2027-01-10", "2027-01-12"));
    expect(await reservations.listReservations()).toHaveLength(3);
  });

  it("verhindert Überschneidungen und parallele Doppelbelegung", async () => {
    const roomId = await room();
    const contactId = await contact();
    await reservations.createReservation(actor, input(roomId, contactId));
    await expect(reservations.createReservation(actor, input(roomId, contactId, "2027-01-11", "2027-01-13"))).rejects.toThrow(
      "Das Zimmer ist in diesem Zeitraum bereits reserviert.",
    );
    await sql`truncate pms_reservation_items, pms_reservations`;
    const outcomes = await Promise.allSettled([
      reservations.createReservation(actor, input(roomId, contactId)),
      reservations.createReservation(actor, input(roomId, contactId)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  });

  it("berücksichtigt beim Bearbeiten die eigene Reservierung nicht als Konflikt", async () => {
    const roomId = await room();
    const contactId = await contact();
    const created = await reservations.createReservation(actor, input(roomId, contactId));
    const updated = await reservations.updateReservation(actor, created.id, input(roomId, contactId, "2027-01-11", "2027-01-13"));
    expect(updated.items[0]!.arrivalDate).toBe("2027-01-11");
  });

  it("erlaubt dasselbe Zimmer im selben Zeitraum mehrfach innerhalb einer Reservierung", async () => {
    const roomId = await room();
    const contactId = await contact();
    const created = await reservations.createReservation(actor, {
      contactId,
      items: [input(roomId, contactId).items[0]!, input(roomId, contactId).items[0]!],
    });
    expect(created.items).toHaveLength(2);
  });

  it("storniert dauerhaft und gibt den Zeitraum wieder frei", async () => {
    const roomId = await room();
    const contactId = await contact();
    const created = await reservations.createReservation(actor, input(roomId, contactId));
    await reservations.cancelReservation(actor, created.id);
    await reservations.createReservation(actor, input(roomId, contactId));
    await expect(reservations.updateReservation(actor, created.id, input(roomId, contactId))).rejects.toThrow("stornierte Reservierung");
    await expect(reservations.cancelReservation(actor, created.id)).rejects.toThrow("stornierte Reservierung");
  });

  it("protokolliert Anlage, Änderung und Stornierung mit Akteur", async () => {
    const startId = Number((await sql`select coalesce(max(id), 0)::int as start_id from audit_log`)[0]!.start_id);
    const roomId = await room();
    const contactId = await contact();
    const created = await reservations.createReservation(actor, input(roomId, contactId));
    await reservations.updateReservation(actor, created.id, {
      contactId,
      items: [{ ...input(roomId, contactId).items[0]!, description: "Geändert" }],
    });
    await reservations.cancelReservation(actor, created.id);
    const log = await sql`select action, actor from audit_log where table_name = 'pms_reservations' and row_id = ${created.id} order by id`;
    expect(log.map((row) => [row.action, row.actor])).toEqual([
      ["INSERT", actor],
      ["UPDATE", actor],
      ["UPDATE", actor],
    ]);
    const itemLog = await sql`select action, actor from audit_log where table_name = 'pms_reservation_items' and id > ${startId} order by id`;
    expect(itemLog.map((row) => [row.action, row.actor])).toEqual([
      ["INSERT", actor],
      ["DELETE", actor],
      ["INSERT", actor],
      ["UPDATE", actor],
    ]);
  });
});
