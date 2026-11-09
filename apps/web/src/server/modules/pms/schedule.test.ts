import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("PMS-Belegungsplan (Postgres)", () => {
  let schedule: typeof import("./schedule.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    schedule = await import("./schedule.ts");
  }, 30_000);

  afterAll(async () => sql?.end());

  beforeEach(async () => {
    await sql`truncate pms_reservation_items, pms_reservations, pms_rooms, contacts, invoices cascade`;
  });

  async function room(number: string, archived = false) {
    const [row] = await sql`insert into pms_rooms (number, archived_at) values (${number}, ${archived ? "2026-11-09T12:00:00Z" : null}) returning id`;
    return row!.id as string;
  }

  async function contact(name: string) {
    const [row] = await sql`insert into contacts (name) values (${name}) returning id`;
    return row!.id as string;
  }

  async function reservation(contactId: string, items: Array<{ roomId: string; arrival: string; departure: string }>, canceled = false) {
    const first = items[0]!;
    const [head] = await sql`
      insert into pms_reservations (room_id, contact_id, arrival_date, departure_date, status, canceled_at)
      values (${first.roomId}, ${contactId}, ${first.arrival}, ${first.departure}, ${canceled ? "canceled" : "confirmed"},
              ${canceled ? "2026-11-09T12:00:00Z" : null}) returning id
    `;
    for (const [index, item] of items.entries()) {
      await sql`
        insert into pms_reservation_items (reservation_id, position, room_id, arrival_date, departure_date, canceled_at)
        values (${head!.id}, ${index + 1}, ${item.roomId}, ${item.arrival}, ${item.departure}, ${canceled ? "2026-11-09T12:00:00Z" : null})
      `;
    }
    return head!.id as string;
  }

  it("liefert aktive Zimmer natürlich sortiert und nur überlappende Positionen", async () => {
    const room10 = await room("10");
    const room2 = await room("2");
    const guest = await contact("Erika Muster");
    await reservation(guest, [
      { roomId: room10, arrival: "2027-01-10", departure: "2027-01-12" },
      { roomId: room2, arrival: "2027-01-12", departure: "2027-01-15" },
    ]);
    await reservation(guest, [{ roomId: room2, arrival: "2027-02-01", departure: "2027-02-03" }]);

    const result = await schedule.reservationSchedule("2027-01-12", "2027-01-20", "2027-01-12");
    expect(result.days).toBe(8);
    expect(result.rooms.map((candidate) => candidate.number)).toEqual(["2", "10"]);
    expect(result.events).toMatchObject([{ roomId: room2, arrivalDate: "2027-01-12", departureDate: "2027-01-15", contactName: "Erika Muster" }]);
  });

  it("zeigt archivierte Zimmer nur mit Belegung und kennzeichnet Stornos", async () => {
    const archivedOccupied = await room("20", true);
    await room("21", true);
    const guest = await contact("Gast");
    await reservation(guest, [{ roomId: archivedOccupied, arrival: "2027-01-10", departure: "2027-01-12" }], true);

    const result = await schedule.reservationSchedule("2027-01-01", "2027-02-01", "2027-01-10");
    expect(result.rooms).toMatchObject([{ id: archivedOccupied, archived: true }]);
    expect(result.events).toMatchObject([{ reservationStatus: "canceled", reservationStatusLabel: "Storniert", billingStatus: "none" }]);
  });

  it("begrenzt den Zeitraum auf 366 Tage", async () => {
    await expect(schedule.reservationSchedule("2027-01-01", "2028-01-03", "2027-01-01")).rejects.toThrow("höchstens 366 Tage");
    expect(schedule.defaultScheduleRange("2027-01-10")).toEqual({ startDate: "2026-12-09", endDate: "2027-03-09" });
  });
});
