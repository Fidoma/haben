import type { Cents } from "@haben/core";
import { XMLParser } from "fast-xml-parser";

/*
 * Lesen der Belege der vorausgefüllten Steuererklärung nach ihrem Schema (#1328), für vast-vorschlag.ts. Anders als
 * parseVastBeleg (Anzeige aller Werte) greift es auf benannte Elemente zu; ein Element, das mehrfach vorkommen darf, ist
 * hier immer eine Liste.
 */

export type XmlKnoten = Record<string, unknown>;

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });

const liste = (wert: unknown): unknown[] => (wert === undefined || wert === null || wert === "" ? [] : Array.isArray(wert) ? wert : [wert]);

/** Wurzelelement des Belegs, z. B. der Inhalt von <VaSt_LStB> */
export function belegWurzel(xml: string, belegart: string): XmlKnoten | null {
  const doc = parser.parse(xml.replace(/^\s*<\?xml[^>]*\?>/, "")) as XmlKnoten;
  // Eine Hülle <Belege> wie in parseVastBeleg: der erste Beleg der Art darin
  const wurzel = doc[belegart] ?? liste((doc.Belege as XmlKnoten | undefined)?.[belegart])[0];
  return wurzel && typeof wurzel === "object" ? (wurzel as XmlKnoten) : null;
}

/** Alle Knoten unter dem Pfad; jede Stufe darf wiederholt sein */
export function alle(knoten: unknown, ...pfad: string[]): XmlKnoten[] {
  let stufe: unknown[] = [knoten];
  for (const name of pfad) {
    stufe = stufe.flatMap((k) => (k && typeof k === "object" ? liste((k as XmlKnoten)[name]) : []));
  }
  return stufe.filter((k): k is XmlKnoten => typeof k === "object" && k !== null);
}

/** Text des ersten Elements unter dem Pfad, sonst undefined */
export function wert(knoten: unknown, ...pfad: string[]): string | undefined {
  const name = pfad.at(-1);
  if (name === undefined) return undefined;
  for (const eltern of alle(knoten, ...pfad.slice(0, -1))) {
    const w = liste(eltern[name])[0];
    if (typeof w === "string" || typeof w === "number") return String(w).trim();
  }
  return undefined;
}

/** Betrag laut Schema (`-?\d{1,12}(\.\d{2})`) in Cent; anderes als undefined, nie über eine Gleitkommazahl */
export function cents(text: string | undefined): Cents | undefined {
  const m = text?.match(/^(-?)(\d{1,12})(?:\.(\d{2}))?$/);
  if (!m) return undefined;
  const betrag = Number(m[2]) * 100 + Number(m[3] ?? 0);
  return m[1] ? -betrag : betrag;
}

/** Betrag unter dem Pfad in Cent */
export const betrag = (knoten: unknown, ...pfad: string[]) => cents(wert(knoten, ...pfad));

/**
 * Rundung der Zuordnung (ZI-Plausi Tabelle 4-12): Aufrunden auf die nächste größere, Abrunden auf die nächste kleinere ganze
 * Zahl, auch bei negativen Beträgen; Ergebnis in Cent auf volle Euro
 */
export const abrunden = (c: Cents): Cents => c - (((c % 100) + 100) % 100);
export const aufrunden = (c: Cents): Cents => -abrunden(-c);
