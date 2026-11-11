import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invoices } from "../../db/schema.ts";

/** Globale Einstellungen des Property-Management-Systems. */
export const pmsSettings = pgTable(
  "pms_settings",
  {
    id: smallint("id").primaryKey().default(1),
    /** Artikel-ID aus dem Hostsystem; bewusst ohne Datenbankkopplung. */
    defaultArticleId: uuid("default_article_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("pms_settings_single_row", sql`${t.id} = 1`)],
);

/** Zimmerstamm des PMS; Zimmer werden archiviert statt gelöscht. */
export const pmsRooms = pgTable(
  "pms_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    name: text("name").notNull().default(""),
    capacity: smallint("capacity").notNull().default(1),
    cleaningStatus: text("cleaning_status", { enum: ["clean", "dirty"] })
      .notNull()
      .default("clean"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pms_rooms_number_unique").on(sql`lower(${t.number})`),
    check("pms_rooms_number_length", sql`char_length(${t.number}) between 1 and 50`),
    check("pms_rooms_name_length", sql`char_length(${t.name}) <= 100`),
    check("pms_rooms_capacity", sql`${t.capacity} between 1 and 100`),
    check("pms_rooms_cleaning_status", sql`${t.cleaningStatus} in ('clean', 'dirty')`),
  ],
);

export const pmsReservationStatuses = ["confirmed", "canceled"] as const;

/** Kopf einer PMS-Reservierung; Gastdaten werden über eine Host-ID referenziert. */
export const pmsReservations = pgTable(
  "pms_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => pmsRooms.id),
    /** Kunden-ID aus dem Hostsystem; bewusst ohne Datenbankkopplung. */
    contactId: uuid("contact_id").notNull(),
    /** Einzige feste Host-Schnittstelle: der erzeugte Rechnungsentwurf. */
    invoiceId: uuid("invoice_id")
      .unique()
      .references(() => invoices.id, { onDelete: "set null" }),
    arrivalDate: date("arrival_date", { mode: "string" }).notNull(),
    departureDate: date("departure_date", { mode: "string" }).notNull(),
    status: text("status", { enum: pmsReservationStatuses }).notNull().default("confirmed"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (t) => [
    index("pms_reservations_room_period").on(t.roomId, t.arrivalDate, t.departureDate),
    index("pms_reservations_contact").on(t.contactId),
    index("pms_reservations_status").on(t.status),
    check("pms_reservations_period", sql`${t.departureDate} > ${t.arrivalDate}`),
    check("pms_reservations_note_length", sql`char_length(${t.note}) <= 2000`),
    check("pms_reservations_status", sql`${t.status} in ('confirmed', 'canceled')`),
    check(
      "pms_reservations_canceled_at",
      sql`(${t.status} = 'confirmed' and ${t.canceledAt} is null) or (${t.status} = 'canceled' and ${t.canceledAt} is not null)`,
    ),
  ],
);

/** Zimmer und Zeitraum einer Reservierung. */
export const pmsReservationItems = pgTable(
  "pms_reservation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => pmsReservations.id),
    position: smallint("position").notNull(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => pmsRooms.id),
    /** Artikel-ID aus dem Hostsystem; bewusst ohne Datenbankkopplung. */
    articleId: uuid("article_id"),
    unitPrice: integer("unit_price").notNull().default(0),
    arrivalDate: date("arrival_date", { mode: "string" }).notNull(),
    departureDate: date("departure_date", { mode: "string" }).notNull(),
    description: text("description").notNull().default(""),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pms_reservation_items_position_unique").on(t.reservationId, t.position),
    index("pms_reservation_items_room_period").on(t.roomId, t.arrivalDate, t.departureDate),
    check("pms_reservation_items_position", sql`${t.position} between 1 and 100`),
    check("pms_reservation_items_period", sql`${t.departureDate} > ${t.arrivalDate}`),
    check("pms_reservation_items_description_length", sql`char_length(${t.description}) <= 2000`),
    check("pms_reservation_items_unit_price", sql`${t.unitPrice} between 0 and 999999999`),
  ],
);

/** Monatliche Meldung der Beherbergungsstatistik. */
export const pmsTourismReports = pgTable(
  "pms_tourism_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: smallint("year").notNull(),
    month: smallint("month").notNull(),
    bedsOffered: integer("beds_offered").notNull().default(0),
    availableGuestRoomDays: integer("available_guest_room_days").notNull().default(0),
    occupiedGuestRoomDays: integer("occupied_guest_room_days").notNull().default(0),
    remarks: text("remarks").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pms_tourism_reports_period_unique").on(t.year, t.month),
    check("pms_tourism_reports_year", sql`${t.year} between 2000 and 2200`),
    check("pms_tourism_reports_month", sql`${t.month} between 1 and 12`),
    check("pms_tourism_reports_values", sql`${t.bedsOffered} >= 0 and ${t.availableGuestRoomDays} >= 0 and ${t.occupiedGuestRoomDays} >= 0`),
    check("pms_tourism_reports_remarks", sql`char_length(${t.remarks}) <= 1000`),
  ],
);

export const pmsTourismCountryValues = pgTable(
  "pms_tourism_country_values",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => pmsTourismReports.id, { onDelete: "cascade" }),
    countryKey: text("country_key").notNull(),
    arrivals: integer("arrivals").notNull().default(0),
    overnightStays: integer("overnight_stays").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.countryKey] }),
    check("pms_tourism_country_values_key", sql`char_length(${t.countryKey}) between 1 and 50`),
    check("pms_tourism_country_values_amounts", sql`${t.arrivals} >= 0 and ${t.overnightStays} >= ${t.arrivals}`),
  ],
);
