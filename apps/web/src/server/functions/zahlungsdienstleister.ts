import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import {
  abrufen,
  entferneVerbindung,
  speichereVerbindung,
  verbindungenUebersicht,
  verbindungSchema,
  zugangPruefen,
} from "../modules/zahlungsdienstleister/index.ts";

/** Verbindungen zu Zahlungsdienstleistern über ihre API (#1729), eingerichtet auf der Bankseite (#1951) */

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

/** Schritt „Zugang“ der Einrichtung: prüft den Zugang beim Anbieter, ohne etwas zu speichern */
export const checkPspAccessFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(verbindungSchema.pick({ provider: true, eingabe: true, config: true }))
  .handler(async ({ data }) => zugangPruefen(data.provider, data.eingabe, data.config));
