import { minusDays, utcDay } from "./regeln.ts";

/* Regeln des Stripe-Abrufs ohne Datenbank (stripe.ts wendet sie an). */

/**
 * Überlappung in Tagen: Der nächste Abruf beginnt so viele Tage vor dem Tag des letzten erfolgreichen. Eine Balance Transaction
 * trägt ihren Zeitpunkt (`created`) und ändert ihn nicht, kann aber kurz nach dem Abruf sichtbar werden; Haben erkennt schon
 * übernommene an ihrer Kennung und legt sie nicht noch einmal an.
 */
export const STRIPE_OVERLAP_DAYS = 3;

/** Erster Tag des nächsten Abrufs: drei Tage vor heute (UTC), aber nie vor dem bisherigen Start (`fetchFrom`) */
export function stripeNaechsterStart(fetchFrom: string, now: Date): string {
  return [minusDays(utcDay(now), STRIPE_OVERLAP_DAYS), fetchFrom].sort().at(-1)!;
}

/** Ein Schlüssel der Metadaten hat bei Stripe höchstens 40 Zeichen (https://docs.stripe.com/api/metadata) */
export const STRIPE_MAX_SCHLUESSEL_LAENGE = 40;
/** Mehr Schlüssel passen kaum in einen Verwendungszweck */
export const STRIPE_MAX_SCHLUESSEL = 10;

/** „invoice_number, customer_number“ → die Schlüssel in dieser Reihenfolge, ohne leere und doppelte */
export function stripeMetadatenSchluessel(text: string): string[] {
  const keys = text
    .split(/[,\n]/)
    .map((key) => key.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}
