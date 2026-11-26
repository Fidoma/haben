import { createServerFn } from "@tanstack/react-start";
import { excludeBlocker, listAccounts, listExcludedAccounts } from "../modules/bank/index.ts";
import { authMiddleware } from "../middleware.ts";
import { abrufUndKarten, kontenAngaben } from "./bank-karten.ts";

/**
 * Seite Verbindungen (#1951): alle Konten mit Weg, Stand, Saldo und Status, dazu der Abruf (Enable Banking, FinTS,
 * Zahlungsdienstleister), was „Name und Zweck“ und „Konto hinzufügen“ brauchen, und warum ein Konto nicht ausgeschlossen
 * werden kann
 */
export const getBankVerbindungen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const accounts = await listAccounts();
    const blocker = await Promise.all(accounts.map(async (a) => [a.id, a.purpose === "zahlungsdienstleister" ? null : await excludeBlocker(a.id)] as const));
    return {
      accounts,
      excludeBlockedBy: Object.fromEntries(blocker) as Record<string, string | null>,
      excludedAccounts: (await listExcludedAccounts()).map((a) => ({ ...a, excludedAt: a.excludedAt?.toISOString() ?? null })),
      ...(await kontenAngaben(accounts)),
      ...(await abrufUndKarten(accounts)),
    };
  });
