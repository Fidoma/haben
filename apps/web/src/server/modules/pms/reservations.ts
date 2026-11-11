import { convertPrice, type TaxRate, type UnitLabel } from "@haben/core";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { createDraft, deleteDraft, newDraftDefaults } from "../rechnungen/index.ts";
import { getPmsSettings } from "./settings.ts";

export class ReservationError extends UserError {}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const reservationItemInputSchema = z
  .object({
    roomId: z.uuid("Bitte ein Zimmer auswählen."),
    articleId: z.uuid("Bitte einen gültigen Artikel auswählen.").nullable().default(null),
    unitPrice: z.number().int().min(0, "Der Preis darf nicht negativ sein.").max(999_999_999, "Der Preis ist zu hoch.").default(0),
    arrivalDate: z.string().refine(validIsoDate, "Die Anreise muss ein gültiges Datum sein."),
    departureDate: z.string().refine(validIsoDate, "Die Abreise muss ein gültiges Datum sein."),
    description: z.string().trim().max(2000, "Die Beschreibung darf höchstens 2.000 Zeichen lang sein.").default(""),
  })
  .refine((input) => input.departureDate > input.arrivalDate, { message: "Die Abreise muss nach der Anreise liegen.", path: ["departureDate"] });

export const reservationInputSchema = z.object({
  contactId: z.uuid("Bitte einen Kunden auswählen."),
  items: z
    .array(reservationItemInputSchema)
    .min(1, "Mindestens eine Position ist erforderlich.")
    .max(100, "Eine Reservierung darf höchstens 100 Positionen haben."),
});

export type ReservationInput = z.input<typeof reservationInputSchema>;
export type Reservation = Awaited<ReturnType<typeof listReservations>>[number];

const roomNumberCollator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

export async function listReservations() {
  const [heads, items] = await Promise.all([
    db
      .select({
        id: schema.pmsReservations.id,
        contactId: schema.pmsReservations.contactId,
        invoiceId: schema.pmsReservations.invoiceId,
        status: schema.pmsReservations.status,
        canceledAt: schema.pmsReservations.canceledAt,
        contactName: schema.contacts.name,
      })
      .from(schema.pmsReservations)
      .innerJoin(schema.contacts, eq(schema.pmsReservations.contactId, schema.contacts.id)),
    db
      .select({
        id: schema.pmsReservationItems.id,
        reservationId: schema.pmsReservationItems.reservationId,
        position: schema.pmsReservationItems.position,
        roomId: schema.pmsReservationItems.roomId,
        articleId: schema.pmsReservationItems.articleId,
        unitPrice: schema.pmsReservationItems.unitPrice,
        articleNumber: schema.articles.number,
        articleDescription: schema.articles.description,
        articleUnit: schema.articles.unit,
        articleTaxRate: schema.articles.taxRate,
        articlePriceIncludesTax: schema.articles.priceIncludesTax,
        arrivalDate: schema.pmsReservationItems.arrivalDate,
        departureDate: schema.pmsReservationItems.departureDate,
        description: schema.pmsReservationItems.description,
        roomNumber: schema.pmsRooms.number,
        roomName: schema.pmsRooms.name,
      })
      .from(schema.pmsReservationItems)
      .innerJoin(schema.pmsRooms, eq(schema.pmsReservationItems.roomId, schema.pmsRooms.id))
      .leftJoin(schema.articles, eq(schema.pmsReservationItems.articleId, schema.articles.id))
      .orderBy(asc(schema.pmsReservationItems.position)),
  ]);
  const byReservation = new Map<string, typeof items>();
  for (const item of items) {
    const reservationItems = byReservation.get(item.reservationId) ?? [];
    reservationItems.push(item);
    byReservation.set(item.reservationId, reservationItems);
  }
  return heads
    .map((head) => ({ ...head, items: byReservation.get(head.id) ?? [] }))
    .sort((left, right) => {
      const firstLeft = left.items[0];
      const firstRight = right.items[0];
      return (
        (firstLeft?.arrivalDate ?? "").localeCompare(firstRight?.arrivalDate ?? "") ||
        roomNumberCollator.compare(firstLeft?.roomNumber ?? "", firstRight?.roomNumber ?? "")
      );
    });
}

export async function reservationFormOptions() {
  const [rooms, contacts, articles, settings] = await Promise.all([
    db
      .select({ id: schema.pmsRooms.id, number: schema.pmsRooms.number, name: schema.pmsRooms.name })
      .from(schema.pmsRooms)
      .where(isNull(schema.pmsRooms.archivedAt)),
    db
      .select({
        id: schema.contacts.id,
        name: schema.contacts.name,
        ort: schema.contacts.ort,
        kundennummer: schema.contacts.kundennummer,
        isCustomer: schema.contacts.isCustomer,
        ustId: schema.contacts.ustId,
      })
      .from(schema.contacts)
      .where(and(isNull(schema.contacts.archivedAt), eq(schema.contacts.isCustomer, true)))
      .orderBy(asc(schema.contacts.name)),
    db
      .select({
        id: schema.articles.id,
        number: schema.articles.number,
        description: schema.articles.description,
        detail: schema.articles.detail,
        unit: schema.articles.unit,
        unitPrice: schema.articles.unitPrice,
        taxRate: schema.articles.taxRate,
        priceIncludesTax: schema.articles.priceIncludesTax,
      })
      .from(schema.articles)
      .where(isNull(schema.articles.archivedAt))
      .orderBy(asc(schema.articles.description)),
    getPmsSettings(),
  ]);
  rooms.sort((left, right) => roomNumberCollator.compare(left.number, right.number));
  const defaultArticleId = articles.some((article) => article.id === settings.defaultArticleId) ? settings.defaultArticleId : null;
  return { rooms, contacts, articles, defaultArticleId };
}

async function validateReferences(input: z.output<typeof reservationInputSchema>): Promise<void> {
  const roomIds = [...new Set(input.items.map((item) => item.roomId))];
  const articleIds = [...new Set(input.items.flatMap((item) => (item.articleId ? [item.articleId] : [])))];
  const [rooms, [contact], articles] = await Promise.all([
    db.select({ id: schema.pmsRooms.id, archivedAt: schema.pmsRooms.archivedAt }).from(schema.pmsRooms).where(inArray(schema.pmsRooms.id, roomIds)),
    db
      .select({ archivedAt: schema.contacts.archivedAt, isCustomer: schema.contacts.isCustomer })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, input.contactId)),
    articleIds.length === 0
      ? Promise.resolve([])
      : db.select({ id: schema.articles.id, archivedAt: schema.articles.archivedAt }).from(schema.articles).where(inArray(schema.articles.id, articleIds)),
  ]);
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  for (const roomId of roomIds) {
    const room = roomsById.get(roomId);
    if (!room) throw new ReservationError("Zimmer nicht gefunden.");
    if (room.archivedAt) throw new ReservationError("Das Zimmer ist archiviert.");
  }
  if (!contact) throw new ReservationError("Kontakt nicht gefunden.");
  if (!contact.isCustomer) throw new ReservationError("Der Kontakt besitzt keine Kundenrolle.");
  if (contact.archivedAt) throw new ReservationError("Der Kunde ist archiviert.");
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  for (const articleId of articleIds) {
    const article = articlesById.get(articleId);
    if (!article) throw new ReservationError("Artikel nicht gefunden.");
    if (article.archivedAt) throw new ReservationError("Der Artikel ist archiviert.");
  }
}

function isOverlap(error: unknown): boolean {
  const pg = (error as { cause?: { code?: string; constraint_name?: string } } | null)?.cause;
  return pg?.code === "23P01" && ["pms_reservations_no_overlap", "pms_reservation_items_no_overlap"].includes(pg.constraint_name ?? "");
}

async function translateOverlap<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isOverlap(error)) throw new ReservationError("Das Zimmer ist in diesem Zeitraum bereits reserviert.");
    throw error;
  }
}

const itemRows = (reservationId: string, items: z.output<typeof reservationItemInputSchema>[]) =>
  items.map((item, index) => ({ ...item, reservationId, position: index + 1 }));

export async function createReservation(actor: string, input: ReservationInput) {
  const values = reservationInputSchema.parse(input);
  await validateReferences(values);
  return translateOverlap(() =>
    withActor(actor, async (tx) => {
      const first = values.items[0]!;
      const [row] = await tx
        .insert(schema.pmsReservations)
        .values({
          contactId: values.contactId,
          roomId: first.roomId,
          arrivalDate: first.arrivalDate,
          departureDate: first.departureDate,
          note: first.description,
        })
        .returning();
      await tx.insert(schema.pmsReservationItems).values(itemRows(row!.id, values.items));
      return { ...row!, items: values.items };
    }),
  );
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
  return translateOverlap(() =>
    withActor(actor, async (tx) => {
      const first = values.items[0]!;
      const [row] = await tx
        .update(schema.pmsReservations)
        .set({
          contactId: values.contactId,
          roomId: first.roomId,
          arrivalDate: first.arrivalDate,
          departureDate: first.departureDate,
          note: first.description,
          updatedAt: new Date(),
        })
        .where(eq(schema.pmsReservations.id, id))
        .returning();
      await tx.delete(schema.pmsReservationItems).where(eq(schema.pmsReservationItems.reservationId, id));
      await tx.insert(schema.pmsReservationItems).values(itemRows(id, values.items));
      return { ...row!, items: values.items };
    }),
  );
}

export async function cancelReservation(actor: string, id: string): Promise<void> {
  await editableReservation(id);
  await withActor(actor, async (tx) => {
    const canceledAt = new Date();
    await tx
      .update(schema.pmsReservations)
      .set({ status: "canceled", canceledAt, updatedAt: canceledAt })
      .where(and(eq(schema.pmsReservations.id, id), eq(schema.pmsReservations.status, "confirmed")));
    await tx.update(schema.pmsReservationItems).set({ canceledAt, updatedAt: canceledAt }).where(eq(schema.pmsReservationItems.reservationId, id));
  });
}

const stayDays = (arrivalDate: string, departureDate: string) =>
  Math.round((Date.parse(`${departureDate}T00:00:00Z`) - Date.parse(`${arrivalDate}T00:00:00Z`)) / 86_400_000);

const germanDate = (value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;

/** Erstellt aus allen Aufenthaltspositionen einen Rechnungsentwurf über die öffentliche Rechnungsschnittstelle. */
export async function createReservationInvoice(actor: string, id: string, issueDate: string) {
  const reservation = (await listReservations()).find((candidate) => candidate.id === id);
  if (!reservation) throw new ReservationError("Reservierung nicht gefunden.");
  if (reservation.status === "canceled") throw new ReservationError("Für eine stornierte Reservierung kann keine Rechnung erstellt werden.");
  if (reservation.invoiceId) throw new ReservationError("Für diese Reservierung wurde bereits eine Rechnung erstellt.");
  if (reservation.items.length === 0) throw new ReservationError("Die Reservierung enthält keine Positionen.");

  const defaults = await newDraftDefaults(issueDate);
  const fallback = defaults.lines[0]!;
  const serviceFrom = reservation.items.map((item) => item.arrivalDate).sort()[0]!;
  const serviceTo = reservation.items
    .map((item) => item.departureDate)
    .sort()
    .at(-1)!;
  const lines = reservation.items.map((item) => {
    const detail = [
      `Zimmer ${item.roomNumber}${item.roomName ? ` (${item.roomName})` : ""}`,
      `${germanDate(item.arrivalDate)} – ${germanDate(item.departureDate)}`,
      item.description,
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 2000);
    const taxRate = (item.articleTaxRate ?? fallback.taxRate) as TaxRate;
    const unitPrice = item.articleId
      ? convertPrice(item.unitPrice, taxRate, item.articlePriceIncludesTax ? "brutto" : "netto", defaults.priceMode)
      : item.unitPrice;
    return {
      description: item.articleDescription || "Übernachtung",
      detail,
      itemNumber: item.articleNumber ?? "",
      quantity: stayDays(item.arrivalDate, item.departureDate) * 1000,
      unit: (item.articleUnit ?? "Tag") as UnitLabel,
      unitPrice,
      taxRate,
      discount: null,
    };
  });
  const invoice = await createDraft(actor, {
    ...defaults,
    contactId: reservation.contactId,
    serviceFrom,
    serviceTo,
    lines,
  });
  const linked = await withActor(actor, (tx) =>
    tx
      .update(schema.pmsReservations)
      .set({ invoiceId: invoice.id, updatedAt: new Date() })
      .where(and(eq(schema.pmsReservations.id, id), isNull(schema.pmsReservations.invoiceId)))
      .returning({ id: schema.pmsReservations.id }),
  );
  if (linked.length === 0) {
    await deleteDraft(actor, invoice.id);
    throw new ReservationError("Für diese Reservierung wurde bereits eine Rechnung erstellt.");
  }
  return invoice;
}
