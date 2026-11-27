import type { Cents } from "@haben/core";
import type { EstErsatzleistung, EstLohnsteuerbescheinigung, EstVorsorgePerson } from "./est.ts";
import { vastBelegartLabel } from "./vast.ts";
import { abrunden, aufrunden } from "./est-werte.ts";
import { alle, belegWurzel, betrag, wert, type XmlKnoten } from "./vast-lesen.ts";
import { type KrvBeitrag, krvBeitraege, krvOhneFeld, krvSumme } from "./vast-vorschlag-krv.ts";

/*
 * Vorschläge für die Einkommensteuererklärung aus den Belegen der vorausgefüllten Steuererklärung (#1328), nach der
 * amtlichen Zuordnung: ERiC-Dokumentation 44.3.6.0, VaSt-Belege/Zuordnungsinformationen/ESt_<Jahr>/
 * Jahresdokumentation_VAST_Vorberechnungen_<Jahr>.ods (2022 bis 2025). Nur für Angaben, die Haben schon schreibt; alles
 * andere steht als Hinweis da. Die Zuordnung ist ein Vorschlag der Finanzverwaltung, Hersteller dürfen abweichen
 * (Entwicklerhandbuch S. 332, Fußnote 68); Abweichungen stehen an der jeweiligen Stelle.
 */

/** Jahre mit amtlicher Zuordnung im ERiC-Paket */
export const VAST_JAHRE = [2022, 2023, 2024, 2025] as const;

/** Ein gespeicherter Beleg (vast_belege) */
export interface VastQuelle {
  id: string;
  belegart: string;
  schemaversion: string;
  test: boolean;
  xml: string;
}

type Person = "a" | "b";
type JePerson<T> = { a?: T; b?: T };

/** Eintrag der Person, angelegt beim ersten Zugriff */
function eintrag<T>(o: JePerson<T>, person: Person, neu: () => NoInfer<T>): T {
  const vorhanden = o[person];
  if (vorhanden !== undefined) return vorhanden;
  const angelegt = neu();
  o[person] = angelegt;
  return angelegt;
}

export interface VastVorschlag {
  /** Anlage N: eine Lohnsteuerbescheinigung je Beleg */
  arbeitnehmer: JePerson<{ herkunft: string; bescheinigung: EstLohnsteuerbescheinigung }[]>;
  /** Vorsorgeaufwand je Person, mit den Belegen hinter jedem Wert */
  vorsorge: JePerson<{ werte: Partial<EstVorsorgePerson>; herkunft: Partial<Record<keyof EstVorsorgePerson, string[]>> }>;
  /** Einkommensersatzleistungen, eine je Leistung */
  ersatzleistungen: JePerson<{ herkunft: string[]; leistung: EstErsatzleistung }[]>;
  /** Gezahlte Kirchensteuer laut Lohnsteuerbescheinigungen beider Personen (Sonderausgaben, Berechne_E0108004) */
  sonderausgaben?: { werte: { kirchensteuerGezahlt: Cents }; herkunft: { kirchensteuerGezahlt: string[] } };
  /** Was Haben nicht übernimmt, mit Grund */
  hinweise: string[];
}

/** Version der Belege, deren Zuordnung Haben kennt: JJJJ01 je Steuerjahr (Schemas unter VaSt-Belege/Schema/<Jahr>/) */
const versionFuer = (year: number) => `${year}01`;

const LSTB_OHNE_FELD: Record<string, string> = {
  LeistungenProgVorbeh: "Lohnersatz (Nr. 15)",
  KurzArbGeld: "Kurzarbeitergeld (Nr. 15)",
  VBez: "Versorgungsbezüge",
  ErmStVBezMKalJahr: "Versorgungsbezüge für mehrere Jahre",
  ErmStBetrMKalJahr: "Arbeitslohn für mehrere Jahre",
  StPflichtArbLohnMKalJahr: "Arbeitslohn für mehrere Jahre",
  StFreiArbLohnDBA: "steuerfreier Arbeitslohn nach DBA",
  StFreiArbLohnATE: "steuerfreier Arbeitslohn nach ATE",
  StFreiArbgLeistg: "steuerfreie Arbeitgeberleistungen für Fahrten",
  PauschArbgLeistg: "pauschal besteuerte Arbeitgeberleistungen für Fahrten",
  StFreiFahrtKAusw: "steuerfreie Fahrtkostenerstattung",
  StFreiVerpfleg: "steuerfreie Verpflegungszuschüsse",
  StFreiDopHaushalt: "steuerfreie Erstattungen bei doppelter Haushaltsführung",
};

const plus = (...werte: (Cents | undefined)[]): Cents | undefined =>
  werte.some((w) => w !== undefined) ? werte.reduce<number>((s, w) => s + (w ?? 0), 0) : undefined;

const ohneLeere = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, w]) => w !== undefined && w !== 0)) as T;

/** Lohnsteuerbescheinigung → Spalte der Anlage N (VaSt_LStB - Regeln, Berechne_E0200204 … E0200604; Werte mit Cent) */
function bescheinigung(root: XmlKnoten): EstLohnsteuerbescheinigung | null {
  // Klasse im ersten ELStAM: 1–5 in die Spalten 1–5, 0 und 6 in die Spalte der Klasse 6 (Berechne_Klasse_1_5_Hilf)
  const klasse = wert(alle(root, "Besteuerungsmerkmal", "ELStAM")[0], "Steuerklasse", "Klasse");
  if (klasse === undefined || !/^[0-6]$/.test(klasse)) return null;
  const g = alle(root, "Besteuerungsgrund")[0];
  const kirchensteuer = betrag(g, "ArbnKiSteuer");
  return {
    steuerklasse: (klasse === "0" ? 6 : Number(klasse)) as EstLohnsteuerbescheinigung["steuerklasse"],
    brutto: betrag(g, "BruttoArbLohn") ?? 0,
    ...ohneLeere({
      lohnsteuer: betrag(g, "LSteuer"),
      soli: betrag(g, "Soli"),
      kirchensteuer,
      // Berechne_E0200604: nur neben der Kirchensteuer des Arbeitnehmers
      kirchensteuerEhegatte: kirchensteuer === undefined ? undefined : betrag(g, "EhegKiSteuer"),
      rvArbeitgeber: plus(betrag(g, "ArbgAnteilRenVers"), betrag(g, "ArbgAnteilBerufsVers")),
      rvArbeitnehmer: plus(betrag(g, "ArbnAnteilRenVers"), betrag(g, "ArbnAnteilBerufsVers")),
      kvArbeitnehmer: betrag(g, "ArbnAnteilKrankVers"),
      pvArbeitnehmer: betrag(g, "ArbnAnteilPflegVers"),
      avArbeitnehmer: betrag(g, "ArbnAnteilArblVers"),
    }),
  };
}

/** IdNr der Person im Beleg, je Belegart (Berechne_I_Person) */
function belegIdnr(belegart: string, root: XmlKnoten): string | undefined {
  if (belegart === "VaSt_LStB") return wert(root, "Allgemein", "IdNr");
  if (belegart === "VaSt_LErsL") return wert(root, "LeistungsEmpfaenger", "IdNr");
  if (belegart === "VaSt_RUE") return wert(root, "BetroffenerFall", "NatPerson", "IdNr");
  return wert(root, "BetroffenerFall", "BetroffenePerson", "NatPerson", "IdNr");
}

interface Sammlung {
  vorschlag: VastVorschlag;
  year: number;
  idnr: { a: string; b?: string };
  /** Je Person die Beiträge aller KRV-Belege mit dem Beleg dahinter */
  krv: JePerson<KrvBeitrag[]>;
  rue: JePerson<{ summe: Cents; ids: string[] }>;
  /** Zahlungsdaten der Zuschüsse nach § 10 Abs. 4b EStG mit dem Beleg dahinter */
  zuschuss: JePerson<{ knoten: XmlKnoten; id: string }[]>;
  /** Kirchensteuer je Lohnsteuerbescheinigung, für die Sonderausgaben */
  kirchensteuer: { person: Person; c: Cents; id: string }[];
  /** Lohnersatzleistungen je Beleg, in Belegreihenfolge; ohne Nullbeträge */
  lohnersatz: JePerson<{ id: string; leistungen: { art?: string; c: Cents }[] }[]>;
  /** Steuerfreie Arbeitgeberzuschüsse je Lohnsteuerbescheinigung: Element, Betrag, Beleg */
  agZuschuss: JePerson<{ element: string; c: Cents; id: string }[]>;
}

/** Steuerfreie Arbeitgeberzuschüsse laut Lohnsteuerbescheinigung (Nr. 24 a bis c) und ihr Feld */
const AG_ZUSCHUSS: [keyof EstVorsorgePerson, string][] = [
  ["agZuschussGkv", "StFreiGeKrankVers"],
  ["agZuschussKv", "StFreiPrKrankVers"],
  ["agZuschussPv", "StFreiGePflegVers"],
];

function vorsorgeWert(s: Sammlung, person: Person, feld: keyof EstVorsorgePerson, w: Cents, ids: string[]) {
  const v = eintrag(s.vorschlag.vorsorge, person, () => ({ werte: {}, herkunft: {} }));
  v.werte[feld] = w;
  v.herkunft[feld] = ids;
}

/** Kirchensteuer einer Lohnsteuerbescheinigung für die Sonderausgaben; bis 2024 samt der Beträge für mehrere Kalenderjahre */
function kirchensteuerLstb(g: XmlKnoten | undefined, year: number): Cents | undefined {
  const felder = ["ArbnKiSteuer", "EhegKiSteuer", ...(year <= 2024 ? ["KiSteuerArbnMKalJahr", "KiSteuerEhegMKalJahr"] : [])];
  return plus(...felder.map((f) => betrag(g, f)));
}

function lohnsteuerbescheinigung(s: Sammlung, person: Person, q: VastQuelle, root: XmlKnoten) {
  const g = alle(root, "Besteuerungsgrund")[0];
  // Summen je Person filtern nur nach der Person (VaSt_LStB_Gesamt - Regeln), nicht nach der Steuerklasse
  for (const [, element] of AG_ZUSCHUSS) {
    const c = betrag(g, element);
    if (c) eintrag(s.agZuschuss, person, () => []).push({ element, c, id: q.id });
  }
  const kirchensteuer = kirchensteuerLstb(g, s.year);
  if (kirchensteuer) s.kirchensteuer.push({ person, c: kirchensteuer, id: q.id });
  const b = bescheinigung(root);
  if (!b) {
    s.vorschlag.hinweise.push(
      `${vastBelegartLabel(q.belegart)} ${q.id}: ohne Steuerklasse, keine Spalte der Anlage N; Renten-, Kranken-, Pflege- und Arbeitslosenversicherung daraus fehlen im Vorschlag.`,
    );
    return;
  }
  eintrag(s.vorschlag.arbeitnehmer, person, () => []).push({ herkunft: q.id, bescheinigung: b });
  const ohneFeld = Object.entries(LSTB_OHNE_FELD).filter(([name]) => alle(g, name).length > 0 || wert(g, name) !== undefined);
  if (ohneFeld.length > 0) {
    s.vorschlag.hinweise.push(`${vastBelegartLabel(q.belegart)} ${q.id}: ${ohneFeld.map(([, label]) => label).join(", ")} übernimmt Haben noch nicht.`);
  }
}

function lohnersatz(s: Sammlung, person: Person, q: VastQuelle, root: XmlKnoten) {
  const leistungen = alle(root, "Leistung").flatMap((l) => {
    const c = betrag(l, "Betrag");
    return c ? [{ art: wert(l, "Art"), c }] : [];
  });
  eintrag(s.lohnersatz, person, () => []).push({ id: q.id, leistungen });
}

/** Höchstzahl der Einkommensersatzleistungen je Person (Berechne_Platz_PersonA/B) */
const LOHNERSATZ_PLAETZE = 20;

/**
 * Einkommensersatzleistungen (Berechne_E0104113, E0104110): je Leistung abgerundet, Art wie bescheinigt. Über 20 Leistungen
 * bekommt ein Beleg Platz, solange die Leistungen bis einschließlich seiner weniger als 20 sind; der erste Beleg ohne Platz
 * trägt die abgerundete Summe aus sich und allen folgenden als „Angabe aus Bescheinigungen“
 */
function lohnersatzAbschliessen(s: Sammlung, person: Person) {
  const belege = s.lohnersatz[person] ?? [];
  const gesamt = belege.reduce((n, b) => n + b.leistungen.length, 0);
  let bisher = 0;
  const rest: typeof belege = [];
  for (const b of belege) {
    bisher += b.leistungen.length;
    if (gesamt <= LOHNERSATZ_PLAETZE || bisher < LOHNERSATZ_PLAETZE) {
      for (const l of b.leistungen) {
        eintrag(s.vorschlag.ersatzleistungen, person, () => []).push({
          herkunft: [b.id],
          leistung: { art: l.art ?? "Angabe aus Bescheinigungen", betrag: abrunden(l.c) },
        });
      }
    } else rest.push(b);
  }
  const summe = abrunden(rest.reduce((t, b) => t + b.leistungen.reduce((u, l) => u + l.c, 0), 0));
  if (summe !== 0) {
    const herkunft = rest.filter((b) => b.leistungen.length > 0).map((b) => b.id);
    eintrag(s.vorschlag.ersatzleistungen, person, () => []).push({ herkunft, leistung: { art: "Angabe aus Bescheinigungen", betrag: summe } });
  }
}

/** Einen Beleg der Person einsammeln; was je Person summiert wird, rechnet abschliessen */
function sammeln(s: Sammlung, person: Person, q: VastQuelle, root: XmlKnoten) {
  if (q.belegart === "VaSt_LStB") return lohnsteuerbescheinigung(s, person, q, root);
  if (q.belegart === "VaSt_LErsL") return lohnersatz(s, person, q, root);
  if (q.belegart === "VaSt_RUE") {
    const summe = alle(root, "Vertragsdaten", "Beitragsdaten", "Werte").reduce((t, w) => t + (betrag(w, "Betrag") ?? 0), 0);
    const r = eintrag(s.rue, person, () => ({ summe: 0, ids: [] }));
    r.summe = r.summe + summe;
    r.ids.push(q.id);
    return;
  }
  if (q.belegart === "VaSt_ZUS") {
    eintrag(s.zuschuss, person, () => []).push(...alle(root, "Zahlungsdaten").map((knoten) => ({ knoten, id: q.id })));
    return;
  }
  eintrag(s.krv, person, () => []).push(...krvBeitraege(root, q.id, paar(s)));
}

const paar = (s: Sammlung) => [s.idnr.a, ...(s.idnr.b ? [s.idnr.b] : [])];

/** Steuerfreie Arbeitgeberzuschüsse (VaSt_LStB_Gesamt - Regeln, Berechne_E2003705/E2003807/E2003907): Summe, abgerundet */
function zuschuesseAbschliessen(s: Sammlung, person: Person) {
  for (const [feld, element] of AG_ZUSCHUSS) {
    const mit = (s.agZuschuss[person] ?? []).filter((z) => z.element === element);
    const summe = abrunden(mit.reduce((t, m) => t + m.c, 0));
    if (summe > 0 && summe <= 99_999_00) vorsorgeWert(s, person, feld, summe, [...new Set(mit.map((m) => m.id))]);
  }
}

function krvAbschliessen(s: Sammlung, person: Person) {
  const daten = s.krv[person] ?? [];
  if (daten.length === 0) return;
  const { werte, herkunft, ueberGrenze } = krvSumme(daten);
  for (const [feld, w] of Object.entries(werte)) {
    const f = feld as keyof typeof werte;
    vorsorgeWert(s, person, f, w, herkunft[f] ?? []);
  }
  if (ueberGrenze.length > 0) {
    s.vorschlag.hinweise.push(`Kranken- und Pflegeversicherung: Summe über der Grenze der Zuordnung, nicht übernommen (${ueberGrenze.join(", ")}).`);
  }
  const ohne = krvOhneFeld(daten);
  if (ohne.erstattungGesetzlich) s.vorschlag.hinweise.push("Erstattungen der gesetzlichen Kranken- und Pflegeversicherung übernimmt Haben noch nicht.");
  if (ohne.zuschuss) s.vorschlag.hinweise.push("Zuschüsse zur Kranken- und Pflegeversicherung aus der Bescheinigung übernimmt Haben noch nicht.");
}

/** Zahlungsarten der Zuschüsse zur Basisrente (02, 03) und ihrer Rückforderung (22, 23) laut Schema VaSt_ZUS */
const ZUSCHUSS_BASISRENTE = ["02", "03"];
const RUECKFORDERUNG_BASISRENTE = ["22", "23"];

/**
 * Basisrente (VaSt_RUE_Gesamt und VaSt_ZUS_Gesamt, Berechne_E2000701_Ungeprueft; VaSt_Gesamt, Berechne_E2000701): Beiträge,
 * mit Basisrentenvertrag abzüglich der Zuschüsse 02/03 und zuzüglich ihrer Rückforderung 22/23, aufgerundet, bis 99.999 €
 */
function basisrenteAbschliessen(s: Sammlung, person: Person) {
  const rue = s.rue[person];
  const zuschuss = s.zuschuss[person] ?? [];
  const art = (z: { knoten: XmlKnoten }) => wert(z.knoten, "Zahlungsart") ?? "";
  const zurBasisrente = rue ? zuschuss.filter((z) => [...ZUSCHUSS_BASISRENTE, ...RUECKFORDERUNG_BASISRENTE].includes(art(z))) : [];
  if (zuschuss.some((z) => !zurBasisrente.includes(z))) s.vorschlag.hinweise.push("Zuschüsse nach § 10 Abs. 4b EStG (VaSt_ZUS) übernimmt Haben noch nicht.");
  if (!rue) return;
  const anteil = zurBasisrente.reduce((t, z) => t + (ZUSCHUSS_BASISRENTE.includes(art(z)) ? -1 : 1) * (betrag(z.knoten, "Betrag") ?? 0), 0);
  const summe = aufrunden(rue.summe + anteil);
  if (summe !== 0 && Math.abs(summe) <= 99_999_00) vorsorgeWert(s, person, "basisrente", summe, [...new Set([...rue.ids, ...zurBasisrente.map((z) => z.id)])]);
  else if (summe !== 0) s.vorschlag.hinweise.push("Basisrente: Summe über 99.999 €, nicht übernommen.");
}

/**
 * Gezahlte Kirchensteuer laut Lohnsteuerbescheinigungen (Berechne_E0108004): je Person die Summe mit Cent, nur wenn ≥ 0; Haben
 * hat ein Feld für beide Personen
 */
function kirchensteuerAbschliessen(s: Sammlung) {
  const jePerson = (["a", "b"] as const).map((person) => s.kirchensteuer.filter((k) => k.person === person)).filter((l) => l.reduce((t, k) => t + k.c, 0) > 0);
  const summe = jePerson.flat().reduce((t, k) => t + k.c, 0);
  if (summe <= 0) return;
  s.vorschlag.sonderausgaben = { werte: { kirchensteuerGezahlt: summe }, herkunft: { kirchensteuerGezahlt: [...new Set(jePerson.flat().map((k) => k.id))] } };
}

/** Prüft einen Beleg und liefert Person und Wurzel, sonst den Grund als Hinweis */
function zuordnen(s: Sammlung, q: VastQuelle, year: number): { person: Person; root: XmlKnoten } | null {
  const label = vastBelegartLabel(q.belegart);
  if (q.test) {
    s.vorschlag.hinweise.push(`${label} ${q.id}: Testbeleg, nie übernommen.`);
    return null;
  }
  if (!["VaSt_LStB", "VaSt_KRV", "VaSt_LErsL", "VaSt_RUE", "VaSt_ZUS"].includes(q.belegart)) {
    // Stammdaten (Pers1 bis Pers3) nimmt Haben aus den Einstellungen
    if (q.belegart === "VaSt_RBM") {
      s.vorschlag.hinweise.push(`${label}: übernimmt Haben noch nicht; ihr Anteil an Kranken- und Pflegeversicherung fehlt deshalb auch im Vorschlag.`);
    } else if (!q.belegart.startsWith("VaSt_Pers")) s.vorschlag.hinweise.push(`${label}: übernimmt Haben noch nicht.`);
    return null;
  }
  if (q.schemaversion !== versionFuer(year)) {
    s.vorschlag.hinweise.push(`${label} ${q.id}: Version ${q.schemaversion} kennt Haben für ${year} nicht, nicht übernommen.`);
    return null;
  }
  const root = belegWurzel(q.xml, q.belegart);
  const idnr = root ? belegIdnr(q.belegart, root) : undefined;
  const person: Person | null = idnr === s.idnr.a ? "a" : idnr !== undefined && idnr === s.idnr.b ? "b" : null;
  if (!root || !person) {
    // KRV eines Kindes geht laut Zuordnung in die Anlage Kind (VaSt_KRV - Regeln, Berechne_I_E0500406)
    const vn = root && q.belegart === "VaSt_KRV" ? wert(root, "BetroffenerFall", "BetroffenePerson", "WeiterePerson", "NatPerson", "IdNr") : undefined;
    s.vorschlag.hinweise.push(
      vn !== undefined && paar(s).includes(vn)
        ? `${label} ${q.id}: Beiträge für eine weitere versicherte Person, etwa ein Kind (Anlage Kind), übernimmt Haben noch nicht.`
        : `${label} ${q.id}: gehört keiner Person der Erklärung, nicht übernommen.`,
    );
    return null;
  }
  return { person, root };
}

/**
 * Vorschläge aus den Belegen eines Steuerjahres; idnr der Person A und bei Zusammenveranlagung des Ehegatten. `belege` sind
 * die Belege der letzten Abfrage: Ein geänderter Beleg kommt bei ELSTER mit neuer ID, und ältere Stände (vast_belege
 * behält sie) würden sonst doppelt zählen.
 */
export function vastVorschlag(input: { year: number; idnr: { a: string; b?: string }; belege: readonly VastQuelle[] }): VastVorschlag {
  const vorschlag: VastVorschlag = { arbeitnehmer: {}, vorsorge: {}, ersatzleistungen: {}, hinweise: [] };
  if (!(VAST_JAHRE as readonly number[]).includes(input.year)) {
    vorschlag.hinweise.push(`Für ${input.year} gibt es noch keine amtliche Zuordnung der Belege; Haben schlägt nichts vor.`);
    return vorschlag;
  }
  const s: Sammlung = { vorschlag, year: input.year, idnr: input.idnr, krv: {}, rue: {}, zuschuss: {}, agZuschuss: {}, kirchensteuer: [], lohnersatz: {} };
  for (const q of input.belege) {
    const z = zuordnen(s, q, input.year);
    if (z) sammeln(s, z.person, q, z.root);
  }
  for (const person of ["a", "b"] as const) {
    zuschuesseAbschliessen(s, person);
    krvAbschliessen(s, person);
    basisrenteAbschliessen(s, person);
    lohnersatzAbschliessen(s, person);
  }
  kirchensteuerAbschliessen(s);
  vorschlag.hinweise = [...new Set(vorschlag.hinweise)];
  return vorschlag;
}
