import { amountError, type Cents, formatDecimal, parseEuro } from "@haben/core";
import { parseAnteil } from "../lib/anteil.ts";
import { datumFehler, type FieldErrors } from "../lib/use-submit-check.ts";
import type { Person } from "./KapgAnteilseigner.tsx";

/*
 * Prüfung der Angaben zu den Erklärungen einer GmbH oder UG (KapgAngaben.tsx, #1277): je Feld und Zeile eine Meldung,
 * mit den Grenzen von kapgErklaerungSchema und saveKapgErklaerungAngaben (server/modules/koerperschaft/koerperschaft.ts).
 * Die Summe der Anteile prüft weiter der Server; sie gehört zu keinem einzelnen Feld.
 */

export type Vertrag = { art: string; datum: string; partner: string; verguetung: string };

export type AngabenFormular = { year: number; gruendung: string; einlagekonto: string; rechte: string; personen: Person[]; vertraege: Vertrag[] };

/** Höchstzahl der Anteilseigner und der Verträge wie im Schema des Servers */
export const HOECHSTZAHL = 20;

/** Größter Betrag in Cent wie im Schema des Servers */
const HOECHSTBETRAG: Cents = 100_000_000_000_00;

/** Fehler eines Betragsfelds: Mit `subject` ist es Pflicht, und die Meldung nennt es; ohne ist leer 0 */
export function betragFehler(text: string, beispiel: Cents, { subject, min = 0 }: { subject?: string; min?: Cents } = {}): string | null {
  const optional = subject === undefined;
  if (text.trim() === "") return optional ? null : amountError(subject, beispiel);
  const cents = parseEuro(text);
  if (cents === null) return amountError(subject ?? "den Betrag", beispiel, { optional });
  if (cents < min || cents > HOECHSTBETRAG)
    return amountError(`einen Betrag von ${formatDecimal(min)} bis ${formatDecimal(HOECHSTBETRAG)}`, beispiel, { optional });
  return null;
}

const pflicht = (text: string, meldung: string) => (text.trim() === "" ? meldung : null);

/** Identifikationsnummer (11 Ziffern) oder Steuernummer im ELSTER-Format (13 Ziffern); Trennzeichen zählen nicht */
const nummerGueltig = (nummer: string) => [11, 13].includes(nummer.replace(/\D/g, "").length);

function anteilseignerFehler(p: Person): Record<string, string | null> {
  return {
    name: pflicht(p.name, "Trag den Namen ein."),
    strasse: pflicht(p.strasse, "Trag Straße und Hausnummer ein."),
    plzOrt: pflicht(p.plzOrt, "Trag PLZ und Ort ein."),
    nummer: nummerGueltig(p.nummer) ? null : "Trag die Identifikationsnummer mit 11 Ziffern oder die Steuernummer mit 13 Ziffern ein.",
    beteiligung: betragFehler(p.beteiligung, 2_500_000, { subject: "die Beteiligung" }),
    anteil: parseAnteil(p.anteil) === null ? "Trag den Anteil in Prozent ein, etwa 50 oder 33,33." : null,
    religionsschluessel:
      p.kirchensteuer === 0 || /^\d{6}$/.test(p.religionsschluessel.trim()) ? null : "Trag den Religionsschlüssel mit sechs Ziffern ein, etwa 010100.",
  };
}

function vertragFehler(v: Vertrag): Record<string, string | null> {
  return {
    art: pflicht(v.art, "Trag die Vertragsart ein, etwa Geschäftsführervertrag."),
    datum: v.datum === "" ? "Wähle das Datum." : null,
    partner: pflicht(v.partner, "Trag den Vertragspartner ein."),
    verguetung: betragFehler(v.verguetung, 6_000_000, { subject: "die Vergütung" }),
  };
}

/** Schlüssel je Zeile: `anteilseigner.0.anteil`, `vertrag.1.verguetung` */
const zeilen = <T>(gruppe: string, liste: readonly T[], fehler: (zeile: T) => Record<string, string | null>) =>
  liste.flatMap((zeile, i) => Object.entries(fehler(zeile)).map(([feld, e]) => [`${gruppe}.${i}.${feld}`, e] as const));

/** Fehler der Angaben je Feld und Zeile, oder null, wo die Angabe stimmt */
export function kapgAngabenFehler(f: AngabenFormular): FieldErrors<string> {
  return {
    gruendung: f.gruendung === "" ? null : datumFehler(f.gruendung, `${f.year}-01-01`, `${f.year}-12-31`),
    einlagekonto: betragFehler(f.einlagekonto, 2_500_000, { min: -HOECHSTBETRAG }),
    rechte: betragFehler(f.rechte, 100_000),
    ...Object.fromEntries(zeilen("anteilseigner", f.personen, anteilseignerFehler)),
    ...Object.fromEntries(zeilen("vertrag", f.vertraege, vertragFehler)),
  };
}
