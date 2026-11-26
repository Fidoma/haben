import { HOECHSTER_HEBESATZ, mindestHebesatz, parseWholePercent } from "@haben/core";
import type { FieldErrors } from "../lib/use-submit-check.ts";
import { betragFehler } from "./kapg-angaben-pruefung.ts";

/*
 * Prüfung der Angaben zur Körperschaft- und Gewerbesteuer (KapgSteuern.tsx, #1277): je Feld eine Meldung, mit den Grenzen
 * von kapgAngabenSchema und dem Mindesthebesatz aus saveKapgAngaben (server/modules/koerperschaft/koerperschaft.ts).
 */

export type SteuernFeld = "hebesatz" | "vortragKst" | "vortragGewst" | "ruecktrag";

export type SteuernFormular = { year: number } & Record<SteuernFeld, string>;

function hebesatzFehler(text: string, year: number): string | null {
  const satz = parseWholePercent(text);
  if (satz === null) return "Trag den Hebesatz der Gemeinde in ganzen Prozent ein, etwa 400.";
  const mindest = mindestHebesatz(year);
  if (satz < mindest) return `Der Hebesatz beträgt ${year} mindestens ${mindest} %.`;
  return satz > HOECHSTER_HEBESATZ ? `Trag einen Hebesatz bis ${HOECHSTER_HEBESATZ.toLocaleString("de-DE")} % ein.` : null;
}

/** Fehler der Angaben je Feld, oder null, wo die Angabe stimmt; leere Verlustvorträge gelten als 0 */
export function kapgSteuernFehler(f: SteuernFormular): FieldErrors<SteuernFeld> {
  return {
    hebesatz: hebesatzFehler(f.hebesatz, f.year),
    vortragKst: betragFehler(f.vortragKst, 1_000_000),
    vortragGewst: betragFehler(f.vortragGewst, 1_000_000),
    ruecktrag: betragFehler(f.ruecktrag, 500_000),
  };
}
