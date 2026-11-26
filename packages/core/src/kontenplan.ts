import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";

/*
 * Kontenrahmen, die bebuchten Konten je Rahmen, die Ausgabenkategorien und die Kontenbezeichnungen. Teil von
 * posting.ts, das alles weiterreicht.
 */

export type Kontenrahmen = "SKR03" | "SKR04";
export type Versteuerung = "ist" | "soll";

/** Frühere Haben-Konten bleiben für Bestandsauswertungen und Gegenbuchungen erhalten; neue Erlöse folgen DATEV 2026. */
export const KLEINUNTERNEHMER_FRUEHERE_KONTEN = { SKR03: "8195", SKR04: "4185" } as const;

/** Konten, die Haben bisher bebucht. Vor dem Echtbetrieb mit dem Steuerberater abgleichen. */
export const ACCOUNTS = {
  SKR03: {
    forderungen: "1400",
    bank: "1200",
    kasse: "1000",
    erloese: { 1900: "8400", 700: "8300", 0: "8200" },
    erloeseSonder: {
      reverse_charge: "8336",
      drittland: "8338",
      eu_sonstige: "8339",
      ig_lieferung: "8125",
      ausfuhr: "8120",
      steuerfrei: "8100",
      kleinunternehmer: "8192",
    },
    ust: { 1900: "1776", 700: "1771" },
    ustNichtFaellig: { 1900: "1766", 700: "1761" },
    vorsteuer: { 1900: "1576", 700: "1571" },
    /**
     * Zwischenkonto für die Vorsteuer einer Gutschrift, die bereits Bezahltes erstattet (#786): Die Berichtigung wird nach
     * § 17 Abs. 1 Satz 2 und 8 UStG erst gezogen, wenn das Geld zurückkommt oder verrechnet wird. DATEV-Kontenrahmen 2026,
     * SKR03 1548 „Vorsteuer in Folgeperiode/im Folgejahr abziehbar“ (sonstige Vermögensgegenstände; kein Automatikkonto,
     * keine eigene Kennzahl, also nicht in Kz 66).
     */
    vorsteuerNochNichtAbziehbar: "1548",
    /** § 13b: selbst geschuldete Umsatzsteuer und die Vorsteuer daraus */
    ustRc: "1787",
    vorsteuerRc: "1577",
    /**
     * Innergemeinschaftlicher Erwerb (§ 1a UStG): Erwerbsteuer und Vorsteuer daraus, je Satz (DATEV-Kontenrahmen SKR03 2026;
     * 1772 und 1572 sind die Konten ohne Satz, Haben nimmt sie für 7 %). Kein Automatikkonto: Haben bucht die Steuer selbst.
     */
    ustIge: { 1900: "1774", 700: "1772" },
    vorsteuerIge: { 1900: "1574", 700: "1572" },
    verbindlichkeiten: "1600",
    /** DATEV SKR03 2026, Art.-Nr. 11174, S. 10: Anzahlungen ohne AM-Funktion; Umsatzsteuer wird separat gebucht. */
    erhalteneAnzahlungen: "1710",
    /**
     * Verrechnungskonto für zwei Belege ohne Zahlung (#274, #786): DATEV-Kontenrahmen 2026, SKR03 1590 „Durchlaufende
     * Posten“ (sonstige Vermögensgegenstände oder sonstige Verbindlichkeiten). Je Verrechnung bucht jede Belegseite ihren
     * Anteil hierher, Rechnung und Gutschrift zusammen auf null; kein Automatikkonto, die Buchung trägt keine Steuer.
     */
    verrechnung: "1590",
    privateinlagen: "1890",
    privatentnahmen: "1800",
    /** Spenden aus dem Betrieb, im Einzelunternehmen privat (Sonderausgabe, § 10b EStG); DATEV SKR03 1840 „Zuwendungen, Spenden“ */
    spenden: "1840",
    /** GmbH, UG: Gesellschafter-Verrechnungskonto statt Privat (DATEV SKR03: Verbindlichkeiten gegenüber Gesellschaftern) */
    gesellschafter: "0730",
    /** GmbH, UG: einbehaltene KapESt, Soli und KiSt auf offene Ausschüttungen (DATEV SKR03 1746) */
    kapestEinbehalt: "1746",
    geldtransit: "1360",
    ustVorauszahlung: "1780",
    /** Sondervorauszahlung bei Dauerfristverlängerung, „Umsatzsteuer-Vorauszahlungen 1/11“ (DATEV SKR03 1781) */
    sondervorauszahlung: "1781",
    nebenkostenGeldverkehr: "4970",
    saldenvortrag: "9000",
    /** Bezahlte Mahngebühren, Pauschalen und Verzugszinsen: kein Entgelt für eine Leistung, deshalb ohne Umsatzsteuer */
    mahnerloes: "2650",
    /** Zinsen auf Guthaben eines betrieblichen Kontos (DATEV SKR03 2650 „Sonstige Zinsen und ähnliche Erträge“) */
    zinsertraege: "2650",
    /**
     * Echter Schadenersatz und Entschädigungen ohne Leistungsaustausch, nicht steuerbar (UStAE 1.3 Abs. 1): DATEV-
     * Kontenrahmen 2026, SKR03 2742 „Versicherungsentschädigungen und Schadenersatzleistungen“ (S. 17), kein Automatikkonto
     */
    schadenersatz: "2742",
    /** Ausbuchungen (§ 17 UStG): gewährte und erhaltene Skonti, Forderungsverluste */
    skontiGewaehrt: "8730",
    skontiErhalten: "3730",
    forderungsverluste: "2400",
    /** Kursdifferenzen bei Fremdwährung: ohne Umsatzsteuer, die bleibt beim Kurs der Rechnung (§ 16 Abs. 6 UStG) */
    kursAufwand: "2150",
    kursErtrag: "2660",
  },
  SKR04: {
    forderungen: "1200",
    bank: "1800",
    kasse: "1600",
    erloese: { 1900: "4400", 700: "4300", 0: "4200" },
    erloeseSonder: {
      reverse_charge: "4336",
      drittland: "4338",
      eu_sonstige: "4339",
      ig_lieferung: "4125",
      ausfuhr: "4120",
      steuerfrei: "4100",
      kleinunternehmer: "4184",
    },
    ust: { 1900: "3806", 700: "3801" },
    ustNichtFaellig: { 1900: "3816", 700: "3811" },
    vorsteuer: { 1900: "1406", 700: "1401" },
    /** Zwischenkonto wie SKR03 1548; DATEV-Kontenrahmen 2026, SKR04 1434 „Vorsteuer in Folgeperiode/im Folgejahr abziehbar“ */
    vorsteuerNochNichtAbziehbar: "1434",
    ustRc: "3837",
    vorsteuerRc: "1407",
    /** Innergemeinschaftlicher Erwerb (DATEV-Kontenrahmen SKR04 2026; 3802 und 1402 ohne Satz, für 7 %) */
    ustIge: { 1900: "3804", 700: "3802" },
    vorsteuerIge: { 1900: "1404", 700: "1402" },
    verbindlichkeiten: "3300",
    /** DATEV SKR04 2026, Art.-Nr. 11175, S. 11: Anzahlungen ohne AM-Funktion; Umsatzsteuer wird separat gebucht. */
    erhalteneAnzahlungen: "3250",
    /** Verrechnungskonto wie SKR03 1590; DATEV-Kontenrahmen 2026, SKR04 1370 „Durchlaufende Posten“ */
    verrechnung: "1370",
    privateinlagen: "2180",
    privatentnahmen: "2100",
    /** DATEV SKR04 2250 „Zuwendungen, Spenden“ */
    spenden: "2250",
    /** GmbH, UG: Gesellschafter-Verrechnungskonto statt Privat (DATEV SKR04: Verbindlichkeiten gegenüber Gesellschaftern) */
    gesellschafter: "3510",
    kapestEinbehalt: "3760",
    geldtransit: "1460",
    ustVorauszahlung: "3820",
    /** „Umsatzsteuer-Vorauszahlung 1/11“ (DATEV SKR04 3830) */
    sondervorauszahlung: "3830",
    nebenkostenGeldverkehr: "6855",
    saldenvortrag: "9000",
    mahnerloes: "7100",
    zinsertraege: "7100",
    /** Wie SKR03 2742; DATEV-Kontenrahmen 2026, SKR04 4970 „Versicherungsentschädigungen und Schadenersatzleistungen“ (S. 18) */
    schadenersatz: "4970",
    skontiGewaehrt: "4730",
    skontiErhalten: "5730",
    forderungsverluste: "6930",
    kursAufwand: "6880",
    kursErtrag: "4840",
  },
} as const;

/**
 * Gegenkonto für Geld zwischen Unternehmen und Inhaber: im Einzelunternehmen Privateinlage (Geld kommt ins Unternehmen)
 * bzw. Privatentnahme, in GmbH und UG für beide Richtungen das Gesellschafter-Verrechnungskonto. Eine Kapitalgesellschaft
 * hat kein Privat; was der Gesellschafter auslegt oder bekommt, ist eine Forderung bzw. Verbindlichkeit ihm gegenüber.
 */
export function ownerAccount(kontenrahmen: Kontenrahmen, rechtsform: Rechtsform, direction: "einlage" | "entnahme"): string {
  const accounts = ACCOUNTS[kontenrahmen];
  if (isKapitalgesellschaft(rechtsform)) return accounts.gesellschafter;
  return direction === "einlage" ? accounts.privateinlagen : accounts.privatentnahmen;
}

/**
 * Was eine Ausgabenkategorie kann. Jede Kategorie nennt unter `nicht`, was für sie nicht gilt; so beantwortet eine neue
 * Kategorie jede Frage an einer Stelle, statt in verstreuten Listen zu fehlen (#1975):
 *
 * - `aufwand`: Betriebsausgabe in EÜR und BWA. Nicht beim Anlagegut (wirkt über die AfA) und bei der Einfuhrumsatzsteuer
 *   (ist Vorsteuer, Kz 62).
 * - `direkt`: unter „Direkt buchen“ ohne Beleg wählbar. Nicht, wo es den Beleg braucht: Anlagegut und geringwertiges
 *   Wirtschaftsgut für das Anlagenverzeichnis, Einfuhrumsatzsteuer für den Bescheid des Zolls, Bewirtung für den
 *   Bewirtungsbeleg (§ 4 Abs. 5 Satz 1 Nr. 2 Satz 2 EStG), Geschenke für die Empfänger (§ 4 Abs. 7 EStG); und nicht bei
 *   Kontoführung und Gebühren, die „Direkt buchen“ schon als eigenen Eintrag hat.
 * - `eigenesKonto`: Elternkategorie eines eigenen Sachkontos (#270). Nicht bei Kategorien ohne Aufwandsbuchung, mit eigener
 *   Behandlung oder als Wareneinsatz: Anlagegut, Hardware, Einfuhrumsatzsteuer, Kontoführung, Wareneinkauf, Fremdleistungen
 *   und Kfz-Steuer. Zusätzlich muss das Konto in der Aufwandsklasse liegen (ownAccountParents).
 * - `dauerbeleg`: Vorlage für wiederkehrende Belege. Nicht beim Anlagegut, das je Anschaffung eine eigene Anlage wird.
 */
export type KategorieEigenschaft = "aufwand" | "direkt" | "eigenesKonto" | "dauerbeleg";

interface Kategoriesteckbrief {
  label: string;
  SKR03: string;
  SKR04: string;
  /** Was für die Kategorie nicht gilt; leer = alles */
  nicht: readonly KategorieEigenschaft[];
}

/**
 * Ausgabenkategorien für Belege mit Aufwandskonto je Kontenrahmen und ihrem Steckbrief (KategorieEigenschaft).
 * Vor dem Echtbetrieb mit dem Steuerberater abgleichen.
 */
export const EXPENSE_CATEGORIES = {
  software: { label: "Software und Lizenzen", SKR03: "4964", SKR04: "6837", nicht: [] },
  edv: { label: "Hosting und IT-Dienste", SKR03: "4806", SKR04: "6495", nicht: [] },
  // DATEV „Reparaturen und Instandhaltung von anderen Anlagen und Betriebs- und Geschäftsausstattung“ (#312); EDV und Kfz
  // haben eigene Kategorien
  reparatur: { label: "Reparatur und Instandhaltung (Ausstattung, ohne EDV und Kfz)", SKR03: "4805", SKR04: "6470", nicht: [] },
  // DATEV „Miete (unbewegliche Wirtschaftsgüter)“: Geschäftsräume und betrieblich genutzte Grundstücke (#312)
  miete: { label: "Miete für Geschäftsräume", SKR03: "4210", SKR04: "6310", nicht: [] },
  hardware: { label: "Hardware (GWG bis 800 € netto)", SKR03: "0480", SKR04: "0670", nicht: ["direkt", "eigenesKonto"] },
  telefon: { label: "Telefon", SKR03: "4920", SKR04: "6805", nicht: [] },
  internet: { label: "Internet", SKR03: "4925", SKR04: "6810", nicht: [] },
  buero: { label: "Bürobedarf", SKR03: "4930", SKR04: "6815", nicht: [] },
  // DATEV „Sonstiger Betriebsbedarf“: laufendes Verbrauchsmaterial außer Bürobedarf (#312)
  betriebsbedarf: { label: "Sonstiger Betriebsbedarf", SKR03: "4980", SKR04: "6850", nicht: [] },
  literatur: { label: "Fachliteratur", SKR03: "4940", SKR04: "6820", nicht: [] },
  fortbildung: { label: "Fortbildung", SKR03: "4945", SKR04: "6821", nicht: [] },
  fahrtkosten: { label: "Reisekosten: Fahrten", SKR03: "4673", SKR04: "6673", nicht: [] },
  uebernachtung: { label: "Reisekosten: Übernachtung", SKR03: "4676", SKR04: "6680", nicht: [] },
  porto: { label: "Porto", SKR03: "4910", SKR04: "6800", nicht: [] },
  werbung: { label: "Werbung", SKR03: "4600", SKR04: "6600", nicht: [] },
  // Bewirtung: 70 % Betriebsausgabe, die Vorsteuer voll (§ 4 Abs. 5 Nr. 2 EStG); die Aufteilung macht die EÜR
  bewirtung: { label: "Bewirtung von Geschäftspartnern (70 % abziehbar)", SKR03: "4650", SKR04: "6640", nicht: ["direkt"] },
  geschenke: { label: "Geschenke an Geschäftspartner (bis 50 € je Empfänger und Jahr)", SKR03: "4630", SKR04: "6610", nicht: ["direkt"] },
  beratung: { label: "Rechts- und Beratungskosten", SKR03: "4950", SKR04: "6825", nicht: [] },
  buchfuehrung: { label: "Buchführung und Steuerberatung", SKR03: "4955", SKR04: "6830", nicht: [] },
  // Waren zum Weiterverkauf; DATEV „Wareneingang“, Vorsteuer je nach Beleg
  wareneinkauf: { label: "Wareneinkauf (Handelsware)", SKR03: "3200", SKR04: "5200", nicht: ["eigenesKonto"] },
  fremdleistung: { label: "Fremdleistungen", SKR03: "3100", SKR04: "5900", nicht: ["eigenesKonto"] },
  geldverkehr: { label: "Kontoführung und Gebühren", SKR03: "4970", SKR04: "6855", nicht: ["direkt", "eigenesKonto"] },
  kfzBetrieb: { label: "Kfz: Laden, Tanken, Wartung", SKR03: "4530", SKR04: "6530", nicht: [] },
  kfzVersicherung: { label: "Kfz: Versicherung", SKR03: "4520", SKR04: "6520", nicht: [] },
  kfzSteuer: { label: "Kfz: Steuer", SKR03: "4510", SKR04: "7685", nicht: ["eigenesKonto"] },
  kfzReparatur: { label: "Kfz: Reparaturen", SKR03: "4540", SKR04: "6540", nicht: [] },
  kfzLeasing: { label: "Kfz: Leasing", SKR03: "4570", SKR04: "6560", nicht: [] },
  // DATEV „Sonstige Fahrzeugkosten“: was nicht Laden/Tanken, Versicherung, Steuer, Reparatur oder Leasing ist (#312)
  kfzSonstige: { label: "Kfz: sonstige Kosten", SKR03: "4580", SKR04: "6570", nicht: [] },
  versicherung: { label: "Versicherungen", SKR03: "4360", SKR04: "6400", nicht: [] },
  beitraege: { label: "Beiträge", SKR03: "4380", SKR04: "6420", nicht: [] },
  // Personalaufwand (soziale Abgaben, § 275 Abs. 2 Nr. 6b HGB), DATEV „Beiträge zur Berufsgenossenschaft“ (#312)
  berufsgenossenschaft: { label: "Beiträge zur Berufsgenossenschaft", SKR03: "4138", SKR04: "6120", nicht: [] },
  // DATEV „Versorgungskassen“: betriebliche Altersversorgung der Arbeitnehmer (§ 4c EStG). Die eigene Vorsorge des
  // Inhabers ist keine Betriebsausgabe (§ 12 Nr. 1 EStG), sie ist eine Entnahme (#312)
  versorgungskassen: { label: "Versorgungskassen (Altersversorgung der Arbeitnehmer)", SKR03: "4160", SKR04: "6150", nicht: [] },
  sonstiges: { label: "Sonstiger Aufwand", SKR03: "4900", SKR04: "6300", nicht: [] },
  // Kein Aufwand: gebucht wird auf das Anlagekonto der Anlage, abgeschrieben über das Anlagenverzeichnis
  anlage: { label: "Anlagegut (wird abgeschrieben)", SKR03: "0490", SKR04: "0690", nicht: ["aufwand", "direkt", "eigenesKonto", "dauerbeleg"] },
  // Kein Aufwand: Bescheid des Zolls über die Einfuhrumsatzsteuer, der ganze Betrag ist Vorsteuer (§ 15 Abs. 1 Satz 1 Nr. 2
  // UStG, Kz 62); DATEV-Kontenrahmen 2026 „Entstandene Einfuhrumsatzsteuer“ (SKR03 1588, SKR04 1433)
  einfuhrumsatzsteuer: { label: "Einfuhrumsatzsteuer (Bescheid des Zolls)", SKR03: "1588", SKR04: "1433", nicht: ["aufwand", "direkt", "eigenesKonto"] },
} as const satisfies Record<string, Kategoriesteckbrief>;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as [ExpenseCategory, ...ExpenseCategory[]];

/** Ob die Kategorie die Eigenschaft hat (KategorieEigenschaft); eine unbekannte Kategorie hat keine */
export function hatEigenschaft(kategorie: string, eigenschaft: KategorieEigenschaft): boolean {
  if (!Object.hasOwn(EXPENSE_CATEGORIES, kategorie)) return false;
  return !(EXPENSE_CATEGORIES[kategorie as ExpenseCategory].nicht as readonly string[]).includes(eigenschaft);
}

/** Die Kategorien mit der Eigenschaft, in der Reihenfolge der Tabelle */
export function kategorienMit(eigenschaft: KategorieEigenschaft): ExpenseCategory[] {
  return EXPENSE_CATEGORY_KEYS.filter((kategorie) => hatEigenschaft(kategorie, eigenschaft));
}

/** Kategorie, die eine Betriebsausgabe ist; abgeleitet aus dem Steckbrief, damit ein Record je Aufwand vollständig sein muss */
export type Aufwandskategorie = {
  [K in ExpenseCategory]: "aufwand" extends (typeof EXPENSE_CATEGORIES)[K]["nicht"][number] ? never : K;
}[ExpenseCategory];

/**
 * Anzeige einer Ausgabekategorie mit der Nummer ihres Kontos im Kontenrahmen der Firma („6805 · Telefon“, #1438), nur für die
 * Oberfläche: Buchungstexte, Exporte und gespeicherte Werte bleiben bei der Bezeichnung. Unbekannte Werte (etwa aus einem Import)
 * erscheinen unverändert, das Anlagegut ohne Nummer.
 */
export function kategorieMitKonto(kontenrahmen: Kontenrahmen, kategorie: string): string {
  if (!Object.hasOwn(EXPENSE_CATEGORIES, kategorie)) return kategorie;
  const eintrag = EXPENSE_CATEGORIES[kategorie as ExpenseCategory];
  // Beim Anlagegut steht das Konto erst mit der Art der Anlage fest (Pkw: SKR03 0320, SKR04 0520), nicht mit der Kategorie
  if (kategorie === "anlage") return eintrag.label;
  return `${eintrag[kontenrahmen]} · ${eintrag.label}`;
}

export const ACCOUNT_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    // Kapitalgesellschaft: Gesellschafter und Eigenkapital (DATEV-Kontenrahmen SKR03 2026, Art.-Nr. 11174)
    "0730": "Verbindlichkeiten gegenüber Gesellschaftern",
    "0731": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit bis 1 Jahr",
    "0740": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit 1 bis 5 Jahre",
    "0750": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit größer 5 Jahre",
    "0800": "Gezeichnetes Kapital",
    // Steuern vom Einkommen und Ertrag und ihre Rückstellungen (koerperschaft.ts)
    "0955": "Steuerrückstellungen",
    "0956": "Gewerbesteuerrückstellung nach § 4 Abs. 5b EStG",
    "0963": "Körperschaftsteuerrückstellung",
    "2200": "Körperschaftsteuer",
    "2208": "Solidaritätszuschlag",
    "4320": "Gewerbesteuer",
    "0860": "Gewinnvortrag vor Verwendung",
    "0868": "Verlustvortrag vor Verwendung",
    "1000": "Kasse",
    "1200": "Bank",
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`136${i}`, "Verrechnungskonto Zahlungsdienstleister"])),
    "1400": "Forderungen aus Lieferungen und Leistungen",
    "1761": "Umsatzsteuer nicht fällig 7 %",
    "1766": "Umsatzsteuer nicht fällig 19 %",
    "1771": "Umsatzsteuer 7 %",
    "1776": "Umsatzsteuer 19 %",
    "1787": "Umsatzsteuer nach § 13b UStG",
    "1548": "Vorsteuer in Folgeperiode/im Folgejahr abziehbar",
    "1590": "Verrechnungskonto (durchlaufende Posten)",
    "1572": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb",
    "1574": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "1772": "Umsatzsteuer aus innergemeinschaftlichem Erwerb",
    "1774": "Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "8120": "Steuerfreie Umsätze § 4 Nr. 1a UStG",
    "8125": "Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG",
    "2150": "Aufwendungen aus der Währungsumrechnung",
    "2400": "Forderungsverluste (übliche Höhe)",
    "2650": "Sonstige Zinsen und ähnliche Erträge",
    "2660": "Erträge aus der Währungsumrechnung",
    "2742": "Versicherungsentschädigungen und Schadenersatzleistungen",
    "3730": "Erhaltene Skonti",
    "8730": "Gewährte Skonti",
    "8100": "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG",
    "8192": "Erlöse als Kleinunternehmer § 19 UStG",
    "8195": "Erlöse als Kleinunternehmer § 19 UStG",
    "8200": "Erlöse",
    "8300": "Erlöse 7 % USt",
    "8336": "Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (Reverse Charge)",
    "8338": "Erlöse aus im Drittland steuerbaren Leistungen",
    "8339": "Erlöse aus im anderen EU-Land steuerbaren Leistungen, im Inland nicht steuerbare Umsätze",
    "8400": "Erlöse 19 % USt",
    "9000": "Saldenvorträge Sachkonten",
  },
  SKR04: {
    "1200": "Forderungen aus Lieferungen und Leistungen",
    "1600": "Kasse",
    "1800": "Bank",
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`146${i}`, "Verrechnungskonto Zahlungsdienstleister"])),
    // Kapitalgesellschaft: Gesellschafter und Eigenkapital (DATEV-Kontenrahmen SKR04 2026, Art.-Nr. 11175)
    "2900": "Gezeichnetes Kapital",
    "3020": "Steuerrückstellungen",
    "3035": "Gewerbesteuerrückstellung nach § 4 Abs. 5b EStG",
    "3040": "Körperschaftsteuerrückstellung",
    "7600": "Körperschaftsteuer",
    "7608": "Solidaritätszuschlag",
    "7610": "Gewerbesteuer",
    "2970": "Gewinnvortrag vor Verwendung",
    "2978": "Verlustvortrag vor Verwendung",
    "3510": "Verbindlichkeiten gegenüber Gesellschaftern",
    "3511": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit bis 1 Jahr",
    "3514": "Verbindlichkeiten gegenüber Gesellschaftern, Restlaufzeit 1 bis 5 Jahre",
    "3801": "Umsatzsteuer 7 %",
    "3806": "Umsatzsteuer 19 %",
    "3837": "Umsatzsteuer nach § 13b UStG",
    "1434": "Vorsteuer in Folgeperiode/im Folgejahr abziehbar",
    "1370": "Verrechnungskonto (durchlaufende Posten)",
    "1402": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb",
    "1404": "Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "3802": "Umsatzsteuer aus innergemeinschaftlichem Erwerb",
    "3804": "Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 %",
    "4120": "Steuerfreie Umsätze § 4 Nr. 1a UStG",
    "4125": "Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG",
    "3811": "Umsatzsteuer nicht fällig 7 %",
    "3816": "Umsatzsteuer nicht fällig 19 %",
    "4100": "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG",
    "4184": "Erlöse als Kleinunternehmer § 19 UStG",
    "4185": "Erlöse als Kleinunternehmer § 19 UStG",
    "4200": "Erlöse",
    "4300": "Erlöse 7 % USt",
    "4336": "Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen (Reverse Charge)",
    "4338": "Erlöse aus im Drittland steuerbaren Leistungen",
    "4339": "Erlöse aus im anderen EU-Land steuerbaren Leistungen, im Inland nicht steuerbare Umsätze",
    "4400": "Erlöse 19 % USt",
    "4730": "Gewährte Skonti",
    "4840": "Erträge aus der Währungsumrechnung",
    "4970": "Versicherungsentschädigungen und Schadenersatzleistungen",
    "5730": "Erhaltene Skonti",
    "6880": "Aufwendungen aus der Währungsumrechnung",
    "6930": "Forderungsverluste (übliche Höhe)",
    "7100": "Sonstige Zinsen und ähnliche Erträge",
    "9000": "Saldenvorträge Sachkonten",
  },
};
