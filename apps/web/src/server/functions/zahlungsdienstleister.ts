import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { abrufen, entferneVerbindung, speichereVerbindung, verbindungenUebersicht, verbindungSchema } from "../modules/zahlungsdienstleister/index.ts";

/** Verbindungen zu Zahlungsdienstleistern über ihre API (Einstellungen › Bank, #1729) */

const idSchema = z.object({ id: z.uuid() });

export const getPspSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => verbindungenUebersicht());

export const savePspConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(verbindungSchema)
  .handler(async ({ data, context }) => ({ id: await speichereVerbindung(context.user.id, data) }));

export const removePspConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(idSchema)
  .handler(async ({ data, context }) => {
    await entferneVerbindung(context.user.id, data.id);
    return { ok: true };
  });

export const syncPspNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(idSchema)
  .handler(async ({ data, context }) => abrufen(context.user.id, data.id));
