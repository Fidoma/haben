import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { isUniqueViolation, UserError } from "../../errors.ts";

export type Room = typeof schema.pmsRooms.$inferSelect;

export class RoomError extends UserError {}

export const roomInputSchema = z.object({
  number: z.string().trim().min(1, "Zimmernummer fehlt.").max(50, "Die Zimmernummer darf höchstens 50 Zeichen lang sein."),
  name: z.string().trim().max(100, "Die Bezeichnung darf höchstens 100 Zeichen lang sein.").default(""),
  capacity: z
    .number()
    .int("Die Kapazität muss eine ganze Zahl sein.")
    .min(1, "Die Kapazität muss mindestens 1 sein.")
    .max(100, "Die Kapazität darf höchstens 100 sein."),
});

export type RoomInput = z.input<typeof roomInputSchema>;

const roomNumberCollator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

/** Aktive Zimmer zuerst, innerhalb der Gruppen nach natürlich gelesener Zimmernummer */
export async function listRooms({ archived = false }: { archived?: boolean } = {}): Promise<Room[]> {
  const rows = await db
    .select()
    .from(schema.pmsRooms)
    .where(archived ? undefined : isNull(schema.pmsRooms.archivedAt))
    .orderBy(asc(schema.pmsRooms.archivedAt));
  return rows.sort((left, right) => {
    const archiveOrder = Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt));
    return archiveOrder || roomNumberCollator.compare(left.number, right.number);
  });
}

async function translateNumberConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error, "pms_rooms_number_unique")) throw new RoomError("Diese Zimmernummer gibt es bereits.");
    throw error;
  }
}

export async function createRoom(actor: string, input: RoomInput): Promise<Room> {
  const values = roomInputSchema.parse(input);
  return translateNumberConflict(async () => {
    const [row] = await withActor(actor, (tx) => tx.insert(schema.pmsRooms).values(values).returning());
    return row!;
  });
}

export async function updateRoom(actor: string, id: string, input: RoomInput): Promise<Room> {
  const values = roomInputSchema.parse(input);
  const row = await translateNumberConflict(async () => {
    const [updated] = await withActor(actor, (tx) =>
      tx
        .update(schema.pmsRooms)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.pmsRooms.id, id))
        .returning(),
    );
    return updated;
  });
  if (!row) throw new RoomError("Zimmer nicht gefunden.");
  return row;
}

/** Zimmer bleiben für spätere Reservierungen erhalten und werden deshalb nur archiviert. */
export async function setRoomArchived(actor: string, id: string, archived: boolean): Promise<void> {
  const [row] = await withActor(actor, (tx) =>
    tx
      .update(schema.pmsRooms)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.pmsRooms.id, id))
      .returning({ id: schema.pmsRooms.id }),
  );
  if (!row) throw new RoomError("Zimmer nicht gefunden.");
}

/** Ändert den kompakten Zimmerstatus im Belegungsplan. */
export async function setRoomCleaningStatus(actor: string, id: string, status: "clean" | "dirty"): Promise<void> {
  const [row] = await withActor(actor, (tx) =>
    tx.update(schema.pmsRooms).set({ cleaningStatus: status, updatedAt: new Date() }).where(eq(schema.pmsRooms.id, id)).returning({ id: schema.pmsRooms.id }),
  );
  if (!row) throw new RoomError("Zimmer nicht gefunden.");
}
