import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import {
  cancelReservation,
  createReservationInvoice,
  createReservation,
  createRoom,
  defaultScheduleRange,
  listHousekeepingRooms,
  getTourismReport,
  prefillTourismReport,
  listReservations,
  listRooms,
  reservationSchedule,
  reservationFormOptions,
  reservationInputSchema,
  roomInputSchema,
  setRoomArchived,
  setCleaningStatus,
  saveTourismReport,
  tourismReportCsv,
  tourismReportInputSchema,
  tourismCountries,
  updateReservation,
  updateRoom,
} from "../modules/pms/index.ts";
import { today } from "../today.ts";

const scheduleInputSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
});

export const getReservationSchedule = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(scheduleInputSchema)
  .handler(async ({ data }) => {
    const currentDay = today();
    const defaults = defaultScheduleRange(currentDay);
    const explicitRange = data.start && data.end ? { startDate: data.start, endDate: data.end } : defaults;
    return reservationSchedule(explicitRange.startDate, explicitRange.endDate, currentDay);
  });

export const getReservations = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listReservations());

export const getReservationFormOptions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => reservationFormOptions());

export const saveReservation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), reservation: reservationInputSchema }))
  .handler(async ({ data, context }) => {
    const row = data.id ? await updateReservation(context.user.id, data.id, data.reservation) : await createReservation(context.user.id, data.reservation);
    return { id: row.id };
  });

export const cancelPmsReservation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await cancelReservation(context.user.id, data.id);
    return { ok: true };
  });

export const createPmsReservationInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    const invoice = await createReservationInvoice(context.user.id, data.id, today());
    return { id: invoice.id };
  });

export const getRooms = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listRooms({ archived: true }));

export const getHousekeepingRooms = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listHousekeepingRooms());

export const updateCleaningStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ roomId: z.uuid(), status: z.enum(["clean", "dirty"]) }))
  .handler(async ({ data, context }) => {
    await setCleaningStatus(context.user.id, data.roomId, data.status);
    return { ok: true };
  });

const tourismPeriodSchema = z.object({ year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12) });

export const getPmsTourismReport = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(tourismPeriodSchema)
  .handler(async ({ data }) => ({
    report: (await getTourismReport(data.year, data.month)) ?? (await prefillTourismReport(data.year, data.month)),
    countries: tourismCountries,
  }));

export const savePmsTourismReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(tourismReportInputSchema)
  .handler(({ data, context }) => saveTourismReport(context.user.id, data));

export const exportPmsTourismReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ report: tourismReportInputSchema, includeHeader: z.boolean() }))
  .handler(({ data }) => ({
    filename: `HOTE_haben_${data.report.year}-${String(data.report.month).padStart(2, "0")}.csv`,
    content: Buffer.from(tourismReportCsv(data.report, data.includeHeader)).toString("base64"),
  }));

export const saveRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), room: roomInputSchema }))
  .handler(async ({ data, context }) => {
    const row = data.id ? await updateRoom(context.user.id, data.id, data.room) : await createRoom(context.user.id, data.room);
    return { id: row.id };
  });

export const archiveRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setRoomArchived(context.user.id, data.id, data.archived);
    return { ok: true };
  });
