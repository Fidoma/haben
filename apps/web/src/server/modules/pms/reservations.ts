import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

export class ReservationError extends UserError {}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const reservationInputSchema = z
  .object({
    roomId: z.uuid("Bitte ein Zimmer auswählen."),
    contactId: z.uuid("Bitte einen Kunden auswählen."),
    arrivalDate: z.string().refine(validIsoDate, "Die Anreise muss ein gültiges Datum sein."),
    departureDate: z.string().refine(validIsoDate, "Die Abreise muss ein gültiges Datum sein."),
    note: z.string().trim().max(2000, "Die interne Notiz darf höchstens 2.000 Zeichen lang sein.").default(""),
  })
  .refine((input) => input.departureDate > input.arrivalDate, { message: "Die Abreise muss nach der Anreise liegen.", path: ["departureDate"] });

export type ReservationInput = z.input<typeof reservationInputSchema>;
export type Reservation = Awaited<ReturnType<typeof listReservations>>[number];

const roomNumberCollator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

export async function listReservations() {
  const rows = await db
    .select({
      id: schema.pmsReservations.id,
      roomId: schema.pmsReservations.roomId,
      contactId: schema.pmsReservations.contactId,
      arrivalDate: schema.pmsReservations.arrivalDate,
      departureDate: schema.pmsReservations.departureDate,
      status: schema.pmsReservations.status,
      note: schema.pmsReservations.note,
      canceledAt: schema.pmsReservations.canceledAt,
      roomNumber: schema.pmsRooms.number,
      roomName: schema.pmsRooms.name,
      contactName: schema.contacts.name,
    })
    .from(schema.pmsReservations)
    .innerJoin(schema.pmsRooms, eq(schema.pmsReservations.roomId, schema.pmsRooms.id))
    .innerJoin(schema.contacts, eq(schema.pmsReservations.contactId, schema.contacts.id))
    .orderBy(asc(schema.pmsReservations.arrivalDate));
  return rows.sort((left, right) => left.arrivalDate.localeCompare(right.arrivalDate) || roomNumberCollator.compare(left.roomNumber, right.roomNumber));
}

export async function reservationFormOptions() {
  const [rooms, contacts] = await Promise.all([
    db
      .select({ id: schema.pmsRooms.id, number: schema.pmsRooms.number, name: schema.pmsRooms.name })
      .from(schema.pmsRooms)
      .where(isNull(schema.pmsRooms.archivedAt)),
    db
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(and(isNull(schema.contacts.archivedAt), eq(schema.contacts.isCustomer, true)))
      .orderBy(asc(schema.contacts.name)),
  ]);
  rooms.sort((left, right) => roomNumberCollator.compare(left.number, right.number));
  return { rooms, contacts };
}

async function validateReferences(input: z.output<typeof reservationInputSchema>): Promise<void> {
  const [[room], [contact]] = await Promise.all([
    db.select({ archivedAt: schema.pmsRooms.archivedAt }).from(schema.pmsRooms).where(eq(schema.pmsRooms.id, input.roomId)),
    db
      .select({ archivedAt: schema.contacts.archivedAt, isCustomer: schema.contacts.isCustomer })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, input.contactId)),
  ]);
  if (!room) throw new ReservationError("Zimmer nicht gefunden.");
  if (room.archivedAt) throw new ReservationError("Das Zimmer ist archiviert.");
  if (!contact) throw new ReservationError("Kontakt nicht gefunden.");
  if (!contact.isCustomer) throw new ReservationError("Der Kontakt besitzt keine Kundenrolle.");
  if (contact.archivedAt) throw new ReservationError("Der Kunde ist archiviert.");
}

function isOverlap(error: unknown): boolean {
  const pg = (error as { cause?: { code?: string; constraint_name?: string } } | null)?.cause;
  return pg?.code === "23P01" && pg.constraint_name === "pms_reservations_no_overlap";
}

async function translateOverlap<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isOverlap(error)) throw new ReservationError("Das Zimmer ist in diesem Zeitraum bereits reserviert.");
    throw error;
  }
}

export async function createReservation(actor: string, input: ReservationInput) {
  const values = reservationInputSchema.parse(input);
  await validateReferences(values);
  return translateOverlap(async () => {
    const [row] = await withActor(actor, (tx) => tx.insert(schema.pmsReservations).values(values).returning());
    return row!;
  });
}

async function editableReservation(id: string) {
  const [reservation] = await db.select().from(schema.pmsReservations).where(eq(schema.pmsReservations.id, id));
  if (!reservation) throw new ReservationError("Reservierung nicht gefunden.");
  if (reservation.status === "canceled") throw new ReservationError("Eine stornierte Reservierung kann nicht geändert werden.");
  return reservation;
}

export async function updateReservation(actor: string, id: string, input: ReservationInput) {
  await editableReservation(id);
  const values = reservationInputSchema.parse(input);
  await validateReferences(values);
  return translateOverlap(async () => {
    const [row] = await withActor(actor, (tx) =>
      tx
        .update(schema.pmsReservations)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.pmsReservations.id, id))
        .returning(),
    );
    return row!;
  });
}

export async function cancelReservation(actor: string, id: string): Promise<void> {
  await editableReservation(id);
  await withActor(actor, (tx) =>
    tx
      .update(schema.pmsReservations)
      .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.pmsReservations.id, id), eq(schema.pmsReservations.status, "confirmed"))),
  );
}
