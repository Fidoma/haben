import { eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "./database.ts";
import { pmsInvoiceAccounting } from "./billing.ts";
import { hostContacts } from "./host-data.ts";

export const roomStatisticsPeriods = ["current-year", "last-year", "current-month", "last-month", "all"] as const;
export type RoomStatisticsPeriod = (typeof roomStatisticsPeriods)[number];

type Stay = {
  id: string;
  reservationId: string;
  position: number;
  roomId: string;
  roomNumber: string;
  contactId: string;
  contactName: string;
  invoiceId: string | null;
  status: "confirmed" | "canceled";
  arrival: string;
  departure: string;
};

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const atUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const days = (start: string, end: string) => Math.max(0, Math.round((atUtc(end) - atUtc(start)) / DAY));
const addDays = (date: string, count: number) => iso(new Date(atUtc(date) + count * DAY));
const later = (left: string, right: string) => (left > right ? left : right);
const earlier = (left: string, right: string) => (left < right ? left : right);

function groupBy<T, K>(values: T[], keyOf: (value: T) => K) {
  const groups = new Map<K, T[]>();
  for (const value of values) groups.set(keyOf(value), [...(groups.get(keyOf(value)) ?? []), value]);
  return groups;
}

export function roomStatisticsRange(today: string, period: RoomStatisticsPeriod) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = iso(new Date(Date.UTC(year, month, 1)));
  if (period === "current-year") return { start: `${year}-01-01`, end: `${year + 1}-01-01` };
  if (period === "last-year") return { start: `${year - 1}-01-01`, end: `${year}-01-01` };
  if (period === "current-month") return { start: monthStart, end: nextMonth };
  if (period === "last-month") {
    const start = iso(new Date(Date.UTC(year, month - 2, 1)));
    return { start, end: monthStart };
  }
  return { start: "1900-01-01", end: today };
}

function datesIn(start: string, end: string) {
  return Array.from({ length: days(start, end) }, (_, index) => addDays(start, index));
}

function splitCents(total: number, count: number) {
  if (count <= 0) return [];
  const sign = Math.sign(total);
  const absolute = Math.abs(total);
  const base = Math.floor(absolute / count);
  const remainder = absolute % count;
  return Array.from({ length: count }, (_, index) => sign * (base + (index < remainder ? 1 : 0)));
}

function allocateByWeight(total: number, weights: number[]) {
  const sum = weights.reduce((value, weight) => value + Math.abs(weight), 0);
  if (sum === 0) return total === 0 ? weights.map(() => 0) : null;
  const sign = Math.sign(total);
  const absolute = Math.abs(total);
  const allocated = weights.map((weight) => Math.floor((absolute * Math.abs(weight)) / sum));
  let remainder = absolute - allocated.reduce((value, amount) => value + amount, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % allocated.length) {
    allocated[index]! += 1;
    remainder -= 1;
  }
  return allocated.map((amount) => amount * sign);
}

function seriesKey(date: string, yearly: boolean) {
  return yearly ? date.slice(0, 4) : date.slice(0, 7);
}

function revenueSeries(start: string, end: string, values: Map<string, number>) {
  const yearly = days(start, end) > 730;
  const keys: string[] = [];
  let cursor = yearly ? `${start.slice(0, 4)}-01-01` : `${start.slice(0, 7)}-01`;
  while (cursor < end) {
    keys.push(seriesKey(cursor, yearly));
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    cursor = yearly ? `${year + 1}-01-01` : iso(new Date(Date.UTC(year, month, 1)));
  }
  return keys.map((key) => ({ key, label: yearly ? key : `${key.slice(5, 7)}.${key.slice(0, 4)}`, revenue: values.get(key) ?? 0 }));
}

async function attributableRevenue(stays: Stay[]) {
  const roots = [...new Set(stays.flatMap((stay) => (stay.invoiceId ? [stay.invoiceId] : [])))];
  const byItem = new Map<string, number>();
  const unattributedReservations = new Set<string>();
  if (roots.length === 0) return { byItem, unattributedReservations };

  const { documents, lines } = await pmsInvoiceAccounting(roots);
  const linesByDocument = groupBy(lines, (line) => line.invoiceId);
  const staysByReservation = groupBy(stays, (stay) => stay.reservationId);

  for (const reservationStays of staysByReservation.values()) {
    const rootId = reservationStays[0]!.invoiceId;
    if (!rootId) continue;
    const finalDocuments = documents.filter((document) => document.status === "final" && (document.id === rootId || document.rootId === rootId));
    if (!finalDocuments.some((document) => document.id === rootId)) continue;
    let valid = true;
    const amounts = new Map(reservationStays.map((stay) => [stay.id, 0]));
    for (const document of finalDocuments) {
      const documentLines = (linesByDocument.get(document.id) ?? []).toSorted((left, right) => left.position - right.position);
      if (documentLines.length !== reservationStays.length || documentLines.some((line, index) => line.position !== reservationStays[index]!.position)) {
        valid = false;
        break;
      }
      const allocated = allocateByWeight(
        document.net,
        documentLines.map((line) => line.net),
      );
      if (!allocated) {
        valid = false;
        break;
      }
      reservationStays.forEach((stay, index) => {
        amounts.set(stay.id, amounts.get(stay.id)! + allocated[index]!);
      });
    }
    if (valid) for (const [itemId, amount] of amounts) byItem.set(itemId, amount);
    else unattributedReservations.add(reservationStays[0]!.reservationId);
  }
  return { byItem, unattributedReservations };
}

async function loadStays(filter: { roomId: string } | { reservationIds: string[] } | null = null) {
  const rows = await db
    .select({
      id: schema.pmsReservationItems.id,
      reservationId: schema.pmsReservations.id,
      position: schema.pmsReservationItems.position,
      roomId: schema.pmsReservationItems.roomId,
      roomNumber: schema.pmsRooms.number,
      contactId: schema.pmsReservations.contactId,
      invoiceId: schema.pmsReservations.invoiceId,
      status: schema.pmsReservations.status,
      arrival: schema.pmsReservationItems.arrivalDate,
      departure: schema.pmsReservationItems.departureDate,
    })
    .from(schema.pmsReservationItems)
    .innerJoin(schema.pmsRooms, eq(schema.pmsReservationItems.roomId, schema.pmsRooms.id))
    .innerJoin(schema.pmsReservations, eq(schema.pmsReservationItems.reservationId, schema.pmsReservations.id))
    .where(
      filter && "roomId" in filter
        ? eq(schema.pmsReservationItems.roomId, filter.roomId)
        : filter
          ? inArray(schema.pmsReservations.id, filter.reservationIds)
          : undefined,
    );
  const contacts = await hostContacts([...new Set(rows.map((row) => row.contactId))]);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  return rows.map((row) => ({ ...row, contactName: contactsById.get(row.contactId)?.name ?? "Unbekannter Gast" }));
}

export async function roomStatistics(roomId: string, period: RoomStatisticsPeriod, today: string) {
  const [room] = await db.select().from(schema.pmsRooms).where(eq(schema.pmsRooms.id, roomId));
  if (!room) return null;
  const stays: Stay[] = await loadStays({ roomId });
  const requested = roomStatisticsRange(today, period);
  const firstArrival = stays.map((stay) => stay.arrival).toSorted()[0];
  const start = period === "all" ? (firstArrival ?? today) : requested.start;
  const end = earlier(requested.end, today);
  const periodStays = stays.filter((stay) => stay.arrival < end && stay.departure > start);
  const confirmed = periodStays.filter((stay) => stay.status === "confirmed");
  const relatedReservationIds = [...new Set(confirmed.map((stay) => stay.reservationId))];
  const revenueStays: Stay[] = relatedReservationIds.length === 0 ? [] : await loadStays({ reservationIds: relatedReservationIds });
  const occupiedDates = new Set<string>();
  for (const stay of confirmed) for (const date of datesIn(later(stay.arrival, start), earlier(stay.departure, end))) occupiedDates.add(date);
  const availableEnd = room.archivedAt ? earlier(end, iso(room.archivedAt)) : end;
  const availableNights = days(start, availableEnd);
  const reservationIds = new Set(periodStays.map((stay) => stay.reservationId));
  const canceledIds = new Set(periodStays.filter((stay) => stay.status === "canceled").map((stay) => stay.reservationId));
  const futureNights = new Set<string>();
  for (const stay of stays.filter((candidate) => candidate.status === "confirmed" && candidate.arrival < requested.end && candidate.departure > today)) {
    for (const date of datesIn(later(stay.arrival, today), earlier(stay.departure, requested.end))) futureNights.add(date);
  }

  const revenue = await attributableRevenue(revenueStays);
  const revenueByDate = new Map<string, number>();
  const customerValues = new Map<string, { id: string; name: string; nights: Set<string>; revenue: number }>();
  for (const stay of confirmed) {
    const customer = customerValues.get(stay.contactId) ?? { id: stay.contactId, name: stay.contactName, nights: new Set<string>(), revenue: 0 };
    const allDates = datesIn(stay.arrival, stay.departure);
    const daily = splitCents(revenue.byItem.get(stay.id) ?? 0, allDates.length);
    allDates.forEach((date, index) => {
      if (date < start || date >= end) return;
      customer.nights.add(date);
      customer.revenue += daily[index]!;
      const key = seriesKey(date, days(start, end) > 730);
      revenueByDate.set(key, (revenueByDate.get(key) ?? 0) + daily[index]!);
    });
    customerValues.set(stay.contactId, customer);
  }
  const topCustomers = [...customerValues.values()]
    .map((customer) => ({ id: customer.id, name: customer.name, nights: customer.nights.size, revenue: customer.revenue }))
    .toSorted((left, right) => right.revenue - left.revenue || right.nights - left.nights || left.name.localeCompare(right.name, "de"))
    .slice(0, 5);
  const totalRevenue = [...revenueByDate.values()].reduce((sum, amount) => sum + amount, 0);
  const completedReservations = new Set(confirmed.filter((stay) => stay.departure <= today).map((stay) => stay.reservationId)).size;
  const stayLengths = [...groupBy(confirmed, (stay) => stay.reservationId).values()].map(
    (items) => new Set(items.flatMap((item) => datesIn(item.arrival, item.departure))).size,
  );
  const recurringCustomers = [...groupBy(confirmed, (stay) => stay.contactId).values()].filter(
    (items) => new Set(items.map((item) => item.reservationId)).size > 1,
  ).length;

  return {
    room: { id: room.id, cleaningStatus: room.cleaningStatus },
    period: { start, end, requestedEnd: requested.end },
    revenue: totalRevenue,
    occupiedNights: occupiedDates.size,
    futureNights: futureNights.size,
    availableNights,
    occupancyBasisPoints: availableNights === 0 ? 0 : Math.round((occupiedDates.size * 10_000) / availableNights),
    canceledReservations: canceledIds.size,
    cancellationBasisPoints: reservationIds.size === 0 ? 0 : Math.round((canceledIds.size * 10_000) / reservationIds.size),
    adr: occupiedDates.size === 0 ? null : Math.round(totalRevenue / occupiedDates.size),
    revPar: availableNights === 0 ? null : Math.round(totalRevenue / availableNights),
    averageStay: stayLengths.length === 0 ? null : stayLengths.reduce((sum, value) => sum + value, 0) / stayLengths.length,
    completedReservations,
    recurringCustomers,
    unattributedReservations: revenue.unattributedReservations.size,
    revenueSeries: revenueSeries(start, end, revenueByDate),
    topCustomers,
    recentReservations: stays
      .toSorted((left, right) => right.arrival.localeCompare(left.arrival) || right.reservationId.localeCompare(left.reservationId))
      .filter((stay, index, all) => all.findIndex((candidate) => candidate.reservationId === stay.reservationId) === index)
      .slice(0, 5)
      .map((stay) => ({
        id: stay.reservationId,
        contactName: stay.contactName,
        arrival: stay.arrival,
        departure: stay.departure,
        status: stay.status,
      })),
  };
}

/** Betriebswirtschaftliche Kennzahlen aller aktuell aktiven Zimmer. */
export async function hotelStatistics(period: RoomStatisticsPeriod, today: string) {
  const rooms = await db.select({ id: schema.pmsRooms.id, number: schema.pmsRooms.number }).from(schema.pmsRooms).where(isNull(schema.pmsRooms.archivedAt));
  const activeRoomIds = new Set(rooms.map((room) => room.id));
  const allStays: Stay[] = await loadStays();
  const stays = allStays.filter((stay) => activeRoomIds.has(stay.roomId));
  const requested = roomStatisticsRange(today, period);
  const firstArrival = stays.map((stay) => stay.arrival).toSorted()[0];
  const start = period === "all" ? (firstArrival ?? today) : requested.start;
  const end = earlier(requested.end, today);
  const periodStays = stays.filter((stay) => stay.arrival < end && stay.departure > start);
  const confirmed = periodStays.filter((stay) => stay.status === "confirmed");
  const relatedReservationIds = new Set(confirmed.map((stay) => stay.reservationId));
  const revenue = await attributableRevenue(allStays.filter((stay) => relatedReservationIds.has(stay.reservationId)));
  const occupiedRoomNights = new Set<string>();
  const futureRoomNights = new Set<string>();
  const revenueByDate = new Map<string, number>();
  const roomValues = new Map(rooms.map((room) => [room.id, { id: room.id, number: room.number, nights: 0, revenue: 0 }]));
  const customerValues = new Map<string, { id: string; name: string; nights: Set<string>; revenue: number }>();

  for (const stay of confirmed) {
    const customer = customerValues.get(stay.contactId) ?? { id: stay.contactId, name: stay.contactName, nights: new Set<string>(), revenue: 0 };
    const room = roomValues.get(stay.roomId)!;
    const allDates = datesIn(stay.arrival, stay.departure);
    const daily = splitCents(revenue.byItem.get(stay.id) ?? 0, allDates.length);
    allDates.forEach((date, index) => {
      if (date < start || date >= end) return;
      const roomNight = `${stay.roomId}:${date}`;
      occupiedRoomNights.add(roomNight);
      customer.nights.add(roomNight);
      customer.revenue += daily[index]!;
      room.nights += 1;
      room.revenue += daily[index]!;
      const key = seriesKey(date, days(start, end) > 730);
      revenueByDate.set(key, (revenueByDate.get(key) ?? 0) + daily[index]!);
    });
    customerValues.set(stay.contactId, customer);
  }

  for (const stay of stays.filter((candidate) => candidate.status === "confirmed" && candidate.arrival < requested.end && candidate.departure > today)) {
    for (const date of datesIn(later(stay.arrival, today), earlier(stay.departure, requested.end))) {
      futureRoomNights.add(`${stay.roomId}:${date}`);
    }
  }

  const reservationIds = new Set(periodStays.map((stay) => stay.reservationId));
  const canceledIds = new Set(periodStays.filter((stay) => stay.status === "canceled").map((stay) => stay.reservationId));
  const availableNights = days(start, end) * rooms.length;
  const totalRevenue = [...revenueByDate.values()].reduce((sum, amount) => sum + amount, 0);
  const stayLengths = [...groupBy(confirmed, (stay) => stay.reservationId).values()].map(
    (items) => new Set(items.flatMap((item) => datesIn(item.arrival, item.departure))).size,
  );

  return {
    period: { start, end, requestedEnd: requested.end },
    activeRooms: rooms.length,
    revenue: totalRevenue,
    occupiedNights: occupiedRoomNights.size,
    futureNights: futureRoomNights.size,
    availableNights,
    occupancyBasisPoints: availableNights === 0 ? 0 : Math.round((occupiedRoomNights.size * 10_000) / availableNights),
    canceledReservations: canceledIds.size,
    cancellationBasisPoints: reservationIds.size === 0 ? 0 : Math.round((canceledIds.size * 10_000) / reservationIds.size),
    adr: occupiedRoomNights.size === 0 ? null : Math.round(totalRevenue / occupiedRoomNights.size),
    revPar: availableNights === 0 ? null : Math.round(totalRevenue / availableNights),
    averageStay: stayLengths.length === 0 ? null : stayLengths.reduce((sum, value) => sum + value, 0) / stayLengths.length,
    unattributedReservations: revenue.unattributedReservations.size,
    revenueSeries: revenueSeries(start, end, revenueByDate),
    topRooms: [...roomValues.values()]
      .toSorted((left, right) => right.revenue - left.revenue || right.nights - left.nights || left.number.localeCompare(right.number, "de"))
      .slice(0, 5),
    topCustomers: [...customerValues.values()]
      .map((customer) => ({ id: customer.id, name: customer.name, nights: customer.nights.size, revenue: customer.revenue }))
      .toSorted((left, right) => right.revenue - left.revenue || right.nights - left.nights || left.name.localeCompare(right.name, "de"))
      .slice(0, 5),
  };
}
