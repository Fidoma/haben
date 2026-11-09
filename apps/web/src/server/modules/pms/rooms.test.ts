import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("PMS-Zimmer (Postgres)", () => {
  let rooms: typeof import("./rooms.ts");
  let sql: postgres.Sql;
  const actor = "pms-test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    rooms = await import("./rooms.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate pms_rooms cascade`;
  });

  it("legt Zimmer getrimmt an und sortiert Nummern natürlich", async () => {
    await rooms.createRoom(actor, { number: " 10 ", name: " Hofseite ", capacity: 2 });
    const room = await rooms.createRoom(actor, { number: " 2 ", capacity: 1 });

    expect(room).toMatchObject({ number: "2", name: "", capacity: 1 });
    expect((await rooms.listRooms()).map((row) => row.number)).toEqual(["2", "10"]);
  });

  it("weist ungültige Eingaben und doppelte Nummern ohne Beachtung der Großschreibung ab", async () => {
    await expect(rooms.createRoom(actor, { number: " ", capacity: 1 })).rejects.toThrow(/Zimmernummer/);
    await expect(rooms.createRoom(actor, { number: "x".repeat(51), capacity: 1 })).rejects.toThrow();
    await expect(rooms.createRoom(actor, { number: "101", capacity: 0 })).rejects.toThrow();
    await expect(rooms.createRoom(actor, { number: "101", capacity: 101 })).rejects.toThrow();

    await rooms.createRoom(actor, { number: "A-2", capacity: 2 });
    await expect(rooms.createRoom(actor, { number: "a-2", capacity: 2 })).rejects.toThrow("Diese Zimmernummer gibt es bereits.");
  });

  it("ändert, archiviert, stellt wieder her und protokolliert den Akteur", async () => {
    const room = await rooms.createRoom(actor, { number: "101", name: "Einzelzimmer", capacity: 1 });
    const before = room.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await rooms.updateRoom(actor, room.id, { number: "101", name: "Doppelzimmer", capacity: 2 });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before.getTime());

    await rooms.setRoomArchived(actor, room.id, true);
    expect(await rooms.listRooms()).toEqual([]);
    expect(await rooms.listRooms({ archived: true })).toHaveLength(1);
    await rooms.setRoomArchived(actor, room.id, false);
    expect(await rooms.listRooms()).toHaveLength(1);

    const log = await sql`
      select action, actor from audit_log
      where table_name = 'pms_rooms' and row_id = ${room.id}
      order by id
    `;
    expect(log.map((row) => [row.action, row.actor])).toEqual([
      ["INSERT", actor],
      ["UPDATE", actor],
      ["UPDATE", actor],
      ["UPDATE", actor],
    ]);
  });

  it("meldet unbekannte Zimmer als Fachfehler", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    await expect(rooms.updateRoom(actor, id, { number: "1", capacity: 1 })).rejects.toThrow("Zimmer nicht gefunden.");
    await expect(rooms.setRoomArchived(actor, id, true)).rejects.toThrow("Zimmer nicht gefunden.");
  });
});
