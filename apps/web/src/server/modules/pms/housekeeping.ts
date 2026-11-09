import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

export const cleaningStatuses = ["clean", "dirty"] as const;
export type CleaningStatus = (typeof cleaningStatuses)[number];

export class HousekeepingError extends UserError {}

export async function listHousekeepingRooms() {
  return db
    .select({
      id: schema.pmsRooms.id,
      number: schema.pmsRooms.number,
      name: schema.pmsRooms.name,
      cleaningStatus: schema.pmsRooms.cleaningStatus,
    })
    .from(schema.pmsRooms)
    .where(isNull(schema.pmsRooms.archivedAt))
    .orderBy(asc(schema.pmsRooms.number));
}

export async function setCleaningStatus(actor: string, roomId: string, status: CleaningStatus): Promise<void> {
  const rows = await withActor(actor, (tx) =>
    tx
      .update(schema.pmsRooms)
      .set({ cleaningStatus: status, updatedAt: new Date() })
      .where(eq(schema.pmsRooms.id, roomId))
      .returning({ id: schema.pmsRooms.id }),
  );
  if (rows.length === 0) throw new HousekeepingError("Zimmer nicht gefunden.");
}

function localParts(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

/** Markiert fällige Abreisen ab 07:00 Uhr der Betriebszeitzone genau einmal als schmutzig. */
export async function runDueHousekeeping(now = new Date(), timeZone = "Europe/Berlin"): Promise<{ processed: number }> {
  const local = localParts(now, timeZone);
  if (local.hour < 7) return { processed: 0 };
  return withActor("system:housekeeping", async (tx) => {
    const due = await tx
      .select({ id: schema.pmsReservationItems.id, roomId: schema.pmsReservationItems.roomId })
      .from(schema.pmsReservationItems)
      .innerJoin(schema.pmsReservations, eq(schema.pmsReservationItems.reservationId, schema.pmsReservations.id))
      .where(
        and(
          lte(schema.pmsReservationItems.departureDate, local.date),
          isNull(schema.pmsReservationItems.dirtyProcessedAt),
          eq(schema.pmsReservations.status, "confirmed"),
        ),
      );
    if (due.length === 0) return { processed: 0 };
    const processedAt = now;
    let processed = 0;
    for (const item of due) {
      const claimed = await tx
        .update(schema.pmsReservationItems)
        .set({ dirtyProcessedAt: processedAt, updatedAt: processedAt })
        .where(and(eq(schema.pmsReservationItems.id, item.id), isNull(schema.pmsReservationItems.dirtyProcessedAt)))
        .returning({ id: schema.pmsReservationItems.id });
      if (claimed.length === 0) continue;
      await tx.update(schema.pmsRooms).set({ cleaningStatus: "dirty", updatedAt: processedAt }).where(eq(schema.pmsRooms.id, item.roomId));
      processed += 1;
    }
    return { processed };
  });
}
