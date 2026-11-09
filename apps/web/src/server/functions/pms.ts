import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import {
  cancelReservation,
  createReservationInvoice,
  createReservation,
  createRoom,
  listReservations,
  listRooms,
  reservationFormOptions,
  reservationInputSchema,
  roomInputSchema,
  setRoomArchived,
  updateReservation,
  updateRoom,
} from "../modules/pms/index.ts";
import { today } from "../today.ts";

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
