import { roundHalfAwayFromZero, type Cents } from "@haben/core";
import { abrunden, aufrunden } from "./est-werte.ts";
import { alle, betrag, wert, type XmlKnoten } from "./vast-lesen.ts";

/*
 * Kranken- und Pflegeversicherung aus VaSt_KRV (#1328), nach VAST_Vorberechnungen_<Jahr>.ods, Blatt „VaSt_KRV_Gesamt -
 * Regeln“ (gleich für 2022 bis 2025): je Person die Summe der Beträge nach Art, Beiträge aufgerundet, Erstattungen
 * abgerundet, über der Grenze kein Wert. Codes laut Schema: MerkmalBeitragArt 1 gesetzlich, 2 privat; BetragArt 01 Beitrag
 * ohne, 02 mit Anspruch auf Krankengeld, 05 Pflege, 06/07/10 Erstattungen, 15 bis 18 Zuschüsse und ihre Rückforderung;
 * MerkmalBeiTrag 1 Dritte, 2 unbekannt, 3 Versicherungsnehmer.
 */

export interface KrvSumme {
  /** Gesetzlich, ohne Anteil für Krankengeld (E2001805 abzüglich 4 % der Beiträge mit Krankengeld) */
  gkv?: Cents;
  /** Gesetzlich, Anteil für Krankengeld */
  gkvZusatz?: Cents;
  gpv?: Cents;
  pkv?: Cents;
  ppv?: Cents;
  pkvErstattung?: Cents;
}

/** Beitragsdaten eines Belegs mit dem Beleg dahinter */
export interface KrvBeitrag {
  knoten: XmlKnoten;
  id: string;
}

/**
 * Beitragsdaten eines Belegs, die für die versicherte Person zählen (Filter der Regeln, etwa Berechne_E2001805_Ungeprueft):
 * Die erste IdNr unter den Versicherungsnehmern gehört zu Person A oder B und der Beitrag ist nicht von Dritten getragen,
 * oder ein Versicherungsnehmer ist eine Firma (dann zählen auch Beiträge Dritter)
 */
export function krvBeitraege(root: XmlKnoten, id: string, idnrPaar: readonly string[]): KrvBeitrag[] {
  const vn = ["BetroffenerFall", "BetroffenePerson", "WeiterePerson"];
  const vnIdnr = wert(root, ...vn, "NatPerson", "IdNr");
  const firma = alle(root, ...vn, "NNPers").some((n) => wert(n, "Firmenname") !== undefined);
  return alle(root, "Vertragsdaten", "Beitragsdaten")
    .filter((d) => {
      const merkmal = wert(d, "MerkmalBeiTrag");
      const vonPerson = vnIdnr !== undefined && idnrPaar.includes(vnIdnr) && (merkmal === undefined || merkmal === "2" || merkmal === "3");
      return vonPerson || (firma && (merkmal === undefined || ["1", "2", "3"].includes(merkmal)));
    })
    .map((knoten) => ({ knoten, id }));
}

/** Beiträge der Art und die Belege dahinter */
function auswahl(daten: readonly KrvBeitrag[], merkmalArt: string, arten: readonly string[]): { summe: Cents; ids: string[] } {
  const mit = daten.filter((d) => wert(d.knoten, "MerkmalBeitragArt") === merkmalArt && arten.includes(wert(d.knoten, "BetragArt") ?? ""));
  return { summe: mit.reduce((s, d) => s + (betrag(d.knoten, "Betrag") ?? 0), 0), ids: [...new Set(mit.map((d) => d.id))] };
}

const gerundet = (a: { summe: Cents; ids: string[] }, runden: (c: Cents) => Cents) => ({ summe: runden(a.summe), ids: a.ids });

/** Grenze der Regel in Euro je Feld; darüber bleibt das Feld leer */
const GRENZE: Record<keyof KrvSumme, number> = { gkv: 99_999, gkvZusatz: 99_999, gpv: 9_999, pkv: 99_999, ppv: 9_999, pkvErstattung: 99_999 };

/**
 * Summen je Person. Abweichend von der Zuordnung (erlaubt laut Entwicklerhandbuch S. 332, Fußnote 68) stehen Beiträge mit
 * Anspruch auf Krankengeld nicht als eigene Zeile (E2002005), sondern wie in Habens Angaben: um 4 % gemindert im Beitrag,
 * die 4 % als Krankengeldanteil (§ 10 Abs. 1 Nr. 3 Buchst. a Satz 4 EStG)
 */
export function krvSumme(daten: readonly KrvBeitrag[]): { werte: KrvSumme; herkunft: Partial<Record<keyof KrvSumme, string[]>>; ueberGrenze: string[] } {
  const gesetzlich = auswahl(daten, "1", ["01", "02"]);
  const mitKrankengeld = auswahl(daten, "1", ["02"]);
  const anteil = roundHalfAwayFromZero((mitKrankengeld.summe * 4) / 100);
  const roh: Record<keyof KrvSumme, { summe: Cents; ids: string[] }> = {
    gkv: { summe: aufrunden(gesetzlich.summe - anteil), ids: gesetzlich.ids },
    gkvZusatz: { summe: anteil, ids: mitKrankengeld.ids },
    gpv: gerundet(auswahl(daten, "1", ["05"]), aufrunden),
    pkv: gerundet(auswahl(daten, "2", ["01"]), aufrunden),
    ppv: gerundet(auswahl(daten, "2", ["05"]), aufrunden),
    pkvErstattung: gerundet(auswahl(daten, "2", ["06", "10"]), abrunden),
  };
  const werte: KrvSumme = {};
  const herkunft: Partial<Record<keyof KrvSumme, string[]>> = {};
  const ueberGrenze: string[] = [];
  for (const feld of Object.keys(roh) as (keyof KrvSumme)[]) {
    const { summe, ids } = roh[feld];
    if (summe === 0) continue;
    if (Math.abs(summe) > GRENZE[feld] * 100) {
      ueberGrenze.push(feld);
      continue;
    }
    werte[feld] = summe;
    herkunft[feld] = ids;
  }
  return { werte, herkunft, ueberGrenze };
}

/** Gibt es Beträge, die Haben noch in kein Feld übernimmt: gesetzliche Erstattungen, Zuschüsse? */
export function krvOhneFeld(daten: readonly KrvBeitrag[]): { erstattungGesetzlich: boolean; zuschuss: boolean } {
  const zuschuss = ["15", "16", "17", "18"];
  return {
    erstattungGesetzlich: auswahl(daten, "1", ["06", "07", "10"]).summe !== 0,
    zuschuss: auswahl(daten, "1", zuschuss).summe !== 0 || auswahl(daten, "2", zuschuss).summe !== 0,
  };
}
