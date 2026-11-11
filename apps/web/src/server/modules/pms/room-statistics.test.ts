import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("PMS-Zimmerstatistik (Postgres)", () => {
  let statistics: typeof import("./room-statistics.ts");
  let sql: postgres.Sql;
  let invoiceNumber = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    statistics = await import("./room-statistics.ts");
  }, 30_000);

  afterAll(async () => sql?.end());

  beforeEach(async () => {
    await leeren(sql)`truncate pms_reservation_items, pms_reservations, pms_rooms, contacts, invoice_lines, invoices cascade`;
    invoiceNumber = 0;
  });

  async function room(number: string) {
    const [row] = await sql`insert into pms_rooms (number) values (${number}) returning id`;
    return row!.id as string;
  }

  async function contact(name: string) {
    const [row] = await sql`insert into contacts (name) values (${name}) returning id`;
    return row!.id as string;
  }

  async function invoice(amounts: number[], correctsId: string | null = null) {
    invoiceNumber += 1;
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const kind = correctsId ? "storno" : "rechnung";
    const [row] = await sql`
      insert into invoices (kind, status, issue_date, due_date, net, gross, corrects_id)
      values (${kind}, 'draft', '2026-01-01', '2026-01-15', ${total}, ${total}, ${correctsId}) returning id
    `;
    for (const [index, amount] of amounts.entries()) {
      await sql`
        insert into invoice_lines (invoice_id, position, description, quantity, unit, unit_price, tax_rate, net)
        values (${row!.id}, ${index + 1}, 'Übernachtung', 1000, 'Tag', ${Math.abs(amount)}, 0, ${amount})
      `;
    }
    await sql`update invoices set status = 'final', number = ${`STAT-${invoiceNumber}`}, locked_at = now() where id = ${row!.id}`;
    return row!.id as string;
  }

  async function reservation(
    contactId: string,
    items: Array<{ roomId: string; arrival: string; departure: string }>,
    options: { canceled?: boolean; invoiceId?: string | null } = {},
  ) {
    const first = items[0]!;
    const [head] = await sql`
      insert into pms_reservations (room_id, contact_id, invoice_id, arrival_date, departure_date, status, canceled_at)
      values (${first.roomId}, ${contactId}, ${options.invoiceId ?? null}, ${first.arrival}, ${first.departure},
              ${options.canceled ? "canceled" : "confirmed"}, ${options.canceled ? "2026-03-01T12:00:00Z" : null}) returning id
    `;
    for (const [index, item] of items.entries()) {
      await sql`
        insert into pms_reservation_items (reservation_id, position, room_id, arrival_date, departure_date, canceled_at)
        values (${head!.id}, ${index + 1}, ${item.roomId}, ${item.arrival}, ${item.departure},
                ${options.canceled ? "2026-03-01T12:00:00Z" : null})
      `;
    }
    return head!.id as string;
  }

  it("berechnet Nächte und festgeschriebenen Umsatz innerhalb eines Monats", async () => {
    const roomId = await room("101");
    const guest = await contact("Erika Muster");
    await reservation(guest, [{ roomId, arrival: "2026-01-10", departure: "2026-01-13" }], { invoiceId: await invoice([30_000]) });

    const result = await statistics.roomStatistics(roomId, "current-year", "2026-04-01");
    expect(result).toMatchObject({ revenue: 30_000, occupiedNights: 3, availableNights: 90, canceledReservations: 0, adr: 10_000 });
    expect(result!.topCustomers).toMatchObject([{ name: "Erika Muster", nights: 3, revenue: 30_000 }]);
  });

  it("verteilt Nächte und Umsatz centgenau über Monats- und Jahresgrenzen", async () => {
    const roomId = await room("101");
    const guest = await contact("Gast");
    await reservation(guest, [{ roomId, arrival: "2025-12-30", departure: "2026-01-03" }], { invoiceId: await invoice([40_001]) });

    const lastYear = await statistics.roomStatistics(roomId, "last-year", "2026-11-10");
    const currentYear = await statistics.roomStatistics(roomId, "current-year", "2026-11-10");
    expect(lastYear).toMatchObject({ revenue: 20_001, occupiedNights: 2 });
    expect(currentYear).toMatchObject({ revenue: 20_000, occupiedNights: 2 });
  });

  it("zählt Stornos nicht als Belegung und weist ihre Quote aus", async () => {
    const roomId = await room("101");
    const guest = await contact("Gast");
    await reservation(guest, [{ roomId, arrival: "2026-02-01", departure: "2026-02-04" }], { canceled: true });

    const result = await statistics.roomStatistics(roomId, "current-year", "2026-04-01");
    expect(result).toMatchObject({ revenue: 0, occupiedNights: 0, canceledReservations: 1, cancellationBasisPoints: 10_000 });
  });

  it("ordnet bei Mehrzimmerreservierungen nur die passende Rechnungsposition zu", async () => {
    const firstRoom = await room("101");
    const secondRoom = await room("102");
    const guest = await contact("Gast");
    await reservation(
      guest,
      [
        { roomId: firstRoom, arrival: "2026-02-01", departure: "2026-02-03" },
        { roomId: secondRoom, arrival: "2026-02-01", departure: "2026-02-04" },
      ],
      { invoiceId: await invoice([20_000, 45_000]) },
    );

    expect(await statistics.roomStatistics(firstRoom, "current-year", "2026-04-01")).toMatchObject({ revenue: 20_000, occupiedNights: 2 });
    expect(await statistics.roomStatistics(secondRoom, "current-year", "2026-04-01")).toMatchObject({ revenue: 45_000, occupiedNights: 3 });
  });

  it("liefert für Zimmer ohne Reservierungen einen leeren, endlichen Zeitraum", async () => {
    const result = await statistics.roomStatistics(await room("101"), "all", "2026-04-01");
    expect(result).toMatchObject({ revenue: 0, occupiedNights: 0, availableNights: 0, revenueSeries: [] });
  });

  it("summiert mehrere Rechnungen und berücksichtigt festgeschriebene Stornos", async () => {
    const roomId = await room("101");
    const firstGuest = await contact("Erster Gast");
    const secondGuest = await contact("Zweiter Gast");
    const firstInvoice = await invoice([20_000]);
    await invoice([-20_000], firstInvoice);
    await reservation(firstGuest, [{ roomId, arrival: "2026-01-01", departure: "2026-01-03" }], { invoiceId: firstInvoice });
    await reservation(secondGuest, [{ roomId, arrival: "2026-02-01", departure: "2026-02-03" }], { invoiceId: await invoice([30_000]) });

    expect(await statistics.roomStatistics(roomId, "current-year", "2026-04-01")).toMatchObject({ revenue: 30_000, occupiedNights: 4 });
  });

  it("erfindet bei fehlender eindeutiger Umsatzzuordnung keinen Betrag", async () => {
    const firstRoom = await room("101");
    const secondRoom = await room("102");
    const guest = await contact("Gast");
    await reservation(
      guest,
      [
        { roomId: firstRoom, arrival: "2026-02-01", departure: "2026-02-03" },
        { roomId: secondRoom, arrival: "2026-02-01", departure: "2026-02-03" },
      ],
      { invoiceId: await invoice([25_000]) },
    );

    expect(await statistics.roomStatistics(firstRoom, "current-year", "2026-04-01")).toMatchObject({ revenue: 0, unattributedReservations: 1 });
  });

  it("aggregiert Umsatz und Zimmernächte aller aktiven Zimmer", async () => {
    const firstRoom = await room("101");
    const secondRoom = await room("102");
    const guest = await contact("Hotelgast");
    await reservation(
      guest,
      [
        { roomId: firstRoom, arrival: "2026-02-01", departure: "2026-02-03" },
        { roomId: secondRoom, arrival: "2026-02-01", departure: "2026-02-04" },
      ],
      { invoiceId: await invoice([20_000, 45_000]) },
    );

    const result = await statistics.hotelStatistics("current-year", "2026-04-01");
    expect(result).toMatchObject({ activeRooms: 2, revenue: 65_000, occupiedNights: 5, availableNights: 180, adr: 13_000 });
    expect(result.topRooms).toMatchObject([
      { number: "102", nights: 3, revenue: 45_000 },
      { number: "101", nights: 2, revenue: 20_000 },
    ]);
    expect(result.topCustomers).toMatchObject([{ name: "Hotelgast", nights: 5, revenue: 65_000 }]);
  });

  it("zählt eine stornierte Mehrzimmerreservierung in der Hotelstatistik nur einmal", async () => {
    const firstRoom = await room("101");
    const secondRoom = await room("102");
    const guest = await contact("Stornogast");
    await reservation(
      guest,
      [
        { roomId: firstRoom, arrival: "2026-02-01", departure: "2026-02-03" },
        { roomId: secondRoom, arrival: "2026-02-01", departure: "2026-02-03" },
      ],
      { canceled: true },
    );

    expect(await statistics.hotelStatistics("current-year", "2026-04-01")).toMatchObject({
      occupiedNights: 0,
      canceledReservations: 1,
      cancellationBasisPoints: 10_000,
    });
  });
});
