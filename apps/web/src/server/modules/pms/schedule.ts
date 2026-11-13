import { addDays, type InvoiceListStatus } from "@haben/core";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "./database.ts";
import { listPmsInvoices } from "./billing.ts";
import { hostContacts } from "./host-data.ts";
import { ReservationError } from "./reservations.ts";

export type ScheduleBillingStatus = "none" | "draft" | "open" | "paid";

export interface ScheduleRoom {
  id: string;
  number: string;
  name: string;
  archived: boolean;
}

export interface ScheduleEvent {
  id: string;
  reservationId: string;
  roomId: string;
  arrivalDate: string;
  departureDate: string;
  contactName: string;
  reservationStatus: "confirmed" | "canceled";
  reservationStatusLabel: string;
  billingStatus: ScheduleBillingStatus;
  billingStatusLabel: string;
  invoiceNumber: string | null;
}

export interface ReservationScheduleData {
  startDate: string;
  endDate: string;
  days: number;
  rooms: ScheduleRoom[];
  events: ScheduleEvent[];
}

const roomNumberCollator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function billingStatus(status: InvoiceListStatus | undefined): { status: ScheduleBillingStatus; label: string } {
  if (!status) return { status: "none", label: "Nicht berechnet" };
  if (status === "entwurf") return { status: "draft", label: "Entwurf" };
  if (status === "bezahlt" || status === "ausgebucht") return { status: "paid", label: "Bezahlt" };
  return { status: "open", label: "Offen" };
}

/** Lesemodell für DayPilot; Anreise inklusive, Abreise exklusive. */
export async function reservationSchedule(startDate: string, endDate: string, today: string): Promise<ReservationScheduleData> {
  if (!validIsoDate(startDate) || !validIsoDate(endDate)) throw new ReservationError("Der Zeitraum des Belegungsplans ist ungültig.");
  const days = daysBetween(startDate, endDate);
  if (days < 1 || days > 366) throw new ReservationError("Der Belegungsplan darf höchstens 366 Tage umfassen.");

  const [roomRows, itemRows] = await Promise.all([
    db
      .select({
        id: schema.pmsRooms.id,
        number: schema.pmsRooms.number,
        name: schema.pmsRooms.name,
        archivedAt: schema.pmsRooms.archivedAt,
      })
      .from(schema.pmsRooms),
    db
      .select({
        id: schema.pmsReservationItems.id,
        reservationId: schema.pmsReservationItems.reservationId,
        roomId: schema.pmsReservationItems.roomId,
        arrivalDate: schema.pmsReservationItems.arrivalDate,
        departureDate: schema.pmsReservationItems.departureDate,
        reservationStatus: schema.pmsReservations.status,
        contactId: schema.pmsReservations.contactId,
        invoiceId: schema.pmsReservations.invoiceId,
      })
      .from(schema.pmsReservationItems)
      .innerJoin(schema.pmsReservations, eq(schema.pmsReservationItems.reservationId, schema.pmsReservations.id))
      .where(and(lt(schema.pmsReservationItems.arrivalDate, endDate), gt(schema.pmsReservationItems.departureDate, startDate)))
      .orderBy(asc(schema.pmsReservationItems.arrivalDate), asc(schema.pmsReservationItems.position)),
  ]);

  const contacts = await hostContacts([...new Set(itemRows.map((item) => item.contactId))]);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const invoiceIds = [...new Set(itemRows.flatMap((item) => (item.invoiceId ? [item.invoiceId] : [])))];
  const invoices = invoiceIds.length === 0 ? [] : (await listPmsInvoices(today)).filter((invoice) => invoiceIds.includes(invoice.id));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const occupiedRoomIds = new Set(itemRows.map((item) => item.roomId));
  const rooms = roomRows
    .filter((room) => !room.archivedAt || occupiedRoomIds.has(room.id))
    .map((room) => ({ id: room.id, number: room.number, name: room.name, archived: Boolean(room.archivedAt) }))
    .sort((left, right) => roomNumberCollator.compare(left.number, right.number));

  const events = itemRows.map((item): ScheduleEvent => {
    const invoice = item.invoiceId ? invoicesById.get(item.invoiceId) : undefined;
    const billing = billingStatus(invoice?.listStatus);
    return {
      id: item.id,
      reservationId: item.reservationId,
      roomId: item.roomId,
      arrivalDate: item.arrivalDate,
      departureDate: item.departureDate,
      contactName: contactsById.get(item.contactId)?.name ?? "Unbekannter Gast",
      reservationStatus: item.reservationStatus,
      reservationStatusLabel: item.reservationStatus === "canceled" ? "Storniert" : "Bestätigt",
      billingStatus: billing.status,
      billingStatusLabel: billing.label,
      invoiceNumber: invoice?.number ?? null,
    };
  });

  return { startDate, endDate, days, rooms, events };
}

export function defaultScheduleRange(today: string): { startDate: string; endDate: string } {
  const startDate = addDays(today, -32);
  return { startDate, endDate: addDays(startDate, 90) };
}
