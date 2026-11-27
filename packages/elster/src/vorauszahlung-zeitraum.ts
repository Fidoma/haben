/*
 * Zeitraum des Antrags auf Anpassung der Vorauszahlungen (AnpassungVorauszahlung v22, Eing_Vorauszlg-22.xsd), ohne
 * Abhängigkeiten, damit ihn auch der Browser nutzt (`@haben/elster/vorauszahlung-zeitraum`).
 */

/** Ab welchem Quartal, oder nVz für die nachträgliche Vorauszahlung */
export const VORAUSZAHLUNG_QUARTALE = ["Q1", "Q2", "Q3", "Q4", "nVz"] as const;
export type VorauszahlungQuartal = (typeof VORAUSZAHLUNG_QUARTALE)[number];

/** Jahre, die ELSTER annimmt: eins voraus bis drei zurück (Regel eEing_144), von heute (JJJJ-MM-TT) aus */
export function vorauszahlungJahre(heute: string): number[] {
  const jahr = Number(heute.slice(0, 4));
  return [jahr + 1, jahr, jahr - 1, jahr - 2, jahr - 3];
}

/**
 * Vorschlag: das Quartal des nächsten Fälligkeitstermins (10.3., 10.6., 10.9., 10.12., § 37 Abs. 1 EStG); nach dem 10.12.
 * das 1. Quartal des Folgejahres.
 */
export function naechsterTermin(heute: string): { quartal: Exclude<VorauszahlungQuartal, "nVz">; jahr: number } {
  const jahr = Number(heute.slice(0, 4));
  const tag = heute.slice(5);
  if (tag <= "03-10") return { quartal: "Q1", jahr };
  if (tag <= "06-10") return { quartal: "Q2", jahr };
  if (tag <= "09-10") return { quartal: "Q3", jahr };
  if (tag <= "12-10") return { quartal: "Q4", jahr };
  return { quartal: "Q1", jahr: jahr + 1 };
}
