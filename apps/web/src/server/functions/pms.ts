import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { createRoom, listRooms, roomInputSchema, setRoomArchived, updateRoom } from "../modules/pms/index.ts";

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
