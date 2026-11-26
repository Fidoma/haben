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
