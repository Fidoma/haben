import { roundHalfAwayFromZero, type Cents } from "@haben/core";
import type { XmlNode } from "./erklaerung.ts";
import { elsterDecimal } from "./xml.ts";

/* Werte und Bausteine, die die Vordrucke der Einkommensteuererklärung (est.ts) gemeinsam nutzen */

/** Ganze Euro, kaufmännisch gerundet; leer bei 0 (das Feld entfällt dann) */
export const euro = (cents: Cents | undefined): string | undefined => {
  if (!cents) return undefined;
  const value = roundHalfAwayFromZero(cents / 100);
  return value === 0 ? undefined : String(value);
};
/**
 * Rundung der Zuordnung (ZI-Plausi Tabelle 4-12): Aufrunden auf die nächste größere, Abrunden auf die nächste kleinere ganze
 * Zahl, auch bei negativen Beträgen; Ergebnis in Cent auf volle Euro
 */
export const abrunden = (c: Cents): Cents => c - (((c % 100) + 100) % 100);
export const aufrunden = (c: Cents): Cents => -abrunden(-c);
/** Ganze Euro zugunsten der Person wie die amtliche Zuordnung: Beiträge aufgerundet, Abzüge abgerundet; leer bei 0 */
export const euroAuf = (cents: Cents | undefined) => euro(cents && aufrunden(cents));
export const euroAb = (cents: Cents | undefined) => euro(cents && abrunden(cents));
export const mitCent = (cents: Cents | undefined) => (cents ? elsterDecimal(cents) : undefined);
export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Zeitraum TT.MM-TT.MM im Jahr: ab Geburt, wenn das Kind im Jahr geboren ist */
export function kindZeitraum(year: number, geburtsdatum: string): string {
  const von = geburtsdatum.startsWith(`${year}-`) ? `${geburtsdatum.slice(8, 10)}.${geburtsdatum.slice(5, 7)}` : "01.01";
  return `${von}-31.12`;
}

/** Summenblock mit genau einem Einzelposten; ERiC verlangt mindestens einen */
export const einzelUndSumme = (name: string, art: [string, string], betrag: string, summe: string, cents: Cents | undefined): XmlNode | null => {
  const value = euro(cents);
  if (!value) return null;
  return [
    name,
    [
      [
        "Einz",
        [
          [art[0], art[1]],
          [betrag, value],
        ],
      ],
      ["Sum", [[summe, value]]],
    ],
  ];
};
