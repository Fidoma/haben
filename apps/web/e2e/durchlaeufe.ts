/**
 * Die Durchläufe der Ende-zu-Ende-Tests, jeder mit eigenem Server und eigener, leerer Datenbank, damit sie
 * parallel laufen: app.spec.ts legt die Daten für das Projekt „mit-daten“ an, die übrigen spielen je ein Thema
 * für sich durch. playwright.config.ts startet die Server, die Tests greifen über databaseUrlFuer direkt auf
 * ihre Datenbank zu, wo sie Daten von außen nachstellen.
 */

export const PORT = Number(process.env.E2E_PORT ?? 3100);
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

/** Name → Abstand des Ports zu E2E_PORT; der Hauptdurchlauf (app.spec.ts) hat den Port selbst */
export const DURCHLAEUFE = {
  gmbh: 1,
  rechnungen: 2,
  "belege-steuern": 3,
  rueckfragen: 4,
  belegimport: 5,
  "bb-import": 6,
  "beleg-storno": 11,
  "dauerfrist-euer": 12,
  verrechnung: 13,
  firmen: 14,
  passwort: 16,
  "fastbill-import": 17,
  "wiso-import": 18,
  "sevdesk-export": 19,
  "sevdesk-anlagen": 21,
  // Der Abstand 19 gehört sevdesk-export, 20 der nachgebauten sevDesk-API (SEVDESK_PORT), 21 dem
  // Durchlauf sevdesk-anlagen; vorjahre bekommt deshalb 22
  vorjahre: 22,
  steuerbefreiung: 23,
  ablage: 24,
  // Fragen zur Einrichtung und ausgeblendete Bereiche (#266): braucht eine Ersteinrichtung ohne Firmendaten
  einrichtung: 25,
  umstellung: 26,
  // Belege ohne Datei aus dem Accountable-Stapel (#1235, #1236): eigener Server und eigene Wegwerf-Datenbank
  "accountable-ohne-beleg": 27,
  fremdrechnung: 28,
  // Kleinunternehmer wechseln nur ohne Buchungen im Jahr: eigene Firma für die Rückfrage zur Umsatzgrenze
  "fremdrechnung-kleinunternehmer": 29,
  // Kontoabruf über FinTS (#654): nur dieser Server hat FINTS_PRODUKT_ID, die nachgebaute Bank liegt auf FINTS_BANK_PORT
  "fints-abruf": 30,
  // Etsy Payments (#1133): nur dieser Server fragt die nachgebaute Etsy-API auf ETSY_PORT
  "etsy-abruf": 32,
  // Zahlung und Gebühr eines Zahlungsdienstleisters in einer Zeile und in einem Schritt zugeordnet (#1417)
  "zahlung-gebuehr": 36,
  "bank-dubletten": 35,
  // Vorschläge der Bankliste markieren und gemeinsam bestätigen (#1440)
  "bank-bestaetigen": 37,
  // PayPal-Umsätze über die Transaction Search (#1512): nur dieser Server fragt die nachgebaute PayPal-API auf PAYPAL_PORT
  "paypal-abruf": 38,
  // Stripe (#1280): nur dieser Server fragt die nachgebaute Stripe-API auf STRIPE_PORT
  "stripe-abruf": 40,
  // Abschnitte von belege-steuern, jeder aus dem Abzug nach dessen Einrichtung (ABZUG_AUS)
  "belege-steuern-belege": 42,
  "belege-steuern-erklaerungen": 43,
  "belege-steuern-bank": 44,
  "belege-steuern-einstellungen": 45,
  // Abschnitte von rechnungen, ebenso aus dem Abzug nach dessen Einrichtung
  "rechnungen-kontakte": 46,
  "rechnungen-artikel": 47,
  "rechnungen-kasse": 48,
  "rechnungen-angebote": 49,
  // Warteschlange der KI-Auslesung (#1735): nur dieser Server liest Belege mit dem nachgebauten Dienst auf KI_PORT aus
  "ki-warteschlange": 50,
} as const;
export type Durchlauf = keyof typeof DURCHLAEUFE;

/**
 * Abschnitte eines Durchlaufs (#1742): Der Durchlauf links beginnt mit einer Kopie der Datenbank, die der rechts nach
 * seiner Einrichtung gesichert hat (e2e/abzug.ts), mit eigenem Server, damit die Abschnitte parallel laufen, ohne sich
 * Daten zu teilen. Playwright startet ihn erst nach dem rechts (dependencies in playwright.config.ts).
 */
export const ABZUG_AUS: Partial<Record<Durchlauf, Durchlauf>> = {
  "belege-steuern-belege": "belege-steuern",
  "belege-steuern-erklaerungen": "belege-steuern",
  "belege-steuern-bank": "belege-steuern",
  "belege-steuern-einstellungen": "belege-steuern",
  "rechnungen-kontakte": "rechnungen",
  "rechnungen-artikel": "rechnungen",
  "rechnungen-kasse": "rechnungen",
  "rechnungen-angebote": "rechnungen",
};

/** Projekte in playwright.config.ts, die den Hauptserver auf PORT nutzen; „mit-daten“ in drei Gruppen (MIT_DATEN) */
export const HAUPTPROJEKTE = ["ablauf", "abzug", "mit-daten", "mit-daten-2", "mit-daten-3", "ohne-daten"] as const;
export type Projekt = (typeof HAUPTPROJEKTE)[number] | Durchlauf;

/** Die Projekte, die nach „ablauf“ mit dessen Daten aus dem Abzug laufen; jedes in einem eigenen Teil mit „ablauf“ und „abzug“ */
export const MIT_DATEN = ["mit-daten", "mit-daten-2", "mit-daten-3"] as const satisfies readonly Projekt[];

/**
 * Feste Verteilung der Projekte auf die Teile der CI (Matrix in .github/workflows/ci.yml, E2E_TEIL), nach Dauer statt
 * nach Datei wie `--shard`. belege-steuern und rechnungen mit ihren parallelen Abschnitten (ABZUG_AUS) haben je einen
 * Teil. Die Tests mit Daten (MIT_DATEN) lasten vier Worker voll aus und sind in drei Teile verteilt; jeder
 * dieser Teile spielt „ablauf“ selbst durch (e2e/abzug.ts sichert und spielt im selben Job ein), daneben laufen auf den
 * freien Workern die kurzen Durchläufe. Nur „ablauf“ und „abzug“ stehen in mehreren Teilen, jedes andere Projekt in genau
 * einem (e2e-teile.test.ts); ein neuer Durchlauf kommt in den kürzesten Teil.
 */
export const TEILE = {
  "belege-steuern": ["belege-steuern", "belege-steuern-belege", "belege-steuern-erklaerungen", "belege-steuern-bank", "belege-steuern-einstellungen"],
  rechnungen: ["rechnungen", "rechnungen-kontakte", "rechnungen-artikel", "rechnungen-kasse", "rechnungen-angebote"],
  ablauf: ["ablauf", "abzug", "mit-daten", "fremdrechnung-kleinunternehmer", "fints-abruf", "etsy-abruf"],
  "ablauf-2": ["ablauf", "abzug", "mit-daten-2", "zahlung-gebuehr", "bank-dubletten", "bank-bestaetigen"],
  "ablauf-3": ["ablauf", "abzug", "mit-daten-3", "paypal-abruf", "stripe-abruf", "ki-warteschlange"],
  gmbh: ["gmbh", "rueckfragen", "belegimport", "bb-import", "beleg-storno", "dauerfrist-euer", "verrechnung", "firmen", "passwort", "fastbill-import"],
  importe: [
    "wiso-import",
    "sevdesk-export",
    "sevdesk-anlagen",
    "vorjahre",
    "steuerbefreiung",
    "ablage",
    "einrichtung",
    "umstellung",
    "accountable-ohne-beleg",
    "fremdrechnung",
    // Nutzt den Hauptserver, aber nicht dessen Daten: nie in einem Teil mit „abzug“, das die Hauptdatenbank ersetzt
    "ohne-daten",
  ],
} as const satisfies Record<string, readonly Projekt[]>;
export type Teil = keyof typeof TEILE;

/** Projekte des Teils aus E2E_TEIL; ohne Angabe alle (undefined), ein unbekannter Name bricht ab */
export function projekteFuerTeil(teil = process.env.E2E_TEIL): readonly Projekt[] | undefined {
  if (!teil) return undefined;
  if (!(teil in TEILE)) throw new Error(`E2E_TEIL „${teil}“ unbekannt, erlaubt: ${Object.keys(TEILE).join(", ")}`);
  return TEILE[teil as Teil];
}

/** Die nachgebaute Enable-Banking-API in belege-steuern-einstellungen.spec.ts; + 7 und + 8 belegen langsame-anfrage und beenden */
export const ENABLE_BANKING_PORT = PORT + 9;

/** Nachgebaute FinTS-Bank in fints-abruf.spec.ts (@haben/import/fints-testbank) */
export const FINTS_BANK_PORT = PORT + 31;

/** Nachgebaute Etsy-API mit Anmeldung in etsy-abruf.spec.ts (ETSY_API_URL, ETSY_TOKEN_URL, ETSY_AUTH_URL) */
export const ETSY_PORT = PORT + 33;

/** Nachgebaute Stripe-API in stripe-abruf.spec.ts (STRIPE_API_URL) */
export const STRIPE_PORT = PORT + 41;

/**
 * Nachgebauter Dienst des BZSt für die Bestätigung von USt-IdNrn. in belege-steuern-erklaerungen.spec.ts (EVATR_API_URL, #1385); jeder
 * Server zeigt dorthin, damit kein Test das echte BZSt fragt
 */
export const EVATR_PORT = PORT + 34;

/** Nachgebaute Transaction Search von PayPal in paypal-abruf.spec.ts (PAYPAL_API_URL) */
export const PAYPAL_PORT = PORT + 39;

/** Nachgebauter OpenAI-kompatibler KI-Dienst in ki-warteschlange.spec.ts (EXTRACTION_BASE_URL) */
export const KI_PORT = PORT + 51;

/** Platzhalter für FINTS_PRODUKT_ID im Durchlauf „fints-abruf“; eine echte Registrierungsnummer steht nie im Repository */
export const FINTS_PRODUKT_E2E = "HABENE2ETESTPRODUKT";

/** Nachgebaute Paketquelle für eigene Layouts in layouts.spec.ts (LAYOUTS_PACKAGES_URL) */
export const LAYOUT_PAKETE_PORT = PORT + 10;

/** Nachgebaute sevDesk-API in sevdesk-anlagen.spec.ts (SEVDESK_API_URL) */
export const SEVDESK_PORT = PORT + 20;

/** Zweiter Server in firmen.spec.ts auf derselben Datenbank, mit so vielen Firmen, dass der Wechsler ein Suchfeld hat */
export const FIRMEN_VIELE_PORT = PORT + 15;

export const portFuer = (durchlauf?: Durchlauf) => PORT + (durchlauf ? DURCHLAEUFE[durchlauf] : 0);

/** Neben der E2E-Datenbank, Name endet wie verlangt auf „e2e“: haben_e2e → haben_gmbh_e2e */
export const databaseUrlFuer = (durchlauf?: Durchlauf, basis = databaseUrl) =>
  durchlauf ? basis.replace(/e2e(\?.*)?$/i, `${durchlauf.replace(/-/g, "_")}_e2e$1`) : basis;

/** Echte Server nutzen optional die App-Anmeldung; direkte SQL-Fixtures behalten databaseUrlFuer. */
export function appDatabaseUrlFuer(durchlauf?: Durchlauf, server: string = durchlauf ?? "ablauf") {
  if (!process.env.E2E_APP_DATABASE_URL) return databaseUrlFuer(durchlauf);
  const url = new URL(databaseUrlFuer(durchlauf, process.env.E2E_APP_DATABASE_URL));
  // Die Identitätsprobe unterscheidet den Hauptserver von den zusätzlichen Servern gegen dieselbe Datenbank.
  url.searchParams.set("application_name", `haben-e2e-${server}`);
  return url.toString();
}

/** Die anderen Firmen im Durchlauf „firmen“ (#504); ihre Instanzen muss es nicht geben. Der zweite Name ist lang und ohne Trennstelle */
export const ANDERE_FIRMEN = [
  { name: "Werkstatt Süd", url: "https://werkstatt.example.de" },
  { name: "Gebäudereinigungsgesellschaft Nordfriesland", url: "https://reinigung.example.de" },
];

/** HABEN_FIRMEN für einen Server unter `eigene`: er selbst als „Studio Nord“ und die anderen */
export const habenFirmen = (eigene: string, andere = ANDERE_FIRMEN) =>
  [{ name: "Studio Nord", url: eigene }, ...andere].map((firma) => `${firma.name}|${firma.url}`).join(";");
