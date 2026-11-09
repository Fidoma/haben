import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("PMS-Housekeeping (Postgres)", () => {
  let housekeeping: typeof import("./housekeeping.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    housekeeping = await import("./housekeeping.ts");
  }, 30_000);
  afterAll(async () => sql?.end());

  beforeEach(async () => {
    await sql`truncate pms_reservation_items, pms_reservations, pms_rooms, contacts cascade`;
  });

  async function stay(status: "confirmed" | "canceled" = "confirmed") {
    const [room] = await sql`insert into pms_rooms (number) values (${crypto.randomUUID()}) returning id`;
    const [contact] = await sql`insert into contacts (name) values ('Gast') returning id`;
    const canceledAt = status === "canceled" ? "2027-01-01T12:00:00Z" : null;
    const [reservation] = await sql`
      insert into pms_reservations (room_id, contact_id, arrival_date, departure_date, status, canceled_at)
      values (${room!.id}, ${contact!.id}, '2027-01-01', '2027-01-03', ${status}, ${canceledAt}) returning id
    `;
    const [item] = await sql`
      insert into pms_reservation_items (reservation_id, position, room_id, arrival_date, departure_date, canceled_at)
      values (${reservation!.id}, 1, ${room!.id}, '2027-01-01', '2027-01-03', ${canceledAt}) returning id
    `;
    return { roomId: room!.id as string, itemId: item!.id as string };
  }

  it("schaltet den Reinigungsstatus manuell mit Audit um", async () => {
    const { roomId } = await stay();
    await housekeeping.setCleaningStatus("user-1", roomId, "dirty");
    expect((await housekeeping.listHousekeepingRooms())[0]).toMatchObject({ id: roomId, cleaningStatus: "dirty" });
    const [audit] = await sql`select actor from audit_log where table_name = 'pms_rooms' and row_id = ${roomId} order by id desc limit 1`;
    expect(audit?.actor).toBe("user-1");
  });

  it("verarbeitet Abreisen erst ab 07:00 Uhr, nur einmal und ignoriert Stornos", async () => {
    const active = await stay();
    const canceled = await stay("canceled");
    expect(await housekeeping.runDueHousekeeping(new Date("2027-01-03T05:59:00Z"), "Europe/Berlin")).toEqual({ processed: 0 });
    expect(await housekeeping.runDueHousekeeping(new Date("2027-01-03T06:00:00Z"), "Europe/Berlin")).toEqual({ processed: 1 });
    expect(await housekeeping.runDueHousekeeping(new Date("2027-01-03T08:00:00Z"), "Europe/Berlin")).toEqual({ processed: 0 });
    const rooms = await housekeeping.listHousekeepingRooms();
    expect(rooms.find((room) => room.id === active.roomId)?.cleaningStatus).toBe("dirty");
    expect(rooms.find((room) => room.id === canceled.roomId)?.cleaningStatus).toBe("clean");
    const [item] = await sql`select dirty_processed_at from pms_reservation_items where id = ${active.itemId}`;
    expect(item?.dirty_processed_at).toBeTruthy();
  });
});
