import { createServer, type Server, type ServerResponse } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, KI_PORT } from "./durchlaeufe.ts";
import { axeVerstoesse, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Warteschlange der KI-Auslesung (#1735) in eigener, leerer Datenbank (Projekt „ki-warteschlange“, e2e/durchlaeufe.ts):
 * Grenzen in den Einstellungen, Hochladen in Reihenfolge, Anhalten und Fortsetzen, „ausgelastet“ und neu auslesen in
 * der Reihenfolge der Liste. Nur der Server dieses Durchlaufs liest mit dem nachgebauten Dienst unten aus
 * (EXTRACTION_BASE_URL in playwright.config.ts). Er erkennt den Beleg am letzten Byte des Fotos und antwortet mit
 * „Lieferant <Byte>“.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];
let ki: Server;
/** Welche Belege der Dienst ausgelesen hat, in der Reihenfolge der Anfragen */
const anfragen: number[] = [];
/** Diese Belege beantwortet der Dienst mit 429 */
const ausgelastet = new Set<number>();
/** Gesetzt: Der Dienst hält Antworten zurück, bis der Test sie freigibt */
let festhalten = false;
const festgehalten: (() => void)[] = [];

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3];
const foto = (nr: number) => ({ name: `beleg-${nr}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from([...JPEG, nr]) });

function antwort(nr: number) {
  const felder = {
    lieferant: `Lieferant ${nr}`,
    lieferantUstId: null,
    empfaenger: null,
    empfaengerUstId: null,
    rechnungsnummer: `R-${nr}`,
    belegdatum: `2026-0${nr}-15`,
    faelligAm: null,
    waehrung: "EUR",
    istGutschrift: false,
    betraege: [{ steuersatz: "19", netto: "10.00", steuer: "1.90" }],
    brutto: "11.90",
    kategorie: "software",
    hinweis: null,
  };
  return { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(felder) } }] };
}

/** Das letzte Byte des Fotos in der Anfrage */
function belegNr(body: string): number {
  const url = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(body)![1]!;
  const bytes = Buffer.from(url, "base64");
  return bytes[bytes.length - 1]!;
}

async function kiAttrappe(): Promise<Server> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const nr = belegNr(body);
      anfragen.push(nr);
      const senden = (res: ServerResponse) => {
        res.writeHead(ausgelastet.has(nr) ? 429 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(ausgelastet.has(nr) ? { error: { message: "Rate limit" } } : antwort(nr)));
      };
      if (festhalten) festgehalten.push(() => senden(response));
      else senden(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(KI_PORT, "127.0.0.1", resolve));
  return server;
}

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  ki = await kiAttrappe();
});

test.afterAll(async () => {
  await page.context().close();
  for (const freigeben of festgehalten.splice(0)) freigeben();
  await new Promise((resolve) => ki?.close(resolve));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const leiste = () => page.getByRole("region", { name: "KI-Auslesung" });
const zeile = (text: string) => page.locator("a.table-row.document-cols").filter({ hasText: text });

async function angehalten(an: boolean): Promise<void> {
  const sql = postgres(databaseUrlFuer("ki-warteschlange"), { max: 1, onnotice: () => {} });
  try {
    await sql`update company set extraction_paused = ${an}`;
  } finally {
    await sql.end();
  }
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Grenzen der Belegauslesung speichern; eine ungültige Angabe steht am Feld", async () => {
  await gehe(page, "/einstellungen?bereich=ki");
  const karte = page.getByRole("region", { name: "Grenzen der Belegauslesung" });
  await karte.getByLabel("Anfragen pro Minute").fill("null");
  await karte.getByRole("button", { name: "Grenzen speichern" }).click();
  await expect(karte.getByLabel("Anfragen pro Minute")).toBeFocused();
  await expect(karte.getByText("Eine ganze Zahl ab 1, oder leer für keine Grenze.")).toBeVisible();
  await karte.getByLabel("Anfragen pro Minute").fill("600");
  // Ein Beleg nach dem anderen, damit die Reihenfolge der Anfragen feststeht
  await expect(karte.getByLabel("Parallele Anfragen")).toHaveValue("4");
  await karte.getByLabel("Parallele Anfragen").fill("1");
  await karte.getByLabel("Tokens pro Minute").fill("1.000.000");
  await karte.getByRole("button", { name: "Grenzen speichern" }).click();
  await expect(karte.getByText("Grenzen gespeichert.")).toBeVisible();
  await gehe(page, "/einstellungen?bereich=ki");
  await expect(karte.getByLabel("Tokens pro Minute")).toHaveValue("1000000");
  await expect(karte.getByLabel("Tokens je Anfrage")).toHaveValue("");
  await expect(karte.getByLabel("Parallele Anfragen")).toHaveValue("1");
  expect(await axeVerstoesse(page), "Grenzen der Belegauslesung").toEqual([]);
});

test("Hochgeladen warten die Belege, der neueste oben; Fortsetzen liest sie von oben nach unten aus, die Zeilen bleiben stehen", async () => {
  await angehalten(true);
  await gehe(page, "/belege");
  await page.locator("input[type=file][multiple]").setInputFiles([foto(1), foto(2), foto(3)]);
  await expect(page.getByText("beleg-3.jpg: abgelegt.")).toBeVisible();
  await expect(leiste()).toContainText("Auslesung angehalten · 3 warten");
  const zeilen = page.locator("a.table-row.document-cols");
  await expect(zeilen.nth(0)).toContainText("beleg-3.jpg");
  await expect(zeilen.nth(1)).toContainText("beleg-2.jpg");
  await expect(zeilen.nth(2)).toContainText("beleg-1.jpg");
  await expect(zeile("beleg-1.jpg")).toContainText("Wartet auf Auslesung");
  expect(await axeVerstoesse(page), "Belegliste mit Warteschlange").toEqual([]);

  ausgelastet.add(2);
  await leiste().getByRole("button", { name: "Fortsetzen" }).click();
  await expect(zeile("Lieferant 1")).toContainText("Zu prüfen");
  await expect(zeile("beleg-2.jpg")).toContainText("Prüfen");
  expect(anfragen).toEqual([3, 2, 1]);
  await expect(zeilen.nth(0)).toContainText("Lieferant 3");
  await expect(zeilen.nth(1)).toContainText("beleg-2.jpg");
  await expect(zeilen.nth(2)).toContainText("Lieferant 1");
  await expect(leiste()).toContainText("KI-Auslesung · 1 fehlgeschlagen");

  // Am Handy steht „Prüfen“ ganz da, ohne „…“: Die Spalte des Status ist so breit wie das Wort mit seiner Fläche
  await page.setViewportSize({ width: 375, height: 812 });
  const wort = zeile("beleg-2.jpg").locator(".status-text");
  await expect(wort).toHaveText("Prüfen");
  expect(await wort.evaluate((e) => e.scrollWidth - e.clientWidth)).toBe(0);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("Fehlgeschlagene neu auslesen: nur der fehlgeschlagene Beleg, kein zweiter Versuch von selbst", async () => {
  ausgelastet.clear();
  await leiste().getByRole("button", { name: "Fehlgeschlagene neu auslesen" }).click();
  await expect(zeile("Lieferant 2")).toContainText("Zu prüfen");
  expect(anfragen).toEqual([3, 2, 1, 2]);
  await expect(leiste()).toHaveCount(0);
});

test("Markierte neu auslesen in der Reihenfolge der Liste; Anhalten wartet den laufenden Beleg ab", async () => {
  // Datum absteigend: Lieferant 3 (März) vor Lieferant 1 (Januar)
  await gehe(page, "/belege?sort=datum&dir=ab");
  await page.getByLabel("Lieferant 1 markieren").check();
  await page.getByLabel("Lieferant 3 markieren").check();
  await expect(leiste()).toContainText("2 ausgewählt");
  festhalten = true;
  await leiste().getByRole("button", { name: "Neu auslesen" }).click();
  await expect(leiste()).toContainText("1 wartet · 1 wird ausgelesen");
  await expect(zeile("Lieferant 3")).toContainText("Wird ausgelesen");
  // Der Punkt pulsiert nur bei dem Beleg, der gerade ausgelesen wird
  await expect(zeile("Lieferant 3").locator(".status-pulse")).toHaveCount(1);
  await expect(zeile("Lieferant 1").locator(".status-pulse")).toHaveCount(0);
  await expect(zeile("Lieferant 1")).toContainText("Wartet auf Auslesung");

  await leiste().getByRole("button", { name: "Anhalten" }).click();
  await expect(leiste()).toContainText("Auslesung angehalten");
  festhalten = false;
  for (const freigeben of festgehalten.splice(0)) freigeben();
  await expect(zeile("Lieferant 3")).toContainText("Zu prüfen");
  await expect(zeile("Lieferant 1")).toContainText("Wartet auf Auslesung");
  expect(anfragen).toEqual([3, 2, 1, 2, 3]);

  await leiste().getByRole("button", { name: "Fortsetzen" }).click();
  await expect(zeile("Lieferant 1")).toContainText("Zu prüfen");
  expect(anfragen).toEqual([3, 2, 1, 2, 3, 1]);
});
