import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders, setResponseStatus } from "@tanstack/react-start/server";
import { ReadOnlyError, runReadOnly } from "./db/actor.ts";
import { clientError, reportInternalError, userClientError } from "./errors.ts";
import { withLogComponent } from "./log-kontext.ts";
import { darf, sessionUser, type Zugriff } from "./rollen.ts";

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

/**
 * Übersetzt jeden Fehler aus Validator, Handler oder Sitzungsprüfung für den Browser:
 * Fachfehler und Eingabefehler mit ihrer Meldung, alles andere nur als „Interner Fehler“ mit der Fehler-ID der Zeile im Log.
 */
function toClientError(error: unknown): unknown {
  if (isRedirect(error) || isNotFound(error)) return error;
  if (error instanceof UnauthorizedError) {
    setResponseStatus(401);
    return clientError("Nicht angemeldet. Bitte neu anmelden.");
  }
  if (error instanceof ForbiddenError || error instanceof ReadOnlyError) {
    setResponseStatus(403);
    return clientError("Das darf nur der Inhaber. Die Steuerberatung hat nur Lesezugriff.");
  }
  const fachfehler = userClientError(error);
  if (fachfehler) return fachfehler;
  return clientError(reportInternalError("Unerwarteter Fehler in einer Server Function", error));
}

/**
 * Sitzung und Rolle prüfen, dann den Handler ausführen. Ohne Inhaber-Rolle läuft er in `runReadOnly`: Jede Transaktion
 * mit Audit-Akteur wird dann abgelehnt, auch wenn eine lesende Funktion aus Versehen etwas schreibt.
 */
function withAccess(zugriff: Zugriff) {
  return createMiddleware({ type: "function" }).server(({ next }) =>
    // Jede Logzeile der Server Function trägt den Bereich server (log-kontext.ts), auch die eines unerwarteten Fehlers
    withLogComponent("server", async () => {
      try {
        const user = await sessionUser(getRequestHeaders());
        if (!user) throw new UnauthorizedError();
        if (!darf(user.role, zugriff)) throw new ForbiddenError();
        const run = () => next({ context: { user } });
        return await (user.role === "inhaber" ? run() : runReadOnly(run));
      } catch (error) {
        throw toClientError(error);
      }
    }),
  );
}

/**
 * Vorgabe für jede Serverfunktion mit Daten: nur der Inhaber. Validator und Handler laufen innerhalb von `next()`.
 * Was die Steuerberatung auch sehen darf, nimmt stattdessen `readMiddleware`.
 */
export const authMiddleware = withAccess("inhaber");

/**
 * Nur für lesende GET-Funktionen, die die Steuerberatung braucht (Auswertungen, Journal, Konten, Belege, Rechnungen,
 * Export). `rollen.test.ts` prüft, dass sie nur an GET hängt, und führt die Liste dieser Funktionen.
 */
export const readMiddleware = withAccess("lesen");
