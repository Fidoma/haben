import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../../test-db.ts";
import { tourismCountries, tourismCountryKey } from "./catalog.ts";

describe.skipIf(!testDatabaseUrl)("PMS-Tourismusstatistik (Postgres)", () => {
  let reports: typeof import("./reports.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    reports = await import("./reports.ts");
  }, 30_000);
  afterAll(async () => sql?.end());
  beforeEach(async () => {
    await leeren(sql)`truncate pms_tourism_country_values, pms_tourism_reports, pms_reservation_items, pms_reservations, pms_rooms, contacts cascade`;
  });

  it("belegt den Monat aus aktiven Aufenthalten und dem Wohnsitzland vor", async () => {
    const [room] = await sql`insert into pms_rooms (number, capacity) values ('101', 2) returning id`;
    const [contact] = await sql`insert into contacts (name, land) values ('Gast', 'DE') returning id`;
    const [reservation] =
      await sql`insert into pms_reservations (room_id, contact_id, arrival_date, departure_date) values (${room!.id}, ${contact!.id}, '2027-01-30', '2027-02-03') returning id`;
    await sql`insert into pms_reservation_items (reservation_id, position, room_id, arrival_date, departure_date) values (${reservation!.id}, 1, ${room!.id}, '2027-01-30', '2027-02-03')`;
    const january = await reports.prefillTourismReport(2027, 1);
    const february = await reports.prefillTourismReport(2027, 2);
    expect(january).toMatchObject({ bedsOffered: 2, availableGuestRoomDays: 31, occupiedGuestRoomDays: 2 });
    expect(january.values.find((row) => row.countryKey === "germany")).toMatchObject({ arrivals: 1, overnightStays: 2 });
    expect(february.values.find((row) => row.countryKey === "germany")).toMatchObject({ arrivals: 0, overnightStays: 2 });
  });

  it("ordnet ISO-Codes und gebräuchliche Ländernamen den HOTE-Gruppen zu", () => {
    expect(tourismCountryKey("AE")).toBe("gulf_states");
    expect(tourismCountryKey("MA")).toBe("other_africa");
    expect(tourismCountryKey("Vereinigtes Königreich")).toBe("united_kingdom");
    expect(tourismCountryKey("unbekannt")).toBe("not_specified");
  });

  it("zählt denselben belegten Zimmertag auch bei doppelten Positionen nur einmal", async () => {
    const [room] = await sql`insert into pms_rooms (number, capacity) values ('101', 2) returning id`;
    const [contact] = await sql`insert into contacts (name, land) values ('Gast', 'DE') returning id`;
    const [reservation] =
      await sql`insert into pms_reservations (room_id, contact_id, arrival_date, departure_date) values (${room!.id}, ${contact!.id}, '2027-01-10', '2027-01-12') returning id`;
    await sql`insert into pms_reservation_items (reservation_id, position, room_id, arrival_date, departure_date) values (${reservation!.id}, 1, ${room!.id}, '2027-01-10', '2027-01-12'), (${reservation!.id}, 2, ${room!.id}, '2027-01-10', '2027-01-12')`;

    const report = await reports.prefillTourismReport(2027, 1);
    expect(report.occupiedGuestRoomDays).toBe(2);
    expect(report.values.find((row) => row.countryKey === "germany")).toMatchObject({ arrivals: 2, overnightStays: 4 });
  });

  it("speichert genau einen Monatsbericht mit Audit", async () => {
    const input = await reports.prefillTourismReport(2027, 1);
    const first = await reports.saveTourismReport("user-1", input);
    const second = await reports.saveTourismReport("user-1", { ...input, remarks: "Geprüft" });
    expect(second.id).toBe(first.id);
    expect((await reports.getTourismReport(2027, 1))?.values).toHaveLength(54);
    const [audit] = await sql`select actor from audit_log where table_name = 'pms_tourism_reports' and row_id = ${first.id} order by id desc limit 1`;
    expect(audit?.actor).toBe("user-1");
  });

  it("exportiert 116 Felder mit Kopfzeile, CRLF und Windows-1252", async () => {
    const input = { ...(await reports.prefillTourismReport(2027, 1)), remarks: "Geöffnet" };
    const content = reports.tourismReportCsv(input, true);
    const text = Buffer.from(content).toString("latin1");
    const lines = text.split("\r\n");
    expect(lines[0]?.split(";")).toHaveLength(116);
    expect(lines[1]?.split(";")).toHaveLength(116);
    expect(content).toContain(0xf6);
    expect(tourismCountries).toHaveLength(54);
  });

  it("weist unplausible Länderwerte zurück", async () => {
    const input = await reports.prefillTourismReport(2027, 1);
    input.values[0] = { ...input.values[0]!, arrivals: 2, overnightStays: 1 };
    await expect(reports.saveTourismReport("user-1", input)).rejects.toThrow("Übernachtungen");
  });
});
