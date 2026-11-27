import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  ABZUG_AUS,
  appDatabaseUrlFuer,
  DURCHLAEUFE,
  databaseUrlFuer,
  type Durchlauf,
  ENABLE_BANKING_PORT,
  ETSY_PORT,
  EVATR_PORT,
  FINTS_PRODUKT_E2E,
  KI_PORT,
  habenFirmen,
  LAYOUT_PAKETE_PORT,
  PAYPAL_PORT,
  MIT_DATEN,
  type Projekt,
  portFuer,
  projekteFuerTeil,
  SEVDESK_PORT,
  STRIPE_PORT,
} from "./e2e/durchlaeufe.ts";

/**
 * Ende-zu-Ende-Tests gegen einen echten Server mit eigener, leerer Datenbank.
 * E2E_DATABASE_URL muss auf eine Datenbank zeigen, deren Name auf „e2e“ endet; sie wird geleert.
 * E2E_APP_DATABASE_URL trennt optional die echte App-Anmeldung von den Betreiberzugriffen auf dieselbe Datenbank.
 * Lokal startet Playwright den Entwicklungsserver, in der CI den gebauten Server (E2E_SERVER_COMMAND).
 * Lokal ohne heruntergeladene Browser: PLAYWRIGHT_CHROMIUM_EXECUTABLE auf ein vorhandenes Chromium setzen.
 */
const baseURL = `http://localhost:${portFuer()}`;
const durchlaeufe = Object.keys(DURCHLAEUFE) as Durchlauf[];
// Nur die Projekte und Server des CI-Teils aus E2E_TEIL (e2e/durchlaeufe.ts: TEILE); ohne Angabe alle
const imTeil = projekteFuerTeil();
const gewaehlt = (projekt: Projekt) => !imTeil || imTeil.includes(projekt);
// Mit E2E_ABZUG=1 beginnen die Gruppen von „mit-daten“ (MIT_DATEN) mit dem Abzug eines früheren Laufs, ohne „ablauf“ (e2e/abzug.ts)
const ausAbzug = Boolean(process.env.E2E_ABZUG);
const hauptserver = gewaehlt("ablauf") || gewaehlt("ohne-daten");

const chromium = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

/** Datenbank leeren, migrieren, Server starten; je Durchlauf (e2e/durchlaeufe.ts) ein eigener */
function webServer(durchlauf?: Durchlauf) {
  const serverPort = portFuer(durchlauf);
  const suffix = durchlauf ? `-${durchlauf}` : "";
  const serverURL = `http://localhost:${serverPort}`;
  return {
    command: "bun e2e/reset-db.ts && bun run db:migrate && bun e2e/start-server.ts",
    url: `${serverURL}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe" as const,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: appDatabaseUrlFuer(durchlauf),
      MIGRATION_DATABASE_URL: process.env.E2E_APP_DATABASE_URL ? databaseUrlFuer(durchlauf) : "",
      PORT: String(serverPort),
      BETTER_AUTH_URL: serverURL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
      DOCUMENTS_DIR: `${process.env.E2E_DOCUMENTS_DIR ?? "test-results/e2e-belege"}${suffix}`,
      ERIC_DIR: `test-results/e2e-eric${suffix}`,
      HABEN_SCHEDULER: "off",
      HABEN_UPDATE_CHECK: "off",
      // muss zu SETUP_CODE in e2e/app.spec.ts passen
      HABEN_SETUP_CODE: "e2e-einrichtungscode",
      // Vorlage und Schriften für das Rechnungs-PDF; der gebaute Server findet sie sonst nicht
      HABEN_EINVOICE_DIR: fileURLToPath(new URL("../../packages/einvoice", import.meta.url)),
      ERIC_HOME: "",
      ELSTER_HERSTELLER_ID: "",
      ANTHROPIC_API_KEY: "",
      EXTRACTION_PROVIDER: "",
      // KI-Auslesung (#1735) nur im Durchlauf „ki-warteschlange“ gegen den nachgebauten Dienst; sonst ist sie aus
      EXTRACTION_BASE_URL: durchlauf === "ki-warteschlange" ? `http://127.0.0.1:${KI_PORT}/v1` : "",
      EXTRACTION_MODEL: durchlauf === "ki-warteschlange" ? "e2e-modell" : "",
      // Nachgebaute API in belege-steuern-einstellungen.spec.ts; ohne gespeicherten Zugang fragt kein Server dort an
      ENABLE_BANKING_API_URL: `http://127.0.0.1:${ENABLE_BANKING_PORT}`,
      ENABLE_BANKING_APP_ID: "",
      ENABLE_BANKING_KEY: "",
      ENABLE_BANKING_KEY_FILE: "",
      // Nachgebaute sevDesk-API in sevdesk-anlagen.spec.ts; ohne gespeicherten Token fragt kein Server dort an
      SEVDESK_API_URL: `http://127.0.0.1:${SEVDESK_PORT}/api/v1`,
      // Bestätigung von USt-IdNrn. beim BZSt (#1385) nur in „belege-steuern“ und seinen Abschnitten gegen den nachgebauten
      // Dienst; die anderen Server schalten sie ab, und keiner fragt das echte BZSt
      EVATR_API_URL: `http://127.0.0.1:${EVATR_PORT}/app/v1/abfrage`,
      HABEN_EVATR: durchlauf?.startsWith("belege-steuern") ? "" : "off",
      // Nachgebaute Paketquelle in layouts.spec.ts, nie Typst Universe aus dem Test
      LAYOUTS_PACKAGES_URL: `http://127.0.0.1:${LAYOUT_PAKETE_PORT}`,
      // Kontoabruf über FinTS (#654) nur im Durchlauf „fints-abruf“; sonst bleibt FinTS aus wie ohne Registrierungsnummer
      FINTS_PRODUKT_ID: durchlauf === "fints-abruf" ? FINTS_PRODUKT_E2E : "",
      // Etsy Payments (#1133) nur im Durchlauf „etsy-abruf“ gegen die nachgebaute API; sonst die echten Adressen, die ohne
      // gespeicherten Zugang nie gefragt werden
      ...(durchlauf === "etsy-abruf"
        ? {
            ETSY_API_URL: `http://127.0.0.1:${ETSY_PORT}/v3/application`,
            ETSY_TOKEN_URL: `http://127.0.0.1:${ETSY_PORT}/v3/public/oauth/token`,
            ETSY_AUTH_URL: `http://127.0.0.1:${ETSY_PORT}/oauth/connect`,
          }
        : {}),
      // PayPal (#1512) nur im Durchlauf „paypal-abruf“ gegen die nachgebaute API; sonst die echten Hosts, die ohne
      // gespeicherten Zugang nie gefragt werden
      ...(durchlauf === "paypal-abruf" ? { PAYPAL_API_URL: `http://127.0.0.1:${PAYPAL_PORT}` } : {}),
      // Stripe (#1280) nur im Durchlauf „stripe-abruf“ gegen die nachgebaute API; sonst die echte, die ohne gespeicherten
      // Schlüssel nie gefragt wird
      ...(durchlauf === "stripe-abruf" ? { STRIPE_API_URL: `http://127.0.0.1:${STRIPE_PORT}` } : {}),
      // Firma wechseln (#504) nur im Durchlauf „firmen“: diese Instanz und zwei andere
      HABEN_FIRMEN: durchlauf === "firmen" ? habenFirmen(serverURL) : "",
    },
  };
}

// Der Teil von barrierefreiheit.spec.ts in „mit-daten-2“, der Rest in „mit-daten-3“; die Titel samt Datei entscheiden
const TITEL_2 = "(Farbkontraste|Theme-Fläche|Handy|Tastaturfokus)";
const BARRIEREFREIHEIT_2 = new RegExp(`barrierefreiheit\\.spec\\.ts .*${TITEL_2}`);

/** Dateien je Gruppe von „mit-daten“, nach der Dauer in der CI verteilt */
const gruppen: Record<(typeof MIT_DATEN)[number], { testMatch: string[]; grepInvert?: RegExp }> = {
  "mit-daten": {
    testMatch: [
      "anmelden.spec.ts",
      "datumsfelder.spec.ts",
      "einstellungen-export.spec.ts",
      "firmenname.spec.ts",
      "gestaltung.spec.ts",
      "kopfzeile.spec.ts",
      "seiten.spec.ts",
      "vorschau.spec.ts",
      "zz-doku-screenshots.spec.ts",
    ],
  },
  "mit-daten-2": {
    testMatch: [
      "barrierefreiheit.spec.ts",
      "bank-sortierung.spec.ts",
      "basiszinssatz.spec.ts",
      "bestaetigung.spec.ts",
      "layouts.spec.ts",
      "liquiditaet.spec.ts",
      "rechtsform.spec.ts",
    ],
    // Alle Tests der anderen Dateien bleiben, von barrierefreiheit.spec.ts nur BARRIEREFREIHEIT_2
    grepInvert: new RegExp(`barrierefreiheit\\.spec\\.ts (?!.*${TITEL_2})`),
  },
  "mit-daten-3": {
    testMatch: [
      "barrierefreiheit.spec.ts",
      "befehlspalette.spec.ts",
      "bwa.spec.ts",
      "dateiauswahl.spec.ts",
      "handy-felder.spec.ts",
      "knopfreihenfolge.spec.ts",
      "nav-einfahrbar.spec.ts",
      "status-anordnung.spec.ts",
      "steuerberatung.spec.ts",
      "verfahrensdokumentation.spec.ts",
    ],
    grepInvert: BARRIEREFREIHEIT_2,
  },
};

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // „ablauf“ läuft für sich nacheinander, die Gruppen von „mit-daten“ danach verteilt auf die Worker; die übrigen Durchläufe
  // mit eigenem Server und „ohne-daten“ von Anfang an daneben
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
      // Datumsfelder zeigt Chromium in der Sprache des Browsers, nicht in locale: Ohne --lang stehen in den Bildern
      // für README und Doku auf macOS „11/11/2026“, unter Linux je nach LANG. Nur für die Bilder, die Tests bleiben unberührt
      ...(process.env.DOKU_SCREENSHOTS ? { args: ["--lang=de-DE"] } : {}),
    },
  },
  projects: [
    // Der Betrieb in der leeren Datenbank, Schritt für Schritt (test.describe.configure serial in der Datei); legt
    // an, was „mit-daten“ liest
    ...(ausAbzug ? [] : [{ name: "ablauf", testMatch: "app.spec.ts", use: chromium }]),
    // Sichert den Stand nach „ablauf“ und spielt ihn ein (e2e/abzug.ts); mit E2E_ABZUG=1 nur den eines früheren Laufs
    { name: "abzug", testMatch: "abzug.setup.ts", dependencies: ausAbzug ? [] : ["ablauf"], use: chromium },
    // Lesen nur, was „ablauf“ angelegt hat, mit dessen Sitzung (e2e/daten.ts), aus dem Abzug. Drei Gruppen ähnlicher Dauer
    // für drei CI-Teile (TEILE); barrierefreiheit.spec.ts ist allein länger als eine Gruppe und nach Titeln geteilt. Playwright
    // startet „abzug“ (und ohne E2E_ABZUG „ablauf“) auch mit, wenn nur eine dieser Dateien laufen soll
    ...MIT_DATEN.map((name) => ({ name, ...gruppen[name], dependencies: ["abzug"], use: chromium })),
    // Durchläufe mit eigenem Server und eigener Datenbank, von Anfang an daneben: die GmbH, weil die Rechtsform ab der
    // ersten Buchung fest ist, die übrigen, damit app.spec.ts kurz bleibt
    ...durchlaeufe.map((durchlauf) => ({
      name: durchlauf,
      testMatch: `${durchlauf}.spec.ts`,
      // Ein Abschnitt beginnt mit dem Abzug seines Durchlaufs (e2e/abzug.ts)
      dependencies: ABZUG_AUS[durchlauf] ? [ABZUG_AUS[durchlauf]] : [],
      use: { ...chromium, baseURL: `http://localhost:${portFuer(durchlauf)}` },
    })),
    // Braucht keine Daten aus der App
    {
      name: "ohne-daten",
      testMatch: [
        "elster-helfer.spec.ts",
        "elster-helfer-erweiterung.spec.ts",
        "langsame-anfrage.spec.ts",
        "beenden.spec.ts",
        "doku-startseite.spec.ts",
        "datenbankrolle.spec.ts",
        "knoepfe.spec.ts",
        "navigation-kontrast.spec.ts",
        "navigation-rollen.spec.ts",
      ],
      use: chromium,
    },
  ].filter((projekt) => gewaehlt(projekt.name as Projekt)),
  webServer: [...(hauptserver ? [webServer()] : []), ...durchlaeufe.filter(gewaehlt).map(webServer)],
});
