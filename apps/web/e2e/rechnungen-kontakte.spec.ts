import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import postgres from "postgres";
import { serverAufrufe } from "./warten.ts";
import { USER, YEAR } from "./daten.ts";
import { type Durchlauf, databaseUrlFuer } from "./durchlaeufe.ts";
import {
  artikelInPosition,
  axeVerstoesse,
  bestaetigen,
  durchlaufSeite,
  gehe,
  INVOICES,
  kundeWaehlen,
  neuenKontaktOeffnen,
  ohneAxeVerstoesse,
  rechnungFestschreiben,
  trefferliste,
  randImDialog,
  ueberSchnellsuche,
  weitereAngabenOeffnen,
} from "./einrichtung.ts";
import { receiptJpeg } from "./belegbild.ts";
import { abzugEinspielen } from "./abzug.ts";
import { eingabeNachAktion, fokusNachFehlschlag } from "./felder-sperre.ts";

/**
 * Abschnitt von rechnungen (#1742) mit eigenem Server und eigener Datenbank, parallel zu den anderen Abschnitten:
 * Kontakte und Rechnungsentwurf (Grundstücksleistung, § 35a EStG, Abschlag, DATEV-Personenkonten, Kundennummern,
 * Weitere Angaben, Fehler am Feld), REST-API, Connector per OAuth und CSV-Import.
 * Beginnt mit dem Abzug nach der Einrichtung mit drei Kunden und einer festgeschriebenen Rechnung in rechnungen.spec.ts
 * (e2e/abzug.ts).
 */

const DURCHLAUF = "rechnungen-kontakte" satisfies Durchlauf;

test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser, await abzugEinspielen("rechnungen", DURCHLAUF)));
});

test.afterAll(async () => {
  await page.context().close();
});

const go = (path: string) => gehe(page, path);

/** Daten von außen in einer Transaktion, als Akteur „e2e“ für die Audit-Trigger */
const alsE2e = (sql: postgres.Sql, arbeit: (tx: postgres.TransactionSql) => Promise<unknown>) =>
  sql.begin(async (tx) => {
    await tx`select set_config('haben.actor', 'e2e', true)`;
    await arbeit(tx);
  });

test("Grundstücksleistung: fester Aufbewahrungshinweis, Entwurf speichern und erneut laden (#718)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Terrassenrenovierung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1200");
  const haken = page.getByRole("checkbox", { name: "Leistung an einem Grundstück für einen Privatkunden (§ 14 Abs. 4 Nr. 9 UStG)" });
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  await expect(haken).not.toBeChecked();
  await expect(vorschau).not.toContainText("zwei Jahre aufzubewahren");
  await haken.focus();
  await page.keyboard.press("Space");
  await expect(haken).toBeChecked();
  await expect(vorschau).toContainText("zwei Jahre aufzubewahren");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}$/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(haken).toBeChecked();
  await haken.uncheck();
  await expect(vorschau).not.toContainText("zwei Jahre aufzubewahren");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Entwurf gespeichert." })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(haken).not.toBeChecked();
  await page.getByRole("button", { name: "Entwurf löschen", exact: true }).click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(/\/rechnungen(?:\?.*)?$/);

  await go("/rechnungen/wiederkehrend/neu");
  await expect(haken).not.toBeChecked();
  await haken.check();
  await expect(haken).toBeChecked();
  await expect(haken).toHaveAccessibleDescription(/zweijährigen Aufbewahrung/);
  await go("/angebote/neu");
  await expect(haken).toHaveCount(0);
});

test("§ 35a EStG: Artikel mit Arbeitskosten setzt den Haken, die Vorschau nennt den Anteil, Ausschalten nimmt das Kennzeichen (#712)", async () => {
  await go("/artikel");
  await page.getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Montage Rauchwarnmelder");
  await form.getByLabel("Preis (€)").fill("8,00");
  await form.getByLabel("Kosten für § 35a EStG").selectOption("ja");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Artikel angelegt." })).toBeVisible();

  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Rauchwarnmelder");
  await page.getByLabel(/Einzelpreis Position 1/).fill("31,00");
  const haken = page.getByRole("checkbox", { name: "Anteil der Arbeits-, Maschinen- und Fahrtkosten ausweisen (§ 35a EStG)" });
  const kosten = (position: number) => page.getByLabel(`Kosten der Position ${position} für § 35a EStG`);
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  await expect(haken).not.toBeChecked();
  await expect(kosten(1)).toHaveCount(0);
  await expect(vorschau).not.toContainText("Fahrtkosten");

  // Der Artikel bringt das Kennzeichen mit; der Haken geht damit an, jede Position zeigt ihre Auswahl
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await artikelInPosition(page, 2, "Montage Rauchwarnmelder");
  await expect(haken).toBeChecked();
  await expect(kosten(1)).toHaveValue("nein");
  await expect(kosten(2)).toHaveValue("ja");
  await expect(vorschau).toContainText("Fahrtkosten");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}$/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(haken).toBeChecked();
  await expect(kosten(2)).toHaveValue("ja");

  // Ausschalten nimmt allen Positionen das Kennzeichen
  await haken.uncheck();
  await expect(kosten(2)).toHaveCount(0);
  await expect(vorschau).not.toContainText("Fahrtkosten");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Entwurf gespeichert." })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(haken).not.toBeChecked();
  await page.getByRole("button", { name: "Entwurf löschen", exact: true }).click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(/\/rechnungen(?:\?.*)?$/);
});

test("Rechnungskopf: Hinweise zu Leistungszeitraum, Format, Fremdwährung und Festschreiben (#1253)", async () => {
  await go("/rechnungen/neu");
  for (const feld of ["Leistung von", "Leistung bis"]) {
    await expect(page.getByLabel(feld, { exact: true })).toHaveAccessibleDescription(
      /^Tag oder Zeitraum der Leistung\. Beide leer: Auf der Rechnung steht das Rechnungsdatum; eine Zahlung vor der Leistung erkennt Haben dann nicht als Vorauszahlung\. Eingetragen, auch am Rechnungsdatum: Die Steuer auf eine Zahlung vor der Leistung entsteht im Voranmeldungszeitraum der Zahlung\. Vorauszahlung auf normale Rechnungen$/,
    );
  }
  await expect(page.getByLabel("E-Rechnungsformat", { exact: true })).toHaveAccessibleDescription(
    /^ZUGFeRD passt für die meisten Kunden\. XRechnung nur, wenn der Kunde sie verlangt.*Leitweg-ID/,
  );
  const festschreiben = page.getByRole("button", { name: "Festschreiben", exact: true }).first();
  await expect(festschreiben).toHaveAccessibleDescription(/Nach dem Festschreiben bekommt die Rechnung ihre endgültige Nummer und ist nicht mehr änderbar/);
  await expect(festschreiben).toHaveAttribute("title", "Danach nicht mehr änderbar, Haben vergibt die Nummer");
  await expect(page.getByText("Gebucht wird in Euro")).toHaveCount(0);
  await page.getByLabel("Währung", { exact: true }).fill("USD");
  await expect(page.getByLabel("Währung", { exact: true })).toHaveAccessibleDescription(
    /^Beträge in USD, die Umsatzsteuer zusätzlich in Euro\. Gebucht wird in Euro; leerer Kurs = Umsatzsteuer-Umrechnungskurs des Leistungsmonats, sobald veröffentlicht\. Kein GiroCode.*Mahnung aus Haben\. Rechnungen in Fremdwährung$/,
  );
  await expect(page.getByRole("link", { name: "Rechnungen in Fremdwährung" })).toHaveAttribute("href", /\/rechnungen\.html#rechnungen-in-fremdw/);
  // Das Vorauszahlungsverfahren gibt es nur für Euro; in Fremdwährung gilt der allgemeine Hinweis
  await expect(page.getByLabel("Leistung von", { exact: true })).toHaveAccessibleDescription(
    /^Tag oder Zeitraum der Leistung, wenn er vom Rechnungsdatum abweicht\. Beide leer: Auf der Rechnung steht das Rechnungsdatum\.$/,
  );
});

test("Angebot: Hinweis zum Leistungszeitraum nennt kein Rechnungsdatum (#1253)", async () => {
  await go("/angebote/neu");
  const hinweis = await page.getByLabel("Leistung von", { exact: true }).evaluate((el) => el.getAttribute("aria-describedby"));
  expect(hinweis).not.toBeNull();
  await expect(page.getByLabel("Leistung von", { exact: true })).not.toHaveAccessibleDescription(/Rechnungsdatum/);
});

test("Teilleistung: Hinweis an „Leistung von“ nennt die Pflicht statt „leer“ (#1253)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Rechnungsart", { exact: true }).selectOption("abschlag");
  await page.getByRole("checkbox", { name: "Teilleistung bereits erbracht" }).check();
  const von = page.getByLabel("Leistung von", { exact: true });
  await expect(von).toHaveAttribute("required", "");
  await expect(von).not.toHaveAccessibleDescription(/Beide leer/);
});

test("Teilleistung: nur „Leistung von“ ist Pflicht, „Leistung bis“ ist nicht als Pflicht beschrieben (#1253)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Rechnungsart", { exact: true }).selectOption("abschlag");
  await page.getByRole("checkbox", { name: "Teilleistung bereits erbracht" }).check();
  const bis = page.getByLabel("Leistung bis", { exact: true });
  await expect(bis).not.toHaveAttribute("required");
  await expect(bis).not.toHaveAccessibleDescription(/Pflicht/);
  await expect(page.getByLabel("Leistung von", { exact: true })).toHaveAccessibleDescription("Tag der erbrachten Teilleistung, Pflicht.");
  await expect(bis).toHaveAccessibleDescription(/Nur bei einem Zeitraum/);
});

test("Abschlag: Anzahlung ist Vorgabe, erbrachte Teilleistung braucht ein Leistungsdatum (#622)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Rechnungsart", { exact: true }).selectOption("abschlag");
  const erbracht = page.getByRole("checkbox", { name: "Teilleistung bereits erbracht" });
  await expect(erbracht).not.toBeChecked();
  await expect(
    page.getByText("Umsatzsteuer entsteht bei Zahlungseingang; bei Soll-Versteuerung spätestens mit der Schlussleistung.", { exact: true }),
  ).toBeVisible();
  await erbracht.check();
  await expect(page.getByLabel("Leistung von", { exact: true })).toHaveAttribute("required", "");
  await expect(page.getByText("Bei Soll-Versteuerung entsteht die Umsatzsteuer mit der Teilleistung.", { exact: true })).toBeVisible();
  await erbracht.uncheck();
  await expect(page.getByLabel("Leistung von", { exact: true })).not.toHaveAttribute("required");
  for (const treatment of ["reverse_charge", "ig_lieferung", "drittland"]) {
    await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption(treatment);
    await expect(erbracht).toHaveAccessibleDescription(
      "Für diese Steuerbehandlung gelten die bisherigen Meldezeitpunkte; die Zahlungsregel für inländische Anzahlungen gilt hier nicht.",
    );
  }
  for (const treatment of ["ausfuhr", "steuerfrei"]) {
    await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption(treatment);
    await expect(erbracht).toHaveAccessibleDescription(
      "Steuerfreie Anzahlung ohne Umsatzsteuerausweis. Der Meldezeitpunkt richtet sich nach Zahlung und Schlussleistung.",
    );
  }
  await page.getByLabel("Umsatzsteuer", { exact: true }).selectOption("regulaer");
});

test("Kontaktseite: Rechnungen des Kunden mit Summe je Jahr (#587)", async () => {
  const jahr = INVOICES[0]!.date.slice(0, 4);
  await go("/kontakte");
  await go((await page.getByRole("link", { name: "Nordwerk Software GmbH" }).first().getAttribute("href"))!);
  const rechnungen = page.getByRole("region", { name: "Umsatz und Rechnungen", exact: true });
  const jahre = rechnungen.getByRole("group", { name: "Umsatz je Jahr", exact: true });
  // 96 Stunden zu 95,00 € netto
  await expect(jahre.getByRole("link", { name: new RegExp(`^${jahr}`) })).toContainText("9.120,00 €");
  await expect(jahre.getByRole("link", { name: new RegExp(`^${jahr}`) })).toContainText(`${INVOICES[0]!.gross} €`);
  await expect(jahre.getByRole("link", { name: new RegExp(`^${jahr}`) })).toHaveAttribute("aria-current", "page");
  const liste = rechnungen.getByRole("group", { name: `Rechnungen ${jahr}`, exact: true });
  await expect(liste.getByRole("link")).toHaveCount(1);
  await expect(liste.getByRole("link")).toContainText("Rechnung");
  // Kunde ohne Lieferantenrolle und ohne Belege: kein Abschnitt dafür
  await expect(page.getByRole("region", { name: "Ausgaben und Belege", exact: true })).toHaveCount(0);
  await liste.getByRole("link").click();
  await page.waitForURL(/\/rechnungen\/[0-9a-f-]{36}$/);
});

test("DATEV-Personenkonten: Schalter mit Bestätigung, fehlender Debitor wird vergeben, steht im Stapel und ist danach fest (#327)", async () => {
  const jahr = Number(INVOICES[0]!.date.slice(0, 4));
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("form", { name: "DATEV-Export" });
  await card.getByLabel("Beraternummer").fill("29098");
  await card.getByLabel("Mandantennummer").fill("55003");
  await card.getByLabel("DATEV-Personenkonten").selectOption(String(jahr));
  // Das Jahr hat schon eine Rechnung: nur mit ausdrücklicher Bestätigung
  const bestaetigung = card.getByRole("checkbox", { name: /hat schon Buchungen/ });
  await expect(bestaetigung).toBeVisible();
  await bestaetigung.check();
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Gespeichert.");
  await expect(bestaetigung).toBeHidden();

  // Nordwerk hat noch keinen Debitor: Der Export vergibt den ersten freien
  await card.getByRole("combobox", { name: "Jahr", exact: true }).selectOption(String(jahr));
  const download = page.waitForEvent("download");
  await card.getByRole("link", { name: "Buchungsstapel herunterladen" }).click();
  const datei = await download;
  expect(datei.suggestedFilename()).toBe(`EXTF_Buchungsstapel_${jahr}.csv`);
  const { readFile } = await import("node:fs/promises");
  const stapel = new TextDecoder("latin1").decode(await readFile((await datei.path())!));
  expect(stapel).toContain(";10000;8400;");
  expect(stapel).not.toContain(";1400;");

  // Am Kontakt steht die Nummer und ist ab dem ersten Export fest
  await go("/kontakte");
  await go((await page.getByRole("link", { name: "Nordwerk Software GmbH" }).first().getAttribute("href"))!);
  await expect(page.locator("details.weitere-angaben > summary")).toContainText("DATEV-Debitor 10000");
  await weitereAngabenOeffnen(page);
  await expect(page.getByLabel("DATEV-Debitor")).toHaveValue("10000");
  await page.getByLabel("DATEV-Debitor").fill("10002");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("alert")).toContainText("Debitor 10000 steht schon in einem DATEV-Export und bleibt fest.");
});

test("DATEV-Personenkonten: die Steuerberatung liest auf ihrer Startseite, warum ein neuer Debitor den Stapel ablehnt (#452)", async ({ browser }) => {
  const jahr = Number(INVOICES[1]!.date.slice(0, 4));
  await go("/kontakte");
  await go((await page.getByRole("link", { name: "Alpenblick Media AG" }).first().getAttribute("href"))!);
  await weitereAngabenOeffnen(page);
  await page.getByLabel("DATEV-Debitor").fill("10002");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  await rechnungFestschreiben(page, INVOICES[1]!);

  // Zugang für die Steuerberatung wie in steuerberatung.spec.ts
  await go("/einstellungen?bereich=sicherheit");
  await page.getByLabel("Bezeichnung").fill("Kanzlei Personenkonten");
  await page.getByRole("button", { name: "Einladungslink erzeugen" }).click();
  const link = page.getByRole("textbox", { name: /Einladungslink für/ });
  await expect(link).toHaveValue(/\/einladung\//);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const stb = await context.newPage();
  await stb.goto(await link.inputValue());
  await stb.getByLabel("Name").fill("Kanzlei Personenkonten");
  await stb.getByLabel("E-Mail").fill("personenkonten@example.com");
  await stb.getByLabel("Passwort (mindestens 12 Zeichen)").fill("kanzlei-passwort-e2e");
  await stb.getByRole("button", { name: "Zugang anlegen" }).click();
  await stb.getByRole("button", { name: "Später" }).click();
  await stb.waitForURL(/\/steuerberatung$/);

  // Debitor 10002 ist noch nicht festgeschrieben: Der Export lehnt ab, und die Steuerberatung liest den Grund
  await stb.getByLabel("Jahr").selectOption(String(jahr));
  await stb.getByRole("link", { name: "DATEV-Buchungsstapel" }).click();
  await expect(stb.getByRole("alert")).toContainText("Der erste Export mit neuen Personenkonten muss vom Inhaber kommen");
  await expect(stb.getByRole("alert")).toContainText("Debitor 10002 (Alpenblick Media AG)");
  await context.close();
});

test("Kundennummer automatisch vergeben", async () => {
  await go("/einstellungen?bereich=rechnungen");
  const karte = page.getByRole("form", { name: "Kundennummern" });
  await karte.getByLabel("Format").fill("K {NNNN}");
  await expect(karte.getByText(/Buchstaben, Ziffern/)).toBeVisible();
  await karte.getByLabel("Format").fill("K-{NNNN}");
  await expect(karte).toContainText("Nächste: K-0001");
  await karte.getByRole("button", { name: "Kundennummern speichern" }).click();
  await expect(karte.getByRole("status")).toContainText("automatisch vergeben");

  await go("/kontakte/neu");
  await expect(page.getByText("voraussichtlich K-0001")).toBeVisible();
  await page.getByLabel("Name oder Firma").fill("Nummernkreis Testkunde");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await expect(page.getByLabel("Kundennummer")).toHaveValue("K-0001");
  // Archivieren und abschalten: Die folgenden Tests rechnen mit den Kontakten und Nummern von Hand
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  await go("/einstellungen?bereich=rechnungen");
  await karte.getByLabel("Format").fill("");
  await karte.getByRole("button", { name: "Kundennummern speichern" }).click();
  await expect(karte.getByRole("status")).toContainText("von Hand");
});

test("Kunde mit Rechnungen auf Englisch", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Harbour Labs Ltd");
  await page.getByLabel("Ort").fill("London");
  await page.getByRole("combobox", { name: /^Sprache von Rechnungen/ }).selectOption("en");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await go("/rechnungen/neu");
  const sprache = page.getByRole("combobox", { name: /^Sprache/ });
  await expect(sprache).toHaveValue("de");
  await kundeWaehlen(page, "Harbour Labs Ltd · London");
  await expect(sprache).toHaveValue("en");
  // Die Vorschau zeigt das englische Blatt, nicht mehr nur den Aufbau
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText("Invoice");
});

test("Unsere Lieferantennummer beim Kunden steht im Kopf der Rechnung (#711)", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Wohnbau Nord eG");
  await page.getByLabel("Ort").fill("Lübeck");
  await page.getByLabel("Unsere Lieferantennummer bei diesem Kunden").fill("70815");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await expect(page.getByLabel("Unsere Lieferantennummer bei diesem Kunden")).toHaveValue("70815");
  // Die eigene Lieferantennummer (Gegenrichtung) bleibt leer
  await expect(page.getByLabel("Lieferantennummer", { exact: true })).toHaveValue("");
  const kontakt = page.url();

  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Wohnbau Nord eG · Lübeck");
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText("Lieferantennummer: 70815");
  // Archivieren: Die folgenden Tests rechnen nicht mit diesem Kunden
  await go(kontakt);
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Kontakt bearbeiten: Die Meldung „Gespeichert.“ bleibt nach dem Speichern stehen", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Speicher Testkunde GmbH");
  await page.getByLabel("Ort").fill("Bremen");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await page.getByLabel("Ort").fill("Hamburg");
  const speichern = serverAufrufe(page);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  // Nach dem Speichern lädt die Seite die neue Version und baut das Formular neu auf; die Meldung darf dabei nicht verschwinden
  await expect(page.getByText("Version 2")).toBeVisible();
  const meldung = page.getByRole("form", { name: "Kontakt" }).getByText("Gespeichert. Die vorige Fassung bleibt als Version erhalten.");
  await expect(meldung).toBeVisible();
  await expect(page.getByLabel("Ort")).toHaveValue("Hamburg");
  // Auch wenn Speichern und Neuladen ganz durch sind, nicht nur für einen Augenblick
  await speichern.fertig();
  await expect(meldung).toBeVisible();
  // Archivieren: Die folgenden Tests rechnen nicht mit diesem Kunden
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Kontakt bearbeiten: Eingaben direkt nach dem Speichern bleiben erhalten (#1824)", async () => {
  await go("/kontakte/neu");
  const name = page.getByLabel("Name oder Firma");
  await name.fill("Sperre Testkunde GmbH");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await name.fill("Sperre Testkunde gespeichert");
  await eingabeNachAktion(page, {
    aktion: page.getByRole("button", { name: "Speichern", exact: true }),
    feld: page.getByLabel("Ort"),
    text: "Gleich danach getippt",
    neuGeladen: page.getByRole("heading", { name: "Sperre Testkunde gespeichert", level: 1 }),
  });
});

test("Kontakt bearbeiten: Speichern schlägt fehl, der Fokus steht danach wieder im Feld (#1824)", async () => {
  // Der Kontakt aus dem Test davor
  await fokusNachFehlschlag(page, page.getByLabel("Ort"));
  // Archivieren: Die folgenden Tests rechnen nicht mit diesem Kunden
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Kontakt mit beiden Rollen trägt DATEV-Debitor und -Kreditor, eine vergebene Nummer meldet das Formular (#327)", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Musterpartner GmbH");
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("Kundennummer").fill("K-42");
  await weitereAngabenOeffnen(page);
  await page.getByLabel("DATEV-Debitor").fill("10042");
  await page.getByLabel("DATEV-Kreditor").fill("70087");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await expect(page.getByLabel("Kundennummer")).toHaveValue("K-42");
  await expect(page.locator("details.weitere-angaben > summary")).toContainText("DATEV-Debitor 10042 · DATEV-Kreditor 70087");
  await weitereAngabenOeffnen(page);
  await expect(page.getByLabel("DATEV-Debitor")).toHaveValue("10042");
  await expect(page.getByLabel("DATEV-Kreditor")).toHaveValue("70087");
  // Archivieren: Die folgenden Tests rechnen nicht mit einem Lieferanten
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();

  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Zweiter Partner");
  await weitereAngabenOeffnen(page);
  await page.getByLabel("DATEV-Debitor").fill("70087");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByText("Debitor: 10000 bis 69999 (fünfstellig, nach DATEV-Kontenrahmen)")).toBeVisible();
  await page.getByLabel("DATEV-Debitor").fill("10042");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByText("Debitor 10042 hat schon „Musterpartner GmbH“.")).toBeVisible();
});

test("Kontakt: Weitere Angaben sind zu und zeigen Gesetztes, ein Fehler darin klappt sie auf, zugeklappt geht nichts verloren (#1253)", async () => {
  await go("/kontakte/neu");
  const bereich = page.locator("details.weitere-angaben");
  await expect(bereich).toHaveJSProperty("open", false);
  await expect(bereich.locator("summary")).toContainText("DATEV-Konten, Skonto");
  await page.getByLabel("Name oder Firma").fill("Landesamt Nord");
  await weitereAngabenOeffnen(page);
  await page.getByLabel("Leitweg-ID").fill("991-01234-44");
  await page.getByLabel("DATEV-Debitor").fill("123");
  await bereich.locator("summary").click();
  await expect(bereich).toHaveJSProperty("open", false);
  await expect(bereich.locator("summary")).toContainText("Leitweg-ID gesetzt");

  // Der Fehler steht im zugeklappten Bereich: Er klappt auf
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByText("Debitor: 10000 bis 69999 (fünfstellig, nach DATEV-Kontenrahmen)")).toBeVisible();
  await expect(bereich).toHaveJSProperty("open", true);

  // Zugeklappt gespeichert, sind die Werte da
  await page.getByLabel("DATEV-Debitor").fill("");
  await bereich.locator("summary").click();
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await expect(bereich.locator("summary")).toContainText("Leitweg-ID gesetzt");
  await weitereAngabenOeffnen(page);
  await expect(page.getByLabel("Leitweg-ID")).toHaveValue("991-01234-44");
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Kontakt: Meldung des Servers zu Leitweg-ID und Stundensatz klappt Weitere Angaben auf und setzt den Fokus (#1253)", async () => {
  for (const [feld, wert] of [
    ["Leitweg-ID", "9".repeat(47)],
    ["Stundensatz (€, optional)", "100000,01"],
  ] as const) {
    await go("/kontakte/neu");
    const bereich = page.locator("details.weitere-angaben");
    await page.getByLabel("Name oder Firma").fill("Review Amt");
    await weitereAngabenOeffnen(page);
    await page.getByLabel(feld).fill(wert);
    await bereich.locator("summary").click();
    await expect(bereich).toHaveJSProperty("open", false);
    await page.getByRole("button", { name: "Kontakt anlegen" }).click();
    await expect(page.getByText(/höchstens/)).toBeVisible();
    await expect(bereich, `${feld}: Bereich klappt bei Serverfehler auf`).toHaveJSProperty("open", true);
    await expect(page.getByLabel(feld)).toBeFocused();
  }
});

test("Kunden im Rechnungsentwurf anlegen, ohne die Eingaben zu verlieren (#330)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Workshop Barrierefreiheit");
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await neuenKontaktOeffnen(page);
  await expect(dialog).toBeVisible();
  await randImDialog(dialog, [dialog.getByLabel("Name oder Firma"), dialog.getByRole("button", { name: "Kontakt anlegen" })]);
  await expect(dialog.getByLabel("Kunde", { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Lieferant", { exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Barrierefreiheit");

  await neuenKontaktOeffnen(page);
  await dialog.getByLabel("Name oder Firma").fill("Dialogkunde GmbH");
  await dialog.getByLabel("Ort").fill("Bremen");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue("Dialogkunde GmbH · Bremen");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Barrierefreiheit");

  // Nicht speichern; den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await go("/kontakte");
  await page.getByRole("link", { name: /Dialogkunde GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Rechnungsentwurf: Kunden im Dialog anlegen speichert den Entwurf nicht mit (#1835)", async () => {
  // Gespeichert, danach eine Änderung: Ein Absenden des Entwurfs würde wirklich speichern
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("500");
  const speichern = page.getByRole("button", { name: "Entwurf speichern", exact: true });
  await speichern.click();
  await page.waitForURL(/\/rechnungen\/[0-9a-f-]{36}$/);
  await expect(speichern).toBeDisabled();
  const id = page.url().split("/").pop()!;
  await page.getByLabel("Beschreibung Position 1").fill("Beratung geändert");
  await expect(speichern).toBeEnabled();

  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    const stand = async () => (await sql`select contact_id, updated_at from invoices where id = ${id}`)[0];
    const vorher = await stand();
    const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
    await neuenKontaktOeffnen(page);
    await dialog.getByLabel("Name oder Firma").fill("Dialogkunde Süd GmbH");
    await dialog.getByLabel("Ort").fill("Passau");
    const aufrufe = serverAufrufe(page);
    await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
    await expect(dialog).toBeHidden();
    await aufrufe.fertig();
    // Der neue Kunde steht im Feld, die Änderung bleibt ungespeichert
    await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue("Dialogkunde Süd GmbH · Passau");
    await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Beratung geändert");
    await expect(speichern).toBeEnabled();
    expect(await stand()).toEqual(vorher);
  } finally {
    await sql.end();
  }

  // Den Entwurf löschen und den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await page.getByRole("button", { name: "Entwurf löschen", exact: true }).click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(/\/rechnungen(?:\?.*)?$/);
  await go("/kontakte");
  await page.getByRole("link", { name: /Dialogkunde Süd GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Kontakt: Schnellanlage und Bearbeiten speichern auch zugeklappte Weitere Angaben, ungeänderte bleiben (#1253)", async () => {
  await go("/rechnungen/neu");
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await neuenKontaktOeffnen(page);
  await dialog.getByLabel("Name oder Firma").fill("Dialog Amt");
  await dialog.getByText("Weitere Angaben").click();
  await dialog.getByLabel("DATEV-Debitor").fill("10077");
  await dialog.getByLabel("Stundensatz (€, optional)").fill("95,50");
  await dialog.getByLabel("Leitweg-ID").fill("991-01234-44");
  await dialog.getByLabel("Standardformat für Rechnungen").selectOption("xrechnung-ubl");
  await dialog.getByRole("combobox", { name: /^Skonto/ }).selectOption("eigen");
  await dialog.getByRole("button", { name: "Skontostufe hinzufügen" }).click();
  await dialog.getByLabel("Stufe 1: Skonto in %").fill("2,5");
  await dialog.getByLabel("Stufe 1: Frist in Tagen").fill("10");
  await dialog.getByText("Weitere Angaben").click();
  await expect(dialog.locator("details.weitere-angaben")).toHaveJSProperty("open", false);
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();

  await go("/kontakte");
  await page.getByRole("link", { name: /Dialog Amt/ }).click();
  const bereich = page.locator("details.weitere-angaben");
  await expect(bereich.locator("summary")).toContainText("DATEV-Debitor 10077 · Stundensatz 95,50 € · Leitweg-ID gesetzt");
  await expect(bereich.locator("summary")).toContainText("Skonto 2,50 % in 10 Tagen");
  // Nur den Namen ändern, Bereich bleibt zu
  await page.getByLabel("Name oder Firma").fill("Dialog Amt Nord");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  await weitereAngabenOeffnen(page);
  await expect(page.getByLabel("DATEV-Debitor")).toHaveValue("10077");
  await expect(page.getByLabel("Stundensatz (€, optional)")).toHaveValue("95,50");
  await expect(page.getByLabel("Leitweg-ID")).toHaveValue("991-01234-44");
  await expect(page.getByLabel("Standardformat für Rechnungen")).toHaveValue("xrechnung-ubl");
  await expect(page.getByLabel("Stufe 1: Skonto in %")).toHaveValue("2,50");
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Kontakt: Wechsel ohne Neuladen zu einem Kontakt mit gleicher Version zeigt dessen Angaben, offene Formulare der Karten gehen zu (#1834)", async () => {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  const format = (await sql<{ format: string }[]>`select quote_number_format as format from company where id = 1`)[0]!.format;
  try {
    // Zwei Kunden in Version 1, mit eigenem Angebotskreis, damit auch dessen Karte am Rand steht (#1426)
    await alsE2e(sql, async (tx) => {
      await tx`update company set quote_counter_per_customer = true, quote_number_format = 'AN-{JJJJ}-{KUNDENNR}-{NNN}' where id = 1`;
      await tx`insert into contacts (name, ort, land, kundennummer, hourly_rate_cents, is_customer, is_supplier)
        values ('Wechselkunde Nord', 'Kiel', 'DE', 'WN-1834', 9550, true, false), ('Wechselkunde Süd', 'München', 'DE', 'WS-1834', 12000, true, false)`;
    });
    await go("/kontakte");
    await page.getByRole("link", { name: /Wechselkunde Nord/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Wechselkunde Nord" })).toBeVisible();
    await expect(page.getByLabel("Ort")).toHaveValue("Kiel");
    // Angefangenes in den Karten: Ansprechpartner, Mandat und nächste Angebotsnummer
    await page.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();
    await page.getByRole("form", { name: "Neuer Ansprechpartner" }).getByLabel("Name").fill("Frau Nord");
    await page.getByRole("button", { name: "Mandat anlegen" }).click();
    await expect(page.getByRole("form", { name: "Neues Mandat" }).getByLabel("Kontoinhaber")).toHaveValue("Wechselkunde Nord");
    const kreis = page.getByRole("form", { name: /^Angebotsnummern dieses Kunden/ });
    await kreis.getByLabel("Nächste laufende Nummer").fill("7");
    await kreis.getByRole("button", { name: "Übernehmen" }).click();
    await expect(kreis.getByRole("status")).toContainText("Nummernkreis gespeichert.");

    // Über die Schnellsuche zum anderen Kunden, ohne Neuladen: Formular und Karten gehören jetzt ihm
    await ueberSchnellsuche(page, "Wechselkunde Süd", /Wechselkunde Süd/);
    await expect(page.getByRole("heading", { level: 1, name: "Wechselkunde Süd" })).toBeVisible();
    const formular = page.getByRole("form", { name: "Kontakt" });
    await expect(formular.getByLabel("Name oder Firma")).toHaveValue("Wechselkunde Süd");
    await expect(formular.getByLabel("Ort")).toHaveValue("München");
    await expect(formular.getByLabel("Kundennummer")).toHaveValue("WS-1834");
    await weitereAngabenOeffnen(page);
    await expect(formular.getByLabel("Stundensatz (€, optional)")).toHaveValue("120,00");
    await expect(page.getByRole("form", { name: "Neuer Ansprechpartner" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ansprechpartner hinzufügen" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Neues Mandat" })).toHaveCount(0);
    await expect(kreis.getByLabel("Nächste laufende Nummer")).toHaveValue("1");
    await expect(kreis.getByRole("status")).toHaveCount(0);
  } finally {
    // Nicht in den Zahlen der folgenden Tests, Angebotsnummern wieder ohne Kreis je Kunde
    await alsE2e(sql, async (tx) => {
      await tx`update contacts set archived_at = now() where kundennummer in ('WN-1834', 'WS-1834')`;
      await tx`update company set quote_counter_per_customer = false, quote_number_format = ${format} where id = 1`;
    });
    await sql.end();
  }
});

test("Kontakt: Beim Wechsel ohne Neuladen bleiben „Gespeichert.“ und ein Fehler des vorigen Kontakts nicht stehen (#1839)", async () => {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  const ost = page.getByRole("heading", { level: 1, name: "Meldekunde Ost" });
  const gespeichert = page.getByRole("form", { name: "Kontakt" }).getByRole("status").filter({ hasText: "Gespeichert." });
  const fehler = page.getByRole("alert");
  try {
    await alsE2e(
      sql,
      (tx) => tx`insert into contacts (name, ort, land, kundennummer, is_customer, is_supplier)
        values ('Meldekunde Ost', 'Rostock', 'DE', 'MO-1839', true, false), ('Meldekunde West', 'Aachen', 'DE', 'MW-1839', true, false)`,
    );
    await go("/kontakte");
    await ueberSchnellsuche(page, "Meldekunde Ost", /Meldekunde Ost/);
    await expect(ost).toBeVisible();
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(gespeichert).toBeVisible();

    // Beim anderen Kontakt scheitert das Archivieren: Die Meldung steht über der Seite
    await ueberSchnellsuche(page, "Meldekunde West", /Meldekunde West/);
    await expect(page.getByRole("heading", { level: 1, name: "Meldekunde West" })).toBeVisible();
    await expect(gespeichert).toHaveCount(0);
    const abbrechen = (route: Route) => (route.request().method() === "POST" ? route.abort() : route.continue());
    await page.route(/_serverFn/, abbrechen);
    await page.getByRole("button", { name: "Archivieren" }).click();
    await expect(fehler).toBeVisible();
    await page.unroute(/_serverFn/, abbrechen);

    // Zurück zum ersten: weder dessen „Gespeichert.“ von vorhin noch der Fehler des anderen
    await ueberSchnellsuche(page, "Meldekunde Ost", /Meldekunde Ost/);
    await expect(ost).toBeVisible();
    await expect(fehler).toHaveCount(0);
    await expect(gespeichert).toHaveCount(0);
  } finally {
    // Nicht in den Zahlen der folgenden Tests
    await alsE2e(sql, (tx) => tx`update contacts set archived_at = now() where kundennummer in ('MO-1839', 'MW-1839')`);
    await sql.end();
  }
});

test("Teilleistung ohne Leistungsdatum: Entwurf speichern nennt das Feld (Review #974)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Rechnungsart", { exact: true }).selectOption("abschlag");
  await page.getByRole("checkbox", { name: "Teilleistung bereits erbracht" }).check();
  await page.getByLabel("Beschreibung Position 1").fill("1. Abschlag");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1000");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  // Bisher hielt der Browser über required an; mit noValidate nennt useSubmitCheck das Feld
  await expect(page.getByLabel("Leistung von", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Leistung von", { exact: true })).toHaveAccessibleDescription(/Teilleistung/);
  await expect(page).toHaveURL(/\/rechnungen\/neu$/);
});

test("Festschreiben ohne Kunden nennt den Kunden am Feld statt der Rückfrage (Review #974)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  await page.locator(".main > .page-head").getByRole("button", { name: "Festschreiben" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveAccessibleDescription("Wähle den Kunden.");
});

test("Entwurf speichern nennt bei einem anderen Fehler nicht den fehlenden Kunden, Festschreiben schon", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  const ziel = page.getByLabel("Zahlungsziel in Tagen", { exact: true });
  await ziel.fill("200");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  // Ein Entwurf darf ohne Kunden gespeichert werden: der Kunde ist dabei kein Fehler, nur das Zahlungsziel
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(ziel).toBeFocused();
  await expect(ziel).toHaveAccessibleDescription(/ganzen Tagen von 0 bis 120/);
  await expect(kunde).not.toHaveAttribute("aria-invalid", "true");
  await expect(kunde).not.toHaveAccessibleDescription(/Wähle den Kunden/);
  // Festschreiben braucht den Kunden: jetzt steht er am Feld
  await page.locator(".main > .page-head").getByRole("button", { name: "Festschreiben" }).click();
  await expect(kunde).toHaveAccessibleDescription("Wähle den Kunden.");
  await expect(page).toHaveURL(/\/rechnungen\/neu$/);
});

test("Wiederkehrende Rechnung: Kunde suchen, ohne Kunde nicht speicherbar, neuen Kunden direkt anlegen", async () => {
  await go("/rechnungen/wiederkehrend/neu");
  await page.getByLabel("Bezeichnung").fill("Wartungsvertrag Test");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  // Pflichtfeld: Ohne gewählten Kunden speichert „Vorlage anlegen“ nicht, sondern sagt es am Feld (DESIGN.md, Gesperrte Knöpfe)
  expect(await kunde.evaluate((feld: HTMLInputElement) => feld.validity.valueMissing)).toBe(true);
  await page.getByRole("button", { name: "Vorlage anlegen" }).click();
  await expect(kunde).toBeFocused();
  await expect(kunde).toHaveAccessibleDescription(/Wähle den Kunden\./);
  await expect(page).toHaveURL(/\/rechnungen\/wiederkehrend\/neu$/);

  // Suche nach Name; nur Kunden stehen zur Auswahl
  await kunde.fill("Nordwerk");
  await trefferliste(page)
    .getByRole("option", { name: /Nordwerk Software GmbH/ })
    .click();
  await expect(kunde).toHaveValue("Nordwerk Software GmbH · Hamburg");
  expect(await kunde.evaluate((feld: HTMLInputElement) => feld.validity.valueMissing)).toBe(false);

  // Neuer Kunde mit dem getippten Namen, die Eingaben der Vorlage bleiben
  await kunde.fill("Vorlagenkunde GmbH");
  await trefferliste(page).getByRole("option", { name: "„Vorlagenkunde GmbH“ als neuen Kunden anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Vorlagenkunde GmbH");
  await expect(dialog.getByLabel("Kunde", { exact: true })).toBeChecked();
  await dialog.getByLabel("Ort").fill("Bremen");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(kunde).toHaveValue("Vorlagenkunde GmbH · Bremen");
  await expect(page.getByLabel("Bezeichnung")).toHaveValue("Wartungsvertrag Test");
  await expect(page).toHaveURL(/\/wiederkehrend\/neu$/);

  // Nicht speichern; den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await go("/kontakte");
  await page.getByRole("link", { name: /Vorlagenkunde GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Wiederkehrende Rechnung: Wechsel ohne Neuladen zu einer Vorlage mit gleichem Zeitstempel zeigt deren Angaben, die Meldung der vorigen geht (#1839)", async () => {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  const zeile = (description: string, unitPrice: number) => JSON.stringify([{ description, quantity: 1000, unit: "Monat", unitPrice, taxRate: 1900 }]);
  const bezeichnung = page.getByLabel("Bezeichnung");
  const position = page.getByLabel("Beschreibung Position 1");
  const gespeichert = page.getByRole("status").filter({ hasText: "Gespeichert." });
  try {
    // Zwei pausierte Vorlagen in einer Anweisung, also mit demselben updated_at
    await alsE2e(
      sql,
      (tx) => tx`insert into recurring_invoices (name, active, contact_id, lines, recurrence, anchor_day, next_date)
        select v.name, false, c.id, v.lines::jsonb, 'P1M', 1, ${`${YEAR + 1}-01-01`}::date
        from (values ('Wartung Wechsel Nord', ${zeile("Wartung Nord", 50000)}), ('Wartung Wechsel Süd', ${zeile("Wartung Süd", 70000)})) as v(name, lines),
          (select id from contacts where name = 'Nordwerk Software GmbH' and archived_at is null limit 1) as c`,
    );
    await go("/rechnungen/wiederkehrend");
    await ueberSchnellsuche(page, "Wartung Wechsel Nord", /Wartung Wechsel Nord/);
    await expect(page.getByRole("heading", { level: 1, name: "Wartung Wechsel Nord" })).toBeVisible();
    await expect(position).toHaveValue("Wartung Nord");
    await ueberSchnellsuche(page, "Wartung Wechsel Süd", /Wartung Wechsel Süd/);
    await expect(page.getByRole("heading", { level: 1, name: "Wartung Wechsel Süd" })).toBeVisible();
    await expect(bezeichnung).toHaveValue("Wartung Wechsel Süd");
    await expect(position).toHaveValue("Wartung Süd");

    // Gespeichert, dann zurück: Die Meldung gehört zur anderen Vorlage
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(gespeichert).toBeVisible();
    await ueberSchnellsuche(page, "Wartung Wechsel Nord", /Wartung Wechsel Nord/);
    await expect(bezeichnung).toHaveValue("Wartung Wechsel Nord");
    await expect(gespeichert).toHaveCount(0);
  } finally {
    await alsE2e(sql, (tx) => tx`delete from recurring_invoices where name like 'Wartung Wechsel %'`);
    await sql.end();
  }
});

test("REST-API: Token mit Rechten anlegen, Rechnungsentwurf mit Bestellnummer und Beleg über die API", async ({ browser }) => {
  await go("/einstellungen?bereich=ki");
  // Ohne ANTHROPIC_API_KEY und EXTRACTION_BASE_URL ist die Belegauslesung aus; die Karte sagt es und verweist auf die Doku
  const auslesung = page.getByRole("region", { name: "Belegauslesung" });
  await expect(auslesung).toContainText("Die KI-Auslesung ist aus.");
  await expect(auslesung.getByRole("link", { name: "Belegauslesung einrichten" })).toHaveAttribute("href", /einrichtung\.html#ki-auslesung-von-belegen/);
  // Gesteuertes Kästchen: es zeigt den Stand erst nach der Antwort des Servers
  const zugang = page.getByLabel("Zugang für KI-Assistenten und API einschalten");
  await zugang.click();
  await expect(zugang).toBeChecked();
  const form = page.getByRole("form", { name: "Neues Token" });
  await form.getByLabel("Name").fill("Shop-Automation");
  const rechte = form.getByRole("group", { name: "Rechte" });
  await expect(rechte.getByRole("checkbox", { name: /haben:lesen/ })).toBeChecked();
  await rechte.getByRole("checkbox", { name: /haben:lesen/ }).uncheck();
  await rechte.getByRole("checkbox", { name: /kontakte:lesen/ }).check();
  await rechte.getByRole("checkbox", { name: /rechnungen:entwuerfe/ }).check();
  await rechte.getByRole("checkbox", { name: /belege:anlegen/ }).check();
  await form.getByRole("button", { name: "Token anlegen" }).click();
  const token = await page.getByLabel(/Token für „Shop-Automation“/).inputValue();
  expect(token).toMatch(/^hb_/);
  // Ohne MCP-Recht kein Befehl für Claude Code, dafür der Hinweis auf die REST-API
  await expect(page.getByLabel("In Claude Code eintragen")).toHaveCount(0);
  await expect(page.getByText(/Für die REST-API: Adresse/)).toBeVisible();
  await expect(page.getByText(/Rechte: API: Kontakte lesen · API: Rechnungen lesen, Entwürfe .* · API: Belege lesen und hochladen/)).toBeVisible();

  // Die Sitzung im Browser reicht der API nicht, nur das Token
  expect((await page.request.get("/api/v1/kontakte")).status()).toBe(401);
  const auth = { Authorization: `Bearer ${token}` };
  expect((await page.request.get("/api/v1/openapi.json")).status()).toBe(200);
  const kontakte = (await (await page.request.get("/api/v1/kontakte?q=Nordwerk", { headers: auth })).json()) as { data: { id: string }[] };
  expect(kontakte.data).toHaveLength(1);
  expect((await page.request.post("/api/v1/kontakte", { headers: auth, data: { name: "Ohne Recht" } })).status()).toBe(403);

  const entwurf = {
    contactId: kontakte.data[0]!.id,
    externalSource: "etsy",
    externalId: "3141592653",
    lines: [{ description: "Keramikbecher handgemacht", quantity: 2000, unit: "Stk.", unitPrice: 2400, taxRate: 1900 }],
  };
  const created = await page.request.post("/api/v1/rechnungen", { headers: auth, data: entwurf });
  expect(created.status()).toBe(201);
  const invoice = (await created.json()) as { id: string; gross: number; url: string; status: string };
  expect(invoice).toMatchObject({ gross: 5712, status: "draft" });
  // Derselbe Vorgang ein zweites Mal: kein Duplikat
  const again = await page.request.post("/api/v1/rechnungen", { headers: auth, data: entwurf });
  expect(again.status()).toBe(200);
  expect(((await again.json()) as { id: string }).id).toBe(invoice.id);

  // Der Entwurf steht in Haben wie jeder andere, mit der Position aus der API
  await go(new URL(invoice.url).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Rechnung");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Keramikbecher handgemacht");

  // Wieder weg, damit die übrigen Seiten und Bilder dieselben Daten zeigen wie ohne diesen Test
  expect((await page.request.delete(`/api/v1/rechnungen/${invoice.id}`, { headers: auth })).status()).toBe(204);
  const found = (await (await page.request.get("/api/v1/rechnungen?externalSource=etsy&externalId=3141592653", { headers: auth })).json()) as { total: number };
  expect(found.total).toBe(0);

  // Ein Beleg aus einem Dokumentenarchiv, wie mit curl -F datei=@… -F externalSource=… -F externalId=…
  const beleg = {
    datei: { name: "archiv-4711.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Druckerei Archivtest GmbH") },
    externalSource: "archiv",
    externalId: "4711",
  };
  const uploaded = await page.request.post("/api/v1/belege", { headers: auth, multipart: beleg });
  expect(uploaded.status()).toBe(201);
  const document = (await uploaded.json()) as { id: string; url: string; status: string; booked: boolean };
  expect(document).toMatchObject({ status: "neu", booked: false });
  // Dasselbe Dokument ein zweites Mal: derselbe Beleg
  const repeated = await page.request.post("/api/v1/belege", { headers: auth, multipart: beleg });
  expect(repeated.status()).toBe(200);
  expect(((await repeated.json()) as { id: string }).id).toBe(document.id);

  // Unter Belege steht er als „Zu prüfen“, wie ein Upload in Haben
  await go("/belege");
  const row = page.getByRole("link", { name: /archiv-4711\.jpg/ });
  await expect(row).toContainText("Zu prüfen");
  await row.click();
  await page.waitForURL(new URL(document.url).pathname);
  await page.waitForLoadState("networkidle");
  // Nicht buchen: wieder löschen, damit die übrigen Seiten und Bilder dieselben Daten zeigen wie ohne diesen Test
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
  expect((await page.request.get(`/api/v1/belege/${document.id}`, { headers: auth })).status()).toBe(404);

  // Jeder Aufruf steht im Protokoll, ohne Inhalte
  await go("/einstellungen?bereich=ki");
  const calls = page.getByRole("region", { name: "Letzte Aufrufe" });
  await expect(calls.getByText("POST /rechnungen").first()).toBeVisible();
  await expect(calls.getByText("POST /belege").first()).toBeVisible();
});

test("Connector per OAuth (#96): registrieren, im Browser zustimmen, lesen und in den Einstellungen widerrufen", async () => {
  // Ausgeschaltet gibt es den OAuth-Weg nicht: jeder Endpunkt und die Zustimmungsseite antworten 404
  await go("/einstellungen?bereich=ki");
  const zugang = page.getByLabel("Zugang für KI-Assistenten und API einschalten");
  await zugang.click();
  await expect(zugang).not.toBeChecked();
  for (const pfad of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"])
    expect((await page.request.get(pfad)).status(), pfad).toBe(404);
  for (const pfad of ["/api/oauth/register", "/api/oauth/token"]) expect((await page.request.post(pfad, { data: {} })).status(), pfad).toBe(404);
  expect((await page.goto("/oauth/autorisieren?response_type=code"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Seite nicht gefunden" })).toBeVisible();
  await go("/einstellungen?bereich=ki");
  await zugang.click();
  await expect(zugang).toBeChecked();

  const metadaten = (await (await page.request.get("/.well-known/oauth-authorization-server")).json()) as Record<string, string>;
  const ressource = (await (await page.request.get("/.well-known/oauth-protected-resource")).json()) as { resource: string };
  const redirect = "http://127.0.0.1:9/callback";
  const registriert = await page.request.post(new URL(metadaten.registration_endpoint!).pathname, {
    data: { redirect_uris: [redirect], client_name: "Claude E2E", token_endpoint_auth_method: "none" },
  });
  expect(registriert.status()).toBe(201);
  const { client_id } = (await registriert.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  // Den Rücksprung zum Client fängt der Test ab; „1e5“ sähe für den Router wie JSON aus und muss unverändert zurückkommen
  let rueckweg = "";
  await page.route("http://127.0.0.1:9/**", (route) => {
    rueckweg = route.request().url();
    return route.fulfill({ body: "ok" });
  });
  const anfrage = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirect,
    state: "1e5",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: ressource.resource,
  });
  // Zulassen verlangt eine frische Anmeldung: Die Sitzung des Durchlaufs ist älter als fünf Minuten
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  await sql`update session set created_at = now() - interval '10 minutes'`;
  await sql.end();
  await go(`/oauth/autorisieren?${anfrage}`);
  await expect(page.getByRole("heading", { level: 1, name: "KI-Assistent verbinden" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Zum Zulassen melde dich bitte erneut an");
  await expect(page.getByRole("button", { name: "Zulassen" })).toHaveCount(0);
  await page.getByRole("button", { name: "Erneut anmelden" }).click();
  await page.waitForURL(/\/login\?weiter=/);
  await page.getByRole("button", { name: "Passwort verwenden" }).click();
  await page.getByLabel("E-Mail").fill(USER.email);
  await page.getByLabel("Passwort").fill(USER.password);
  const seite = page.waitForResponse((antwort) => new URL(antwort.url()).pathname === "/oauth/autorisieren" && antwort.request().isNavigationRequest());
  await page.getByRole("button", { name: "Mit Passwort anmelden" }).click();
  await page.waitForURL(/\/oauth\/autorisieren\?/);
  // Clickjacking (RFC 9700, 4.16): die Zustimmung steht in keinem Rahmen, auch nicht auf derselben Origin
  const kopf = (await seite).headers();
  expect(kopf["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(kopf["x-frame-options"]).toBe("DENY");
  // Den Namen wählt der Client selbst; er steht deshalb nur als „nennt sich …“ da, mit der Warnung davor
  const zustimmung = page.getByRole("main");
  await expect(zustimmung).toContainText("Ein KI-Assistent möchte deine Buchhaltung in Haben lesen. Er nennt sich „Claude E2E“.");
  await expect(zustimmung).toContainText("Nur zulassen, wenn du diese Verbindung gerade selbst eingerichtet hast.");
  await expect(zustimmung).toContainText("127.0.0.1:9");
  expect(await axeVerstoesse(page)).toEqual([]);
  await page.getByRole("button", { name: "Zulassen" }).click();
  await expect.poll(() => rueckweg).toContain("code=");
  const zurueck = new URL(rueckweg);
  expect(zurueck.searchParams.get("state")).toBe("1e5");

  const tokens = await page.request.post(new URL(metadaten.token_endpoint!).pathname, {
    form: { grant_type: "authorization_code", code: zurueck.searchParams.get("code")!, code_verifier: verifier, client_id, redirect_uri: redirect },
  });
  expect(tokens.status()).toBe(200);
  const { access_token } = (await tokens.json()) as { access_token: string };
  const werkzeuge = () =>
    page.request.post("/api/mcp", {
      headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
  expect((await werkzeuge()).status()).toBe(200);

  await go("/einstellungen?bereich=ki");
  const verbindung = page.getByRole("region", { name: "API-Tokens" }).locator(".history-row", { hasText: "Claude E2E" });
  await expect(verbindung).toContainText("OAuth-Verbindung");
  await verbindung.getByRole("button", { name: "Widerrufen" }).click();
  await expect(page.getByRole("dialog")).toContainText("Verbindung „Claude E2E“ widerrufen?");
  await bestaetigen(page, "Widerrufen");
  // Der Knopf „Widerrufen“ steht schon vorher in der Zeile; erst ohne ihn ist der Widerruf gespeichert
  await expect(verbindung.getByRole("button", { name: "Widerrufen" })).toHaveCount(0);
  await expect(verbindung).toContainText("Widerrufen");
  const abgelehnt = await werkzeuge();
  expect(abgelehnt.status()).toBe(401);
  expect(abgelehnt.headers()["www-authenticate"]).toContain("resource_metadata=");
});

test("OAuth-Zustimmung steht auch unter anderer Schreibweise der Adresse in keinem Rahmen (RFC 9700, 4.16)", async () => {
  // Der Router unterscheidet Groß- und Kleinschreibung nicht; dieselbe Seite darf nicht ohne Schutz zu haben sein
  for (const pfad of ["/OAUTH/Autorisieren", "/oauth/AUTORISIEREN", "/oauth/%61utorisieren"]) {
    const antwort = await page.request.get(`${pfad}?response_type=code`, { maxRedirects: 0 });
    expect(antwort.status(), pfad).toBe(200);
    expect(antwort.headers()["content-type"], pfad).toContain("text/html");
    expect(antwort.headers()["content-security-policy"], pfad).toBe("frame-ancestors 'none'");
    expect(antwort.headers()["x-frame-options"], pfad).toBe("DENY");
  }
});

test("CSV-Import: Kontakte, Artikel und Anlagen mit Vorschau, Zuordnung und Dubletten", async ({ browser }) => {
  // Kontakte wie aus Excel unter Windows: Windows-1252, Semikolon; die E-Mail-Spalte heißt anders und wird von Hand zugeordnet
  const kontakte = [
    "Kundennummer;Firmenname;Straße;PLZ;Ort;Land;Elektronische Post;IBAN",
    "K-900;Brückenbau Süd GmbH;Talstraße 3;79098;Freiburg;DE;info@brueckenbau.example;DE89 3704 0044 0532 0130 00",
    "K-901;Nordwerk Software GmbH;Hafenstraße 5;20457;Hamburg;DE;;",
    "K-902;Öko-Druck eG;Feldweg 1;34117;Kassel;Deutschland;druck@oeko.example;DE89 3704 0044 0532 0130 01",
    "K-903;Weinhaus Ahr GmbH;Ahrstraße 7;53474;Bad Neuenahr;276;;",
  ].join("\r\n");
  await go("/kontakte");
  await page.getByRole("link", { name: "CSV importieren" }).click();
  await page.waitForURL(/\/csv-import\?art=kontakte$/);
  await page.getByLabel("CSV-Datei").setInputFiles([{ name: "kontakte.csv", mimeType: "text/csv", buffer: Buffer.from(kontakte, "latin1") }]);
  await page.getByRole("button", { name: "Vorschau" }).click();
  const mapping = page.getByRole("region", { name: "Spalten zuordnen" });
  await expect(mapping).toContainText("Erkannt: Windows-1252, Semikolon, 8 Spalten");
  await expect(mapping.getByLabel("Firma")).toHaveValue("1");
  await expect(mapping.getByLabel("E-Mail")).toHaveValue("");
  await mapping.getByLabel("E-Mail").selectOption({ label: "Elektronische Post" });
  const preview = page.getByRole("region", { name: "Vorschau" });
  await expect(preview).toContainText("2 neu, 1 Dublette, 1 mit Fehlern");
  await expect(preview).toContainText("Gibt es schon (Name nordwerk software gmbh)");
  await expect(preview).toContainText("IBAN: „DE89 3704 0044 0532 0130 01“ ist ungültig");
  // Barrierefreiheit mit Zuordnung und Vorschau, in eigenem Kontext (axe braucht ihn); barrierefreiheit.spec.ts sieht nur das leere Formular
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  await axePage.goto(new URL("/csv-import?art=kontakte", page.url()).toString());
  // Erst nach der Hydration wählen; sonst verwirft React die gewählte Datei
  await axePage.waitForLoadState("networkidle");
  await axePage.getByLabel("CSV-Datei").setInputFiles([{ name: "kontakte.csv", mimeType: "text/csv", buffer: Buffer.from(kontakte, "latin1") }]);
  await axePage.getByRole("button", { name: "Vorschau" }).click();
  await expect(axePage.getByRole("region", { name: "Vorschau" })).toContainText("mit Fehlern");
  const { violations } = await new AxeBuilder({ page: axePage }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await context.close();
  await preview.getByRole("button", { name: "2 Kontakte übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText(
    "2 Kontakte übernommen, 1 Dublette und 1 fehlerhafte Zeile übersprungen.",
  );
  await go("/kontakte");
  const liste = page.getByRole("region", { name: "Kontaktliste" });
  await expect(liste).toContainText("Brückenbau Süd GmbH");
  await expect(liste).toContainText("Weinhaus Ahr GmbH");
  await expect(liste).not.toContainText("Öko-Druck eG");

  // Artikel als UTF-8 mit Komma, Preise deutsch in Anführungszeichen
  const artikel = [
    "Artikelnummer,Bezeichnung,Einheit,Nettopreis,Umsatzsteuer",
    'CSV-1,Datenmigration,Tag,"1.150,00",19',
    'CSV-2,Fachbuch Steuern,Stück,"39,90",7',
  ].join("\n");
  await go("/artikel");
  await page.getByRole("link", { name: "CSV importieren" }).click();
  await page.waitForURL(/art=artikel$/);
  await page.getByLabel("CSV-Datei").setInputFiles([{ name: "artikel.csv", mimeType: "text/csv", buffer: Buffer.from(artikel) }]);
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByRole("region", { name: "Spalten zuordnen" })).toContainText("Erkannt: UTF-8, Komma");
  await page.getByRole("button", { name: "2 Artikel übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText("2 Artikel übernommen.");
  await go("/artikel");
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("Datenmigration");

  // Zwei baugleiche Anlagen mit eigener Inventarnummer, eine wiederholte Nummer und eine Anschaffung nach dem Stichtag
  const anlagen = [
    "Bezeichnung;Art;Anschaffungsdatum;Anschaffungskosten;Nutzungsdauer;Restbuchwert;Inventarnummer",
    `Lastenrad;Fahrzeug;01.04.${YEAR - 2};4.800,00;6;3.600,00;RAD-1`,
    `Lastenrad;Fahrzeug;01.04.${YEAR - 2};4.800,00;6;3.600,00;RAD-2`,
    `Lastenrad;Fahrzeug;01.04.${YEAR - 2};4.800,00;6;3.600,00;RAD-1`,
    `Neuer Monitor;Computer;02.01.${YEAR};900,00;;900,00;`,
  ].join("\n");
  await go("/anlagen");
  await page.getByRole("link", { name: "CSV importieren" }).click();
  await page.waitForURL(/art=anlagen$/);
  await page.getByLabel("Übernahmestichtag").fill(`${YEAR}-01-01`);
  await page.getByLabel("CSV-Datei").setInputFiles([{ name: "anlagen.csv", mimeType: "text/csv", buffer: Buffer.from(anlagen) }]);
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(page.getByRole("region", { name: "Vorschau" })).toContainText("als Beleg mit der Kategorie Anlagegut buchen");
  // Ein anderer Stichtag nach der Vorschau gilt nicht ungesehen: Der Import übernähme sonst andere Werte als gezeigt
  await page.getByLabel("Übernahmestichtag").fill(`${YEAR - 1}-01-01`);
  await expect(page.getByRole("button", { name: "2 Anlagen übernehmen" })).toHaveCount(0);
  await page.getByLabel("Übernahmestichtag").fill(`${YEAR}-01-01`);
  await page.getByRole("button", { name: "Vorschau" }).click();
  await page.getByRole("button", { name: "2 Anlagen übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText("2 Anlagen übernommen, 1 Dublette und 1 fehlerhafte Zeile übersprungen.");
  await go(`/anlagen?jahr=${YEAR}`);
  await expect(page.getByText("Lastenrad").first()).toBeVisible();
});

test("Anlage: Wechsel ohne Neuladen zwischen den baugleichen Anlagen aus dem Import zeigt die Angaben der zweiten, die Meldung der ersten geht (#1839)", async () => {
  // Die Lastenräder aus dem Test davor: in einer Transaktion angelegt, also mit demselben updated_at
  const angaben = page.getByRole("region", { name: "Angaben" });
  const notiz = angaben.getByRole("textbox", { name: "Notiz" });
  const gespeichert = page.getByRole("status").filter({ hasText: "Gespeichert." });
  await go("/anlagen");
  await ueberSchnellsuche(page, "RAD-1", /Lastenrad/);
  await expect(page.getByRole("heading", { level: 1, name: "Lastenrad" })).toBeVisible();
  await expect(notiz).toHaveValue("RAD-1");
  await ueberSchnellsuche(page, "RAD-2", /Lastenrad/);
  await expect(notiz).toHaveValue("RAD-2");

  // Gespeichert, dann zurück: Die Meldung gehört zur anderen Anlage
  await angaben.getByRole("button", { name: "Speichern" }).click();
  await expect(gespeichert).toBeVisible();
  await ueberSchnellsuche(page, "RAD-1", /Lastenrad/);
  await expect(notiz).toHaveValue("RAD-1");
  await expect(gespeichert).toHaveCount(0);
});

test("CSV-Import: Debitoren und Kreditoren aus DATEV-Stammdaten, Vorschlag nur mit Bestätigung (#472)", async ({ browser }) => {
  // Kopf und Spalten wie EXTF_GP_Stamm_*.csv aus sevDesk, Zeilen erfunden; Brückenbau Süd GmbH (K-900) kam im Test davor
  const spalten = readFileSync(new URL("../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/extf-gp-stamm.csv", import.meta.url), "utf-8")
    .split(/\r?\n/)[1]!
    .split(";");
  const zeile = (werte: Record<string, string>) => spalten.map((name) => werte[name] ?? "").join(";");
  const firma = (konto: string, name: string, werte: Record<string, string> = {}) =>
    zeile({ Konto: konto, "Name (Adressatentyp Unternehmen)": name, ...werte });
  const gpStamm = [
    `"EXTF";700;16;"Debitoren/Kreditoren";5;;;;;;1;1;${YEAR}0101;4;;;;;;;;;;;;;;;;;`,
    spalten.join(";"),
    firma("10901", "Nordlicht Design GmbH", { "EU-Mitgliedstaat": "DE", "EU-UStId.": "136695976", Ort: "Kiel" }),
    firma("70901", "Nordlicht Design GmbH", { "EU-Mitgliedstaat": "DE", "EU-UStId.": "136695976" }),
    firma("10902", "Brückenbau Süd", { Kundennummer: "K-900" }),
    firma("8400", "Erlöse 19 %"),
  ].join("\r\n");
  const datei = [{ name: `EXTF_GP_Stamm_${YEAR}.csv`, mimeType: "text/csv", buffer: Buffer.from(gpStamm) }];
  await go("/csv-import?art=kontakte");
  await page.getByLabel("CSV-Datei").setInputFiles(datei);
  await page.getByRole("button", { name: "Vorschau" }).click();
  const preview = page.getByRole("region", { name: "Vorschau" });
  await expect(preview).toContainText("Erkannt: DATEV-Stammdaten Debitoren/Kreditoren, UTF-8");
  await expect(page.getByRole("region", { name: "Spalten zuordnen" })).toHaveCount(0);
  await expect(preview).toContainText("1 neu, 1 Vorschlag zum Bestätigen, 0 Dubletten, 1 mit Fehlern");
  await expect(preview.getByRole("row", { name: /Nordlicht Design GmbH/ })).toContainText("Debitor 10901 und Kreditor 70901: gleiche USt-IdNr. DE136695976");
  await expect(preview).toContainText("Debitor 10902 an „Brückenbau Süd GmbH“ vergeben (gleiche Kundennummer)");
  await expect(preview).toContainText("„8400“ ist kein Personenkonto");
  // Barrierefreiheit mit dem Kontrollkästchen in der Tabelle, in eigenem Kontext wie im Test davor
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  await axePage.goto(new URL("/csv-import?art=kontakte", page.url()).toString());
  // Erst nach der Hydration wählen; sonst verwirft React die gewählte Datei
  await axePage.waitForLoadState("networkidle");
  await axePage.getByLabel("CSV-Datei").setInputFiles(datei);
  await axePage.getByRole("button", { name: "Vorschau" }).click();
  await expect(axePage.getByRole("checkbox", { name: "Bestätigen" })).toBeVisible();
  expect(await axeVerstoesse(axePage)).toEqual([]);
  await context.close();
  // Ohne Bestätigung bleibt der Vorschlag liegen; mit ihr bekommt der vorhandene Kontakt den Debitor
  await preview.getByRole("button", { name: "1 Kontakt übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText(
    "1 Kontakt übernommen, 1 nicht bestätigter Vorschlag und 1 fehlerhafte Zeile übersprungen.",
  );
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(preview).toContainText("0 neu, 1 Vorschlag zum Bestätigen, 1 Dublette, 1 mit Fehlern");
  await expect(preview.getByRole("button", { name: "0 Kontakte übernehmen" })).toBeDisabled();
  await preview.getByRole("checkbox", { name: "Bestätigen" }).check();
  await preview.getByRole("button", { name: "1 Kontakt übernehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "übernommen" })).toHaveText(
    "0 Kontakte übernommen, 1 Personenkonto zugeordnet, 1 Dublette und 1 fehlerhafte Zeile übersprungen.",
  );
  // Ein zweiter Import findet jede Nummer wieder und ändert nichts
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(preview).toContainText("0 neu, 2 Dubletten, 1 mit Fehlern");
  await expect(preview).toContainText("Gibt es schon („Brückenbau Süd GmbH“, Debitor 10902)");
  await expect(preview.getByRole("button", { name: "0 Kontakte übernehmen" })).toBeDisabled();
  await go("/kontakte");
  const liste = page.getByRole("region", { name: "Kontaktliste" });
  await expect(liste.getByText("Nordlicht Design GmbH")).toHaveCount(1);
});

test("CSV-Import: Bei mehr als 200 Zeilen bleibt jeder Vorschlag aus DATEV-Stammdaten bestätigbar (#472)", async () => {
  // 201 vorhandene Kontakte mit Kundennummer, der GP-Stamm nennt sie mit Debitor: jede Zeile ein Vorschlag
  const anzahl = 201;
  const spalten = readFileSync(new URL("../../../packages/import/test-fixtures/sevdesk/buchhaltung-2.0/extf-gp-stamm.csv", import.meta.url), "utf-8")
    .split(/\r?\n/)[1]!
    .split(";");
  const zeile = (werte: Record<string, string>) => spalten.map((name) => werte[name] ?? "").join(";");
  const nummern = Array.from({ length: anzahl }, (_, i) => i + 1);
  const gpStamm = [
    `"EXTF";700;16;"Debitoren/Kreditoren";5;;;;;;1;1;${YEAR}0101;4;;;;;;;;;;;;;;;;;`,
    spalten.join(";"),
    ...nummern.map((n) => zeile({ Konto: String(12000 + n), "Name (Adressatentyp Unternehmen)": `Vorschlagskunde ${n}`, Kundennummer: `VS-${n}` })),
  ].join("\r\n");
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    const angelegt = await sql<{ id: string }[]>`insert into contacts (name, land, kundennummer, is_customer, is_supplier)
      select 'Vorschlagskunde ' || n, 'DE', 'VS-' || n, true, false from generate_series(1, ${anzahl}) as n returning id`;
    try {
      await go("/csv-import?art=kontakte");
      await page.getByLabel("CSV-Datei").setInputFiles([{ name: `EXTF_GP_Stamm_${YEAR}.csv`, mimeType: "text/csv", buffer: Buffer.from(gpStamm) }]);
      await page.getByRole("button", { name: "Vorschau" }).click();
      const preview = page.getByRole("region", { name: "Vorschau" });
      await expect(preview).toContainText(`0 neu, ${anzahl} Vorschläge zum Bestätigen`);
      await expect(preview.getByRole("checkbox", { name: "Bestätigen" })).toHaveCount(anzahl);
    } finally {
      await sql`update contacts set archived_at = now() where id in ${sql(angelegt.map((k) => k.id))}`;
    }
  } finally {
    await sql.end();
  }
});

test("Seiten mit den Daten dieses Abschnitts ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, ["/kontakte", "/rechnungen", "/anlagen", "/einstellungen?bereich=ki"]);
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
