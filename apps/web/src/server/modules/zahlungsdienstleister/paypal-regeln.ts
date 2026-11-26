import { minusDays, utcDay } from "./regeln.ts";

/* Regeln des PayPal-Abrufs ohne Datenbank (paypal.ts wendet sie an). */

/**
 * Überlappung in Tagen: Der nächste Abruf beginnt so viele Tage vor dem Tag des letzten erfolgreichen. PayPal stellt
 * Transaktionen bis zu drei Stunden verzögert bereit (Transaction Search), und eine Zahlung trägt den Tag ihres Beginns, auch wenn
 * sie später abgeschlossen wird (Lastschrift: einige Tage). Ob die Liste der Zeilen, die das Guthaben ändern, eine ausstehende
 * Zahlung überhaupt zeigt, ist nicht belegt; der Überlapp fängt deshalb auch Zahlungen auf, die der Abruf nie als `P` gesehen hat.
 */
export const PAYPAL_OVERLAP_DAYS = 10;

/**
 * Wie lange eine ausstehende Zahlung (Status P) den Start des nächsten Abrufs zurückhält: PayPal ändert ihren Status später,
 * ohne ihren Tag zu ändern, sie wird erst mit einem späteren Abruf fertig (Lastschrift braucht einige Tage). Danach gibt Haben
 * sie auf und meldet sie weiter als ausstehend.
 */
export const AUSSTEHEND_TAGE = 45;

/**
 * Wie weit zurück der erste Tag liegen darf: PayPal hält drei Jahre vor („This call lists transaction for the previous
 * three years“), der Abruf beginnt einen Tag früher als der gewählte Tag; die Grenze lässt Luft.
 */
export const MAX_RUECKBLICK_TAGE = 1090;

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/**
 * Fenster eines Abrufs: vom Start bis zum Tag des Abrufs in UTC. Der erste Start ist der deutsche Tag (`today()`); zwischen
 * Mitternacht in Deutschland und Mitternacht in UTC läge er hinter dem Ende, und der Importvertrag lehnte das Fenster ab.
 * Deshalb beginnt es höchstens am UTC-Tag; einen Tag mehr zu holen schadet nicht, Haben erkennt Übernommenes an der Kennung.
 */
export function paypalFenster(fetchFrom: string, now: Date): { dateFrom: string; dateTo: string } {
  const dateTo = utcDay(now);
  return { dateFrom: earlier(fetchFrom, dateTo), dateTo };
}

/**
 * Erster Tag des nächsten Abrufs: zehn Tage vor dem Tag dieses erfolgreichen Abrufs, nie vor dem bisherigen Start (`fetchFrom`).
 * Liegt eine ausstehende Zahlung zurück (`offenSeit`, ihr Tag), beginnt der Abruf an diesem Tag, höchstens aber `AUSSTEHEND_TAGE` zurück.
 */
export function paypalNaechsterStart(fetchFrom: string, now: Date, offenSeit: string | null = null): string {
  const start = later(minusDays(utcDay(now), PAYPAL_OVERLAP_DAYS), fetchFrom);
  if (!offenSeit) return start;
  return later(earlier(start, offenSeit), later(minusDays(utcDay(now), AUSSTEHEND_TAGE), fetchFrom));
}
