/*
 * Gemeinsame Regeln des Abrufs ohne Datenbank (#1729): Tage rechnen und wann der Zeitplan abruft. Wie weit ein Abruf
 * zurückgreift, regelt der Adapter (stripe.ts, paypal.ts); die Tests prüfen beides ohne Postgres.
 */

export function minusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Heute als Tag in UTC; die Fenster des Abrufs rechnen in UTC */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/** Wie oft der Zeitplan abruft */
export const RHYTHMEN = ["stuendlich", "taeglich", "woechentlich"] as const;
export type Rhythmus = (typeof RHYTHMEN)[number];

const STUNDE = 60 * 60 * 1000;
/** Abstand je Rhythmus mit etwas Luft, weil der Zeitplan selbst nur stündlich läuft */
const ABSTAND: Record<Rhythmus, number> = {
  stuendlich: 50 * 60 * 1000,
  taeglich: 20 * STUNDE,
  woechentlich: 7 * 24 * STUNDE - 4 * STUNDE,
};

/**
 * Ist der automatische Abruf fällig? Nach einem Fehlschlag versucht es der Zeitplan spätestens nach einem Tag erneut,
 * auch beim wöchentlichen Rhythmus.
 */
export function abrufFaellig(rhythmus: Rhythmus, letzter: { zeit: Date; fehlgeschlagen: boolean } | null, jetzt: Date): boolean {
  if (!letzter) return true;
  const vergangen = jetzt.getTime() - letzter.zeit.getTime();
  if (letzter.fehlgeschlagen && vergangen >= ABSTAND.taeglich) return true;
  return vergangen >= ABSTAND[rhythmus];
}
