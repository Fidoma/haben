import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../../db/actor.ts";
import { db, schema } from "../../../db/index.ts";
import { UserError } from "../../../errors.ts";
import { tourismCountries, tourismCountryKey } from "./catalog.ts";

export class TourismReportError extends UserError {}

const countryValueSchema = z.object({ countryKey: z.string().min(1).max(50), arrivals: z.number().int().min(0), overnightStays: z.number().int().min(0) });
export const tourismReportInputSchema = z
  .object({
    year: z.number().int().min(2000).max(2200),
    month: z.number().int().min(1).max(12),
    bedsOffered: z.number().int().min(0),
    availableGuestRoomDays: z.number().int().min(0),
    occupiedGuestRoomDays: z.number().int().min(0),
    remarks: z.string().max(1000).default(""),
    values: z.array(countryValueSchema).length(tourismCountries.length),
  })
  .superRefine((value, context) => {
    const keys = new Set(value.values.map((row) => row.countryKey));
    if (keys.size !== tourismCountries.length || tourismCountries.some((country) => !keys.has(country.key)))
      context.addIssue({ code: "custom", message: "Die Wohnsitzpositionen sind unvollständig.", path: ["values"] });
    for (const [index, row] of value.values.entries()) {
      if (row.overnightStays < row.arrivals)
        context.addIssue({ code: "custom", message: "Übernachtungen dürfen nicht unter den Ankünften liegen.", path: ["values", index, "overnightStays"] });
      const maximum = row.countryKey === "germany" ? 999_999 : 99_999;
      if (row.arrivals > maximum || row.overnightStays > maximum)
        context.addIssue({ code: "custom", message: `Der Wert darf höchstens ${maximum} betragen.`, path: ["values", index] });
    }
  });
export type TourismReportInput = z.input<typeof tourismReportInputSchema>;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const monthRange = (year: number, month: number) => ({
  start: `${year}-${String(month).padStart(2, "0")}-01`,
  end: iso(new Date(Date.UTC(year, month, 1))),
  days: new Date(Date.UTC(year, month, 0)).getUTCDate(),
});
const dateDays = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);

export async function prefillTourismReport(year: number, month: number) {
  const period = monthRange(year, month);
  const [rooms, stays] = await Promise.all([
    db.select({ capacity: schema.pmsRooms.capacity }).from(schema.pmsRooms).where(isNull(schema.pmsRooms.archivedAt)),
    db
      .select({
        roomId: schema.pmsReservationItems.roomId,
        arrival: schema.pmsReservationItems.arrivalDate,
        departure: schema.pmsReservationItems.departureDate,
        country: schema.contacts.land,
      })
      .from(schema.pmsReservationItems)
      .innerJoin(schema.pmsReservations, eq(schema.pmsReservationItems.reservationId, schema.pmsReservations.id))
      .innerJoin(schema.contacts, eq(schema.pmsReservations.contactId, schema.contacts.id))
      .where(
        and(
          eq(schema.pmsReservations.status, "confirmed"),
          lt(schema.pmsReservationItems.arrivalDate, period.end),
          gt(schema.pmsReservationItems.departureDate, period.start),
        ),
      ),
  ]);
  const values = new Map(tourismCountries.map((country) => [country.key, { countryKey: country.key, arrivals: 0, overnightStays: 0 }]));
  const occupiedRoomDays = new Set<string>();
  for (const stay of stays) {
    const from = [stay.arrival, period.start].sort()[1]!;
    const to = [stay.departure, period.end].sort()[0]!;
    const nights = dateDays(from, to);
    for (let offset = 0; offset < nights; offset += 1) {
      const date = new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
      occupiedRoomDays.add(`${stay.roomId}:${date}`);
    }
    const row = values.get(tourismCountryKey(stay.country))!;
    row.overnightStays += nights;
    if (stay.arrival >= period.start && stay.arrival < period.end) row.arrivals += 1;
  }
  return {
    year,
    month,
    bedsOffered: rooms.reduce((sum, room) => sum + room.capacity, 0),
    availableGuestRoomDays: rooms.length * period.days,
    occupiedGuestRoomDays: occupiedRoomDays.size,
    remarks: "",
    values: [...values.values()],
  };
}

export async function getTourismReport(year: number, month: number) {
  const [report] = await db
    .select()
    .from(schema.pmsTourismReports)
    .where(and(eq(schema.pmsTourismReports.year, year), eq(schema.pmsTourismReports.month, month)));
  if (!report) return null;
  const values = await db.select().from(schema.pmsTourismCountryValues).where(eq(schema.pmsTourismCountryValues.reportId, report.id));
  return { ...report, values };
}

export async function saveTourismReport(actor: string, input: TourismReportInput) {
  const values = tourismReportInputSchema.parse(input);
  const { values: countryValues, ...reportValues } = values;
  return withActor(actor, async (tx) => {
    const [report] = await tx
      .insert(schema.pmsTourismReports)
      .values(reportValues)
      .onConflictDoUpdate({
        target: [schema.pmsTourismReports.year, schema.pmsTourismReports.month],
        set: {
          bedsOffered: values.bedsOffered,
          availableGuestRoomDays: values.availableGuestRoomDays,
          occupiedGuestRoomDays: values.occupiedGuestRoomDays,
          remarks: values.remarks,
          updatedAt: new Date(),
        },
      })
      .returning();
    await tx.delete(schema.pmsTourismCountryValues).where(eq(schema.pmsTourismCountryValues.reportId, report!.id));
    await tx.insert(schema.pmsTourismCountryValues).values(countryValues.map((row) => ({ ...row, reportId: report!.id })));
    return report!;
  });
}

const csvField = (value: string | number) => {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function windows1252(text: string): Uint8Array {
  const extra: Record<string, number> = {
    "€": 0x80,
    "‚": 0x82,
    ƒ: 0x83,
    "„": 0x84,
    "…": 0x85,
    "†": 0x86,
    "‡": 0x87,
    ˆ: 0x88,
    "‰": 0x89,
    Š: 0x8a,
    "‹": 0x8b,
    Œ: 0x8c,
    Ž: 0x8e,
    "‘": 0x91,
    "’": 0x92,
    "“": 0x93,
    "”": 0x94,
    "•": 0x95,
    "–": 0x96,
    "—": 0x97,
    "˜": 0x98,
    "™": 0x99,
    š: 0x9a,
    "›": 0x9b,
    œ: 0x9c,
    ž: 0x9e,
    Ÿ: 0x9f,
  };
  return Uint8Array.from(
    [...text].map((character) => {
      const code = character.codePointAt(0)!;
      if (code <= 0xff) return code;
      if (extra[character] !== undefined) return extra[character];
      throw new TourismReportError("Der Export enthält Zeichen, die Windows-1252 nicht darstellen kann.");
    }),
  );
}

export function tourismReportCsv(input: TourismReportInput, includeHeader = false): Uint8Array {
  const report = tourismReportInputSchema.parse(input);
  const byKey = new Map(report.values.map((row) => [row.countryKey, row]));
  const header = [
    "Satzart",
    "Anzahl_Betten",
    "angebotene_Gästezimmertage",
    "belegte_Gästezimmertage",
    "Schliessung",
    "Wiedereröffnung",
    "Abmeldung",
    ...tourismCountries.map((country) => country.arrivalHeading),
    "Bemerkungen",
    ...tourismCountries.map((country) => country.overnightHeading),
  ];
  const row = [
    1,
    report.bedsOffered,
    report.availableGuestRoomDays,
    report.occupiedGuestRoomDays,
    "",
    "",
    "",
    ...tourismCountries.map((country) => byKey.get(country.key)!.arrivals),
    report.remarks,
    ...tourismCountries.map((country) => byKey.get(country.key)!.overnightStays),
  ];
  if (header.length !== 116 || row.length !== 116) throw new TourismReportError("Der HOTE-Export muss genau 116 Felder enthalten.");
  const lines = includeHeader ? [header, row] : [row];
  return windows1252(`${lines.map((line) => line.map(csvField).join(";")).join("\r\n")}\r\n`);
}
