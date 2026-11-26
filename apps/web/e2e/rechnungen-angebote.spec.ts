import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { currentDay, day, firstLink, YEAR } from "./daten.ts";
import { type Durchlauf, databaseUrlFuer } from "./durchlaeufe.ts";
import { statusBleibtSichtbar } from "./kopfzeile.ts";
import { axeVerstoesse, bestaetigen, durchlaufSeite, gehe, kundeWaehlen, ohneAxeVerstoesse, rechnungFestschreiben, ueberSchnellsuche } from "./einrichtung.ts";
import { abzugEinspielen } from "./abzug.ts";
import { sondergebietePruefen, sondergebietsLeistungsortPruefen } from "./sondergebiete.ts";
import { eingabeNachAktion, fokusNachFehlschlag, kurzNacheinanderSpeichern } from "./felder-sperre.ts";

/**
 * Abschnitt von rechnungen (#1742) mit eigenem Server und eigener Datenbank, parallel zu den anderen Abschnitten:
 * Angebote bis zur Abschlags- und Schlussrechnung, Versand per E-Mail mit Anhängen, Leistungen und ihre Abrechnung,
 * Verrechnung, „Bereits bezahlt“, Festschreiben nach dem Speichern, gesperrte Felder beim Speichern (auch der
 * wiederkehrenden Rechnung), Artikel-API, Kopieren und Zeiteinträge auf der Kontaktseite und umsatzsteuerliche
 * Sondergebiete.
 * Beginnt mit dem Abzug nach der Einrichtung mit drei Kunden und einer festgeschriebenen Rechnung in rechnungen.spec.ts
 * (e2e/abzug.ts).
 */

const DURCHLAUF = "rechnungen-angebote" satisfies Durchlauf;

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

test("Angebot festschreiben, annehmen und abrechnen", async () => {
  await go("/angebote/neu");
  await expect(page.getByRole("heading", { name: /^Angebot AN-\d{4}-001$/, level: 1 })).toBeVisible();
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Workshop Softwarearchitektur");
  await page.getByLabel("Text zu Position 1 (optional)").fill("Agenda nach Abstimmung\nzwei Tage vor Ort");
  await page.getByLabel("Menge Position 1").fill("16");
  await page.getByLabel(/Einzelpreis Position 1/).fill("110");
  // Bestellnummer des Kunden (BT-13) als eigenes Feld; geht in die Rechnung aus dem Angebot über (#389)
  await page.getByLabel("Bestellnummer (optional)").fill("4500012345");
  await expect(page.getByLabel("Vorschau des Angebots")).toContainText("Dieses Angebot gilt bis zum");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  const antwort = page.getByRole("region", { name: /Antwort des Kunden/ });
  await expect(antwort).toContainText("Offen", { timeout: 30_000 });
  await expect(page.getByText("2.094,40\u00a0€").first()).toBeVisible();

  // Abschlag aus dem Angebot: Rechnungsart und Angebot vorbelegt, den Betrag trägt man selbst ein; danach wieder verwerfen
  const angebotUrl = page.url();
  await antwort.getByRole("button", { name: "Abschlagsrechnung erstellen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Rechnungsart")).toHaveValue("abschlag");
  await expect(page.getByRole("combobox", { name: /^Angebot\b/ }).locator("option:checked")).toHaveText(/^Angebot AN-\d{4}-001 vom/);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue(/^Abschlag gemäß Angebot AN-\d{4}-001 vom/);
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await bestaetigen(page, "Entwurf löschen");
  await page.waitForURL(/\/rechnungen$/);
  await page.goto(angebotUrl);
  await page.waitForLoadState("networkidle");

  await antwort.getByRole("button", { name: "Rechnung erstellen", exact: true }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Softwarearchitektur");
  // Der Text zur Position geht aus dem Angebot in die Rechnung über
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("Agenda nach Abstimmung\nzwei Tage vor Ort");
  await expect(page.getByLabel(/Hinweis auf der Rechnung/)).toHaveValue(/^Gemäß unserem Angebot AN-\d{4}-001 vom/);
  // Bestellnummer aus dem Angebot, als eigene Auftragsnummer (BT-14) dessen Nummer
  await expect(page.getByLabel("Bestellnummer (optional)")).toHaveValue("4500012345");
  await expect(page.getByLabel("Eigene Auftragsnummer (optional)")).toHaveValue(/^AN-\d{4}-001$/);
  // Den Entwurf wieder verwerfen; das Angebot lässt sich danach erneut abrechnen
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await bestaetigen(page, "Entwurf löschen");
  await page.waitForURL(/\/rechnungen$/);
  await go("/angebote");
  await expect(page.getByRole("link", { name: /AN-\d{4}-001/ })).toContainText("Angenommen");

  // Zum angenommenen Angebot: Auftragsbestätigung und Lieferschein als PDF
  await page.getByRole("link", { name: /AN-\d{4}-001/ }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  for (const name of ["Auftragsbestätigung (PDF)", "Lieferschein (PDF)"]) {
    const response = await page.request.get((await page.getByRole("link", { name }).getAttribute("href"))!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
  }
});

test("Angebot am Handy: Status bleibt beim Scrollen neben dem Titel sichtbar (#356)", async () => {
  const angebot = await firstLink(page, "/angebote", /^\/angebote\/[0-9a-f-]{36}$/);
  expect(angebot).not.toBeNull();
  await statusBleibtSichtbar(page, angebot as string);
});

test("Angebot mit Rabatt, Wahlpositionen und Zahlungsplan: Abschlag per Klick aus dem Plan", async () => {
  await go("/angebote/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Website Relaunch");
  await page.getByLabel(/Einzelpreis Position 1/).fill("10000");
  await page.getByLabel("Rabatt Position 1, Prozent oder Betrag").fill("10 %");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 2").fill("Website Relaunch mit Shop");
  await page.getByLabel(/Einzelpreis Position 2/).fill("12000");
  await page.getByLabel("Art der Position 2").selectOption("alternative");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 3").fill("Schulung");
  await page.getByLabel(/Einzelpreis Position 3/).fill("1000");
  await page.getByLabel("Art der Position 3").selectOption("optional");
  await page.getByLabel("Gesamtrabatt (optional)").fill("500");
  const vorschau = page.getByLabel("Vorschau des Angebots");
  // 10.000 € − 10 % = 9.000 €, Gesamtrabatt 500 € → 8.500 € netto, 10.115 € brutto; Alternative und Schulung zählen nicht
  await expect(vorschau).toContainText("Alternative zu Pos. 1, nicht in der Angebotssumme");
  await expect(vorschau).toContainText("abzüglich 10 % Rabatt (1.000,00 €)");
  await expect(vorschau).toContainText("10.115,00 €");

  const plan = page.getByRole("region", { name: "Zahlungsplan" });
  await plan.getByLabel("Vorlage übernehmen").selectOption("30/40/30");
  await expect(plan.getByText("2.550,00 € netto · 3.034,50 € brutto").first()).toBeVisible();
  await expect(plan.getByText("3.400,00 € netto · 4.046,00 € brutto")).toBeVisible();
  await expect(vorschau.locator('[data-teil="hinweise"]')).toContainText("2. Abschlag");
  await plan.getByLabel("Zahlungsplan auch in der Auftragsbestätigung").check();
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByRole("region", { name: /Antwort des Kunden/ })).toContainText("Offen", { timeout: 30_000 });

  // Auswahl des Kunden: Variante mit Shop und die Schulung
  const auswahl = page.getByRole("region", { name: "Auswahl des Kunden" });
  await auswahl.getByLabel(/Pos\. 2 Website Relaunch mit Shop/).check();
  await auswahl.getByLabel(/Pos\. 3 Schulung/).check();

  const zahlungsplan = page.getByRole("region", { name: "Zahlungsplan" });
  await expect(zahlungsplan).toContainText("Abgerechnet 0,00 € von 10.115,00 €");
  await zahlungsplan.getByRole("button", { name: "Abschlagsrechnung erstellen: Zahlung 1" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Rechnungsart")).toHaveValue("abschlag");
  // 30 % des Auftrags nach der Auswahl: 12.000 € + 1.000 € − 500 € = 12.500 € netto → 3.750 €
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue(/^1\. Anzahlung 30 % gemäß Angebot AN-\d{4}-002 vom/);
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("3.750,00");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await expect(zahlungsplan).toContainText("Entwurf");
  await expect(zahlungsplan).toContainText("Abgerechnet 0,00 € von 14.875,00 €");
  const response = await page.request.get((await page.getByRole("link", { name: "Auftragsbestätigung (PDF)" }).getAttribute("href"))!);
  expect(response.status()).toBe(200);

  // Den Abschlag wieder verwerfen, damit Buchungen und Konten der übrigen Schritte unverändert bleiben
  await zahlungsplan.getByRole("link", { name: "Abschlagsrechnung (Entwurf)" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Entwurf löschen" }).click();
  await bestaetigen(page, "Entwurf löschen");
  await page.waitForURL(/\/rechnungen$/);
});

test("Rechnung mit Positions- und Gesamtrabatt in der Vorschau", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("10");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100");
  await page.getByLabel("Rabatt Position 1, Prozent oder Betrag").fill("50");
  await page.getByLabel("Gesamtrabatt (optional)").fill("10 %");
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  // 1.000 € − 50 € = 950 €, abzüglich 10 % = 855 € netto, 1.017,45 € brutto
  await expect(vorschau).toContainText("abzüglich 50,00 € Rabatt");
  await expect(vorschau).toContainText("Gesamtrabatt 10 %");
  await expect(vorschau).toContainText("1.017,45 €");
  await page.getByLabel("Gesamtrabatt (optional)").fill("2000");
  await expect(page.getByText("Der Gesamtrabatt ist höher als die Summe der Positionen")).toBeVisible();
  // „Entwurf speichern“ speichert nicht, sondern setzt den Fokus auf den Rabatt (DESIGN.md, Gesperrte Knöpfe)
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await expect(page.getByLabel("Gesamtrabatt (optional)")).toBeFocused();
  await expect(page).toHaveURL(/\/rechnungen\/neu$/);
});

test("Rechnung per E-Mail: Zugang einrichten, Vorlage, Fehler im Protokoll", async () => {
  await go("/einstellungen?bereich=email");
  const zugang = page.getByRole("form", { name: "E-Mail-Versand" });
  // Port 1 auf dem eigenen Rechner: kein Mailserver, der Versand scheitert sofort und sichtbar
  await zugang.getByLabel("SMTP-Server", { exact: true }).fill("127.0.0.1");
  await zugang.getByLabel("Port", { exact: true }).fill("1");
  await zugang.getByLabel("Benutzername", { exact: true }).fill("max");
  await zugang.getByLabel("Passwort", { exact: true }).fill("geheim");
  await zugang.getByLabel("Absender", { exact: true }).fill("rechnung@mustermann.example");
  // Leer gelassen gilt der Firmenname; die Vorgabe zeigt ihn an
  await expect(zugang.getByLabel("Absendername")).toHaveAttribute("placeholder", /Mustermann IT/);
  await zugang.getByLabel("Absendername").fill("Max Mustermann IT");
  await zugang.getByLabel("Erinnerungen an", { exact: true }).fill("max@mustermann.example");
  await zugang.getByRole("button", { name: "Speichern" }).click();
  await expect(zugang.getByRole("status")).toHaveText("E-Mail-Zugang gespeichert.");
  await expect(zugang.getByLabel("Absendername")).toHaveValue("Max Mustermann IT");

  const rechnung = await firstLink(page, "/rechnungen", /^\/rechnungen\/[0-9a-f-]{36}$/);
  await go(rechnung!);
  const bereich = page.getByRole("region", { name: "Per E-Mail" });
  await bereich.getByRole("button", { name: "Rechnung senden" }).click();
  const formular = bereich.getByRole("form", { name: "Rechnung per E-Mail senden" });
  await expect(formular.getByLabel("Betreff", { exact: true })).toHaveValue(/^Rechnung \d{4}-\d{3} von Mustermann IT/);
  await expect(formular.getByText(/Anhang: Rechnung-\d{4}-\d{3}\.pdf/)).toBeVisible();
  await formular.getByLabel("An", { exact: true }).fill("buchhaltung@nordwerk.example");
  await formular.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(formular.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText("Fehlgeschlagen");
});

/** Kleinste Datei, die Haben am Inhalt als PDF erkennt */
const attachmentPdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

test("Anhänge an der Rechnung: PDF hochladen, entfernen, festschreiben und beim Versand auswählen", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Alpenblick Media AG · München");
  await page.getByLabel("Beschreibung Position 1").fill("Beratung mit Stundennachweis");
  await page.getByLabel("Menge Position 1").fill("8");
  await page.getByLabel(/Einzelpreis Position 1/).fill("120,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  const anhaenge = page.getByRole("region", { name: "Anhänge" });
  const auswahl = page.getByLabel("PDF-Anhänge auswählen");
  await auswahl.setInputFiles([
    { name: "stundenzettel.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Stundenzettel") },
    { name: "abnahme.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Abnahme") },
  ]);
  await expect(anhaenge.getByText("stundenzettel.pdf: angehängt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "abnahme.pdf", exact: true })).toBeVisible();
  // Nur PDF, am Inhalt erkannt: ein Bild mit der Endung .pdf wird abgelehnt
  await auswahl.setInputFiles([{ name: "foto.pdf", mimeType: "application/pdf", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }]);
  await expect(anhaenge.getByText("foto.pdf: Als Anhang sind nur PDF-Dateien erlaubt.")).toBeVisible();
  // Die Datei ist danach aus Haben weg, und der Knopf steht am Handy eng neben „Herunterladen“: erst nachfragen
  await anhaenge.getByRole("button", { name: "abnahme.pdf entfernen" }).click();
  const anhangRueckfrage = page.getByRole("dialog", { name: "abnahme.pdf entfernen?" });
  await expect(anhangRueckfrage).toContainText("aus Haben gelöscht");
  await anhangRueckfrage.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(anhaenge.getByRole("link", { name: "abnahme.pdf", exact: true })).toBeVisible();
  await anhaenge.getByRole("button", { name: "abnahme.pdf entfernen" }).click();
  await bestaetigen(page, "Entfernen");
  await expect(anhaenge.getByText("abnahme.pdf: entfernt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "abnahme.pdf", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Rechnung ", "").trim();
  await expect(anhaenge).toContainText("Mit der Rechnung festgeschrieben.");
  await expect(anhaenge.getByRole("button", { name: /entfernen/ })).toHaveCount(0);
  const download = await page.request.get((await anhaenge.getByRole("link", { name: "stundenzettel.pdf herunterladen" }).getAttribute("href"))!);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect((await download.body()).toString()).toContain("Stundenzettel");

  // Der Zugang aus dem Test davor zeigt auf einen Port ohne Mailserver: der Versand scheitert, das Protokoll nennt die Dateien
  const bereich = page.getByRole("region", { name: "Per E-Mail" });
  await bereich.getByRole("button", { name: "Rechnung senden" }).click();
  const formular = bereich.getByRole("form", { name: "Rechnung per E-Mail senden" });
  const mitsenden = formular.getByRole("group", { name: "Zusätzliche Anhänge mitsenden" }).getByRole("checkbox", { name: "stundenzettel.pdf" });
  await expect(mitsenden).toBeChecked();
  await formular.getByLabel("An", { exact: true }).fill("buchhaltung@alpenblick.example");
  await formular.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(formular.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText(`Anhang: Rechnung-${number}.pdf, stundenzettel.pdf`);

  // Abgewählt geht nur die Rechnung mit
  // Kein Versand ging durch, der Knopf heißt also weiter „Rechnung senden“
  await page.getByRole("region", { name: "Per E-Mail" }).getByRole("button", { name: "Rechnung senden" }).click();
  const zweites = page.getByRole("form", { name: "Rechnung per E-Mail senden" });
  await zweites.getByRole("checkbox", { name: "stundenzettel.pdf" }).uncheck();
  await zweites.getByLabel("An", { exact: true }).fill("buchhaltung@alpenblick.example");
  await zweites.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(zweites.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText(new RegExp(`Anhang: Rechnung-${number}\\.pdf(?!, )`));
});

test("Anhänge am Angebot: PDF im Entwurf hochladen, festschreiben, beim Versand auswählen, beim Kopieren übernehmen (#415)", async () => {
  await go("/angebote/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Beschreibung Position 1").fill("Wartungsvertrag");
  await page.getByLabel("Menge Position 1").fill("12");
  await page.getByLabel(/Einzelpreis Position 1/).fill("150,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  const anhaenge = page.getByRole("region", { name: "Anhänge" });
  const auswahl = page.getByLabel("PDF-Anhänge auswählen");
  await auswahl.setInputFiles([
    { name: "AGB.pdf", mimeType: "application/pdf", buffer: attachmentPdf("AGB") },
    { name: "intern.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Intern") },
  ]);
  await expect(anhaenge.getByText("AGB.pdf: angehängt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "intern.pdf", exact: true })).toBeVisible();
  // Dieselbe Datei ein zweites Mal hängt nicht doppelt
  await auswahl.setInputFiles([{ name: "AGB-Kopie.pdf", mimeType: "application/pdf", buffer: attachmentPdf("AGB") }]);
  await expect(anhaenge.getByText("AGB-Kopie.pdf: hängt schon an diesem Angebot.")).toBeVisible();
  await anhaenge.getByRole("button", { name: "intern.pdf entfernen" }).click();
  await bestaetigen(page, "Entfernen");
  await expect(anhaenge.getByText("intern.pdf: entfernt.")).toBeVisible();
  await expect(anhaenge.getByRole("link", { name: "intern.pdf", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByRole("region", { name: /Antwort des Kunden/ })).toContainText("Offen", { timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Angebot ", "").trim();
  await expect(anhaenge).toContainText("Mit dem Angebot festgeschrieben.");
  await expect(anhaenge.getByRole("button", { name: /entfernen/ })).toHaveCount(0);
  const download = await page.request.get((await anhaenge.getByRole("link", { name: "AGB.pdf herunterladen" }).getAttribute("href"))!);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect((await download.body()).toString()).toContain("AGB");

  // Der Zugang aus den Tests davor zeigt auf einen Port ohne Mailserver: der Versand scheitert, das Protokoll nennt die Dateien
  const bereich = page.getByRole("region", { name: "Per E-Mail" });
  await bereich.getByRole("button", { name: "Angebot senden" }).click();
  const formular = bereich.getByRole("form", { name: "Angebot per E-Mail senden" });
  await expect(formular.getByRole("group", { name: "Zusätzliche Anhänge mitsenden" }).getByRole("checkbox", { name: "AGB.pdf" })).toBeChecked();
  await formular.getByLabel("An", { exact: true }).fill("einkauf@rheinpixel.example");
  await formular.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(formular.getByRole("alert")).toContainText("Nicht gesendet");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Per E-Mail" })).toContainText(`Anhang: Angebot-${number}.pdf, AGB.pdf`);

  // Kopieren legt einen Entwurf mit denselben Anhängen an, die sich dort wieder ändern lassen
  const original = page.url();
  await page.getByRole("button", { name: "Kopieren" }).click();
  await page.waitForURL((url) => /angebote\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== original);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Anhänge" }).getByRole("button", { name: "AGB.pdf entfernen" })).toBeVisible();
});

test("Standardanhänge: AGB in den Einstellungen, jedes neue Angebot hat sie, im Entwurf abwählbar (#415)", async () => {
  await go("/einstellungen?bereich=rechnungen");
  const standard = page.getByRole("region", { name: "Standardanhänge für Angebote" });
  await standard.getByLabel("PDF-Anhänge auswählen").setInputFiles([
    { name: "AGB.pdf", mimeType: "application/pdf", buffer: attachmentPdf("AGB Stand 2026") },
    { name: "Widerrufsbelehrung.pdf", mimeType: "application/pdf", buffer: attachmentPdf("Widerruf") },
  ]);
  await expect(standard.getByText("AGB.pdf: angehängt.")).toBeVisible();
  await expect(standard.getByRole("link", { name: "Widerrufsbelehrung.pdf", exact: true })).toBeVisible();

  await go("/angebote/neu");
  await kundeWaehlen(page, "Alpenblick Media AG · München");
  await page.getByLabel("Beschreibung Position 1").fill("Konzeption Website");
  await page.getByLabel("Menge Position 1").fill("10");
  await page.getByLabel(/Einzelpreis Position 1/).fill("120,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const anhaenge = page.getByRole("region", { name: "Anhänge" });
  await expect(anhaenge.getByRole("link", { name: "AGB.pdf", exact: true })).toBeVisible();
  // Für dieses Angebot ohne Widerrufsbelehrung; die Einstellung bleibt
  await anhaenge.getByRole("button", { name: "Widerrufsbelehrung.pdf entfernen" }).click();
  await bestaetigen(page, "Entfernen");
  await expect(anhaenge.getByText("Widerrufsbelehrung.pdf: entfernt.")).toBeVisible();

  // Die Standardanhänge wieder herausnehmen, damit die folgenden Tests Angebote ohne sie anlegen
  await go("/einstellungen?bereich=rechnungen");
  for (const name of ["AGB.pdf", "Widerrufsbelehrung.pdf"]) {
    await standard.getByRole("button", { name: `${name} entfernen` }).click();
    // Die Datei hängt noch an Angeboten: Die Rückfrage darf nicht behaupten, sie sei dann weg
    await expect(page.getByRole("dialog", { name: `${name} entfernen?` })).toContainText("Neue Angebote");
    await expect(page.getByRole("dialog", { name: `${name} entfernen?` })).not.toContainText("gelöscht");
    await bestaetigen(page, "Entfernen");
    await expect(standard.getByText(`${name}: entfernt.`)).toBeVisible();
  }
  await expect(standard).toContainText("Keine Standardanhänge.");
});

test("Abschlagsrechnung festschreiben und Schlussrechnung vorbereiten", async () => {
  await go("/rechnungen/neu");
  await page.getByRole("combobox", { name: /^Rechnungsart/ }).selectOption("abschlag");
  await expect(page.getByRole("heading", { name: /^Abschlagsrechnung \d{4}-\d{3}$/, level: 1 })).toBeVisible();
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Beschreibung Position 1").fill("1. Abschlag Relaunch Website");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("2000");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Abschlagsrechnung ", "").trim();
  const lieferschein = await page.request.get((await page.getByRole("link", { name: "Lieferschein" }).getAttribute("href"))!);
  expect(lieferschein.headers()["content-type"]).toBe("application/pdf");

  await page.getByRole("link", { name: "Schlussrechnung erstellen" }).click();
  await page.waitForURL(/rechnungen\/neu\?schluss=/);
  await expect(page.getByRole("heading", { name: /^Schlussrechnung /, level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue("Rheinpixel GmbH · Köln");
  const abzug = page.getByRole("checkbox", { name: new RegExp(`Abschlagsrechnung ${number}`) });
  await expect(abzug).toBeChecked();
  await page.getByLabel("Beschreibung Position 1").fill("Relaunch Website gesamt");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("5000");
  const vorschau = page.getByLabel("Vorschau der Rechnung");
  await expect(vorschau).toContainText(`Abzüglich Abschlagsrechnung ${number}`);
  // 5.000 − 2.000 netto, zuzüglich 19 %
  await expect(vorschau).toContainText("3.570,00");
  await abzug.uncheck();
  await expect(vorschau).not.toContainText("Abzüglich Abschlagsrechnung");
});

test("Leistungen: Eintrag mit eigenem Stundensatz anlegen, ändern, nach Kunde filtern und löschen (#417)", async () => {
  await go("/leistungen");
  // Die Seite heißt Zeiteinträge, die Adresse bleibt /leistungen (#1253)
  await expect(page.getByRole("heading", { level: 1, name: "Zeiteinträge" })).toBeVisible();
  await expect(page).toHaveTitle("Zeiteinträge · Haben");
  await expect(page.getByText("Hier stehen deine Zeiteinträge je Kunde.")).toBeVisible();
  await page.locator(".page-head").getByRole("button", { name: "Neuer Eintrag" }).click();
  const neu = page.getByRole("form", { name: "Neuer Eintrag" });
  await neu.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
  await neu.getByLabel("Dauer", { exact: true }).fill("1:30");
  await neu.getByLabel(/Stundensatz/).fill("95");
  await neu.getByLabel(/Tätigkeit/).fill("Konzept Datenmodell");
  await neu.getByLabel(/Projekt/).fill("Relaunch Shop");
  await neu.getByLabel(/Abrechenbare Dauer/).fill("1:00");
  await neu.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Eintrag angelegt.")).toBeVisible();

  const liste = page.getByRole("region", { name: "Leistungsliste" });
  await expect(liste).toContainText("Rheinpixel GmbH");
  await expect(liste).toContainText("Konzept Datenmodell");
  await expect(liste).toContainText("1:30 Std.");
  await expect(liste).toContainText("Relaunch Shop");
  // Berechnet wird die abrechenbare Stunde, nicht die erfassten 90 Minuten
  await expect(liste).toContainText("abr. 1:00");
  await expect(liste.getByTitle("abrechenbar")).toHaveText("abr.");
  await expect(liste).toContainText("95,00");
  await expect(liste).not.toContainText("142,50");
  // Kopf und Zeilen teilen das Raster: „Betrag“ steht rechtsbündig über dem Betrag, nicht über den Knöpfen (#1547)
  const kopfBetrag = await liste.locator(".table-row.head > div", { hasText: "Betrag" }).boundingBox();
  const zelleBetrag = await liste.locator(".table-row:not(.head) > .num").nth(2).boundingBox();
  expect(Math.round(kopfBetrag!.x + kopfBetrag!.width)).toBe(Math.round(zelleBetrag!.x + zelleBetrag!.width));
  // Mit Eintrag: keine axe-Verstöße, am Handy nicht breiter als der Bildschirm
  await ohneAxeVerstoesse(page, ["/leistungen"]);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Dauer unlesbar: Meldung, nichts gespeichert
  await liste.getByRole("button", { name: /bearbeiten/ }).click();
  const aendern = page.getByRole("form", { name: "Eintrag ändern" });
  await aendern.getByLabel("Dauer", { exact: true }).fill("abc");
  await aendern.getByRole("button", { name: "Speichern" }).click();
  await expect(aendern.getByRole("alert")).toContainText("Die Dauer ist nicht lesbar");
  await aendern.getByLabel("Dauer", { exact: true }).fill("2");
  await aendern.getByLabel(/Abrechenbare Dauer/).fill("");
  await aendern.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Eintrag gespeichert.")).toBeVisible();
  await expect(liste).toContainText("2:00 Std.");
  await expect(liste).toContainText("190,00");

  // Der Filter nach Kunde blendet fremde Einträge aus
  await page.getByRole("group", { name: "Filter" }).getByLabel("Kunde").selectOption({ label: "Nordwerk Software GmbH" });
  await expect(liste).toContainText("Keine Einträge für diesen Filter.");
  await page.getByRole("group", { name: "Filter" }).getByLabel("Kunde").selectOption({ label: "Alle Kunden" });
  await expect(liste).toContainText("Konzept Datenmodell");

  // Nicht abrechenbar: erfasst, aber ohne Betrag
  await liste.getByRole("button", { name: /bearbeiten/ }).click();
  await page
    .getByRole("form", { name: "Eintrag ändern" })
    .getByLabel(/Nicht abrechenbar/)
    .check();
  await page.getByRole("form", { name: "Eintrag ändern" }).getByRole("button", { name: "Speichern" }).click();
  await expect(liste).toContainText("nicht abrechenbar");
  await expect(liste).toContainText("davon abrechenbar 0:00 Std. mit 0,00");

  // Löschen fragt vorher nach; Abbrechen löscht nichts
  await liste.getByRole("button", { name: /löschen/ }).click();
  const dialog = page.getByRole("dialog", { name: "Eintrag löschen?" });
  await expect(dialog).toContainText("Rheinpixel GmbH");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(liste).toContainText("Konzept Datenmodell");
  await liste.getByRole("button", { name: /löschen/ }).click();
  await page.getByRole("dialog", { name: "Eintrag löschen?" }).getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByText("Eintrag gelöscht.")).toBeVisible();
  await expect(page.getByText("Hier stehen deine Zeiteinträge je Kunde.")).toBeVisible();
});

test("Leistungen abrechnen: Filter und Kästchen, Vorschau, Rechnungsentwurf nur mit den gewählten Einträgen, nicht zweimal abrechenbar (#417, #1933)", async () => {
  await go("/leistungen");
  const eintraege: [string, string, string, boolean][] = [
    ["1:30", "Konzept Datenmodell", "Relaunch Shop", false],
    ["2:00", "Entwicklung Warenkorb", "Relaunch Shop", false],
    ["1:00", "Rufbereitschaft", "Wartung", false],
    ["0:45", "Interne Abstimmung", "", true],
  ];
  for (const [dauer, text, projekt, intern] of eintraege) {
    await page.locator(".page-head").getByRole("button", { name: "Neuer Eintrag" }).click();
    const neu = page.getByRole("form", { name: "Neuer Eintrag" });
    await neu.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
    await neu.getByLabel("Dauer", { exact: true }).fill(dauer);
    await neu.getByLabel(/Stundensatz/).fill("95");
    await neu.getByLabel(/Tätigkeit/).fill(text);
    if (projekt) await neu.getByLabel(/Projekt/).fill(projekt);
    if (intern) await neu.getByLabel(/Nicht abrechenbar/).check();
    await neu.getByRole("button", { name: "Anlegen" }).click();
    await expect(page.getByText("Eintrag angelegt.")).toBeVisible();
  }

  const liste = page.getByRole("region", { name: "Leistungsliste" });
  const filter = page.getByRole("group", { name: "Filter" });
  const zeile = (text: string) => liste.locator(".table-row").filter({ hasText: text });

  // Projekt und Tätigkeit filtern ohne Rücksicht auf Groß- und Kleinschreibung und stehen in der Adresse
  await filter.getByLabel("Projekt").fill("WARTUNG");
  await expect(liste).toContainText("Rufbereitschaft");
  await expect(liste).not.toContainText("Konzept Datenmodell");
  await expect(page).toHaveURL(/projekt=WARTUNG/);
  await filter.getByLabel("Projekt").fill("");
  await filter.getByLabel("Tätigkeit").fill("warenkorb");
  await expect(liste).not.toContainText("Rufbereitschaft");
  await expect(liste).toContainText("Entwicklung Warenkorb");
  await filter.getByLabel("Tätigkeit").fill("");
  await expect(liste).toContainText("Rufbereitschaft");

  // Abrechnen verlangt den Kunden im Filter; der Stand ist dann fest „offen“
  await page.getByRole("button", { name: "Abrechnen", exact: true }).click();
  const abrechnen = page.getByRole("form", { name: "Leistungen abrechnen" });
  await expect(abrechnen).toContainText("Wähle in der Liste unten den Kunden");
  await expect(filter.getByLabel("Stand")).toHaveValue("offen");
  await expect(filter.getByLabel("Stand")).toBeDisabled();
  await expect(abrechnen.getByRole("button", { name: "Rechnungsentwurf anlegen" })).toBeDisabled();
  await filter.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
  // Die offenen, abrechenbaren Einträge sind gewählt, der interne fehlt: 4,5 Std. zu 95,00 € = 427,50 €
  await expect(liste.getByRole("checkbox", { name: /Eintrag vom .* abrechnen/ })).toHaveCount(3);
  await expect(liste.getByText("Interne Abstimmung")).toHaveCount(0);
  await expect(abrechnen).toContainText("3 Einträge gewählt, 4:30 Std., zusammen 427,50");

  // Der Filter grenzt ein und wählt wieder alle; ein abgehaktes Kästchen nimmt den Eintrag heraus
  await filter.getByLabel("Projekt").fill("shop");
  await expect(liste.getByRole("checkbox", { name: /Eintrag vom .* abrechnen/ })).toHaveCount(2);
  await expect(abrechnen).toContainText("2 Einträge gewählt, 3:30 Std., zusammen 332,50");
  await zeile("Entwicklung Warenkorb")
    .getByRole("checkbox", { name: /abrechnen/ })
    .uncheck();
  await expect(abrechnen).toContainText("1 Eintrag gewählt, 1:30 Std., zusammen 142,50");
  await abrechnen.getByRole("button", { name: "Rechnungsentwurf anlegen" }).click();

  // Der Entwurf zeigt, aus welchen Einträgen er entstanden ist: nur aus dem gewählten
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}/);
  const nachweis = page.getByRole("region", { name: "Enthaltene Leistungen" });
  await expect(nachweis).toContainText("Konzept Datenmodell");
  await expect(nachweis).not.toContainText("Entwicklung Warenkorb");
  await expect(nachweis).not.toContainText("Rufbereitschaft");
  await expect(nachweis).not.toContainText("Interne Abstimmung");

  // Zurück in der Liste: der abgerechnete Eintrag ist verknüpft und nicht mehr änderbar, die übrigen bleiben offen
  await go("/leistungen");
  await expect(liste.getByRole("link", { name: "Rechnungsentwurf" })).toHaveCount(1);
  await expect(zeile("Konzept Datenmodell").getByRole("button", { name: /bearbeiten/ })).toBeDisabled();
  await expect(zeile("Konzept Datenmodell").getByRole("button", { name: /löschen/ })).toBeDisabled();
  await expect(zeile("Entwicklung Warenkorb").getByRole("button", { name: /bearbeiten/ })).toBeEnabled();
  await expect(zeile("Interne Abstimmung").getByRole("button", { name: /bearbeiten/ })).toBeEnabled();
  await filter.getByLabel("Stand").selectOption("abgerechnet");
  await expect(liste).toContainText("Konzept Datenmodell");
  await expect(liste).not.toContainText("Interne Abstimmung");

  // Das zweite Abrechnen bietet nur noch die offenen an; danach findet ein drittes nichts mehr
  await page.getByRole("button", { name: "Abrechnen", exact: true }).click();
  await filter.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
  const zweites = page.getByRole("form", { name: "Leistungen abrechnen" });
  await expect(liste.getByRole("checkbox", { name: /abrechnen/ })).toHaveCount(2);
  await expect(zweites).toContainText("2 Einträge gewählt, 3:00 Std., zusammen 285,00");
  await zweites.getByRole("button", { name: "Rechnungsentwurf anlegen" }).click();
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}/);
  await go("/leistungen");
  await page.getByRole("button", { name: "Abrechnen", exact: true }).click();
  await filter.getByLabel("Kunde").selectOption({ label: "Rheinpixel GmbH" });
  const noch = page.getByRole("form", { name: "Leistungen abrechnen" });
  await expect(noch).toContainText("keine offenen, abrechenbaren Einträge");
  await expect(liste.getByRole("checkbox")).toHaveCount(0);
  await expect(noch.getByRole("button", { name: "Rechnungsentwurf anlegen" })).toBeDisabled();
});

test("Verrechnung: Korrektur gegen die Rechnung ausgleichen, Rest sinkt, Aufheben stellt ihn her", async () => {
  // Rechnung 100,00 EUR netto, also 119,00 EUR brutto; die Korrektur mindert um 20,00 EUR netto
  await rechnungFestschreiben(page, {
    customer: "Rheinpixel GmbH · Köln",
    date: day(-5),
    lines: [["Verrechnung Beratung", "1", "100,00"]],
    gross: "119,00",
  });
  const rechnungUrl = page.url();

  // Korrektur anlegen und auf 20,00 EUR netto kürzen, dann festschreiben
  await page.getByRole("button", { name: "Rechnungskorrektur anlegen" }).click();
  // Die Korrektur ist eine eigene Rechnung: auf ihre Adresse warten, nicht auf das Muster, das die offene schon erfüllt
  await page.waitForURL((url) => /\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname) && url.toString() !== rechnungUrl);
  const korrekturUrl = page.url();
  await page.getByLabel("Einzelpreis Position 1").fill("-20,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  // Das Neuladen setzt den Editor mit den gespeicherten Werten neu auf; erst danach die Rückfrage öffnen.
  await expect(page.getByText("Entwurf gespeichert.", { exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Einzelpreis Position 1")).toHaveValue("-20,00");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  // Zurück auf die Rechnung: der Rest steht bei 119,00 EUR, die Verrechnung fehlt noch
  await page.goto(rechnungUrl);
  await page.waitForLoadState("networkidle");
  const karte = page.getByRole("region", { name: "Verrechnung" });
  await expect(karte).toContainText(/offen sind noch\s*119,00\s*€/);
  await karte.getByRole("button", { name: "Mit der Korrektur verrechnen" }).click();

  // Das Formular ist offen: Betrag und Tag sind vorbelegt, der Grund ist Pflicht
  const formular = karte.locator("form");
  await formular.getByLabel("Gegenbeleg").selectOption({ index: 1 });
  await expect(formular.getByLabel("Betrag")).toHaveValue("23,80");
  // Der Tag der Korrektur kommt vom Server: currentDay() statt day(0), das beim Laden der Datei feststeht und nach Mitternacht hinter ihm läge
  await formular.getByLabel("Tag der Aufrechnung").fill(currentDay());
  await formular.getByLabel("Grund").fill("Korrektur TE-1");
  await expect(await axeVerstoesse(page)).toEqual([]);
  await formular.getByRole("button", { name: "Verrechnen" }).click();

  // Der Belegbetrag bleibt, der offene Rest sinkt um die verrechneten 23,80 EUR
  await expect(karte).toContainText(/offen sind noch\s*95,20\s*€/);
  await expect(karte).toContainText("Korrektur TE-1");
  await expect(karte).toContainText(/23,80\s*€/);

  // Die Buchung der Verrechnung führt im Journal auf die Rechnung, nicht auf die Bank (#877)
  await go("/buchungen");
  const verrechnungslinks = page.locator("tr").filter({ hasText: "Verrechnung" }).getByRole("link", { name: "Verrechnung" });
  await expect(verrechnungslinks).toHaveCount(2);
  const journalziele = (await verrechnungslinks.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))).sort();
  expect(journalziele).toEqual([new URL(rechnungUrl).pathname, new URL(korrekturUrl).pathname].sort());

  // Dieselbe Herkunft führt auch auf dem Kontenblatt der Forderungen auf Rechnung und Korrektur (#877)
  await go(`/konten/1400?jahr=${YEAR}&zeitraum=jahr`);
  const kontenlinks = page.locator("tr").filter({ hasText: "Verrechnung" }).getByRole("link", { name: "Verrechnung" });
  await expect(kontenlinks).toHaveCount(2);
  const kontenziele = (await kontenlinks.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))).sort();
  expect(kontenziele).toEqual([new URL(rechnungUrl).pathname, new URL(korrekturUrl).pathname].sort());

  // Nach dem Neuladen steht die Verrechnung weiterhin
  await page.goto(rechnungUrl);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Verrechnung" })).toContainText(/offen sind noch\s*95,20\s*€/);

  // Aufheben: der Rest ist wieder 119,00 EUR, die Zeile verschwindet
  await page.getByRole("region", { name: "Verrechnung" }).getByRole("button", { name: "aufheben" }).click();
  await page.getByLabel("Tag der Aufhebung").fill(currentDay());
  await page.getByRole("button", { name: "Aufheben", exact: true }).click();
  await expect(page.getByRole("region", { name: "Verrechnung" })).toContainText(/offen sind noch\s*119,00\s*€/);
  await expect(page.getByRole("region", { name: "Verrechnung" }).getByText("Korrektur TE-1")).toHaveCount(0);
});

test("Bereits bezahlt speichert Zahlungsdienst und Datum und lässt die Rechnung offen (#1056)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Marktplatzbestellung");
  await page.getByLabel(/Einzelpreis Position 1/).fill("49,99");
  const zahlungsart = page.getByLabel("Zahlungsart", { exact: true });
  await zahlungsart.selectOption("bereits_bezahlt");
  await expect(page.getByLabel("Zahlungsziel in Tagen")).toHaveCount(0);
  const vorschau = page.getByRole("button", { name: "Vorschau", exact: true });
  const vorschauDialog = page.getByRole("dialog", { name: "Vorschau" });
  await vorschau.click();
  await expect(vorschauDialog.getByText("Gib für die Vorschau an, wann und wie die Rechnung bezahlt wurde.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Bezahlt über").fill("eBay");
  const paidOn = day(-1);
  await page.getByLabel("Bezahlt am").fill(paidOn);
  await vorschau.click();
  await expect(vorschauDialog.getByLabel("Vorschau der Rechnung")).toContainText("über eBay bezahlt");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(zahlungsart).toHaveValue("bereits_bezahlt");
  await expect(page.getByLabel("Bezahlt über")).toHaveValue("eBay");
  await expect(page.getByLabel("Bezahlt am")).toHaveValue(paidOn);
  await page.getByRole("button", { name: "Festschreiben", exact: true }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByRole("region", { name: "Angaben" }).getByText("eBay")).toBeVisible();
  await expect(page.getByRole("region", { name: "Angaben" }).getByText("Fällig", { exact: true })).toHaveCount(0);
});

test("Festschreiben direkt nach „Entwurf speichern“: erst nach dem Neuladen, der Dialog bleibt offen", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Gleich festschreiben");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await page.waitForURL(/\/rechnungen\/[0-9a-f-]{36}$/);
  // Neu laden, damit sicher der gespeicherte Entwurf im Editor steht und nicht mehr das Formular von „/rechnungen/neu“
  await page.reload({ waitUntil: "networkidle" });
  const id = new URL(page.url()).pathname.split("/").pop()!;

  // Nach dem Speichern lädt die Seite den Entwurf neu und baut den Editor mit dem neuen Stand neu auf. Kommt die Antwort
  // spät (langsamer Server, CI), darf „Festschreiben“ bis dahin nicht gehen: sonst verwirft der Neuaufbau den offenen Dialog
  let neuGeladen = false;
  const ladeEntwurf = (url: URL) => url.pathname.startsWith("/_serverFn/") && decodeURIComponent(url.search).includes(id);
  await page.route(ladeEntwurf, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((fertig) => setTimeout(fertig, 1500));
    const antwort = await route.fetch();
    neuGeladen = true;
    await route.fulfill({ response: antwort });
  });
  await page.getByLabel(/Einzelpreis Position 1/).fill("120,00");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await page.locator(".main > .page-head").getByRole("button", { name: "Festschreiben" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Festschreiben", exact: true })).toBeVisible();
  expect(neuGeladen).toBe(true);
  await page.unroute(ladeEntwurf);

  // Nicht festschreiben: die Nummern der übrigen Tests bleiben, wie sie sind
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await page.getByRole("button", { name: "Entwurf löschen", exact: true }).click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(/\/rechnungen(?:\?.*)?$/);
});

/**
 * Nach „Entwurf speichern“ baut die Seite den Editor mit dem gespeicherten Stand neu auf: beim ersten Speichern auf der
 * Adresse des neuen Entwurfs, danach mit dem neuen `updatedAt` im `key`. Was man bis dahin tippt, ginge verloren; deshalb
 * sind die Felder so lange gesperrt, und die Eingabe landet erst im neu aufgebauten Editor (#1148). Das Neuladen ist
 * verzögert, damit die Lücke sicher entsteht.
 */
async function eingabeNachDemSpeichern(bereich: "rechnungen" | "angebote") {
  await go(`/${bereich}/neu`);
  await kundeWaehlen(page);
  const beschreibung = page.getByLabel("Beschreibung Position 1");
  await beschreibung.fill("Erster Stand");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");

  // Die Adresse des Entwurfs steht vor dem Speichern noch nicht fest: alle Abfragen verzögern, nicht nur die des Entwurfs
  const abfrage = (url: URL) => url.pathname.startsWith("/_serverFn/");
  await page.route(abfrage, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((fertig) => setTimeout(fertig, 1500));
    await route.fulfill({ response: await route.fetch() });
  });
  const speichern = page.getByRole("button", { name: "Entwurf speichern", exact: true });

  // Erstes Speichern: Wechsel von „neu“ auf den Entwurf
  await speichern.click();
  await expect(beschreibung).toBeDisabled();
  await beschreibung.fill("Gleich danach getippt");
  // „Entwurf löschen“ gibt es erst im Editor des gespeicherten Entwurfs
  await expect(page.getByRole("button", { name: "Entwurf löschen", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${bereich}/[0-9a-f-]{36}$`));
  await expect(beschreibung).toHaveValue("Gleich danach getippt");

  // Weiteres Speichern: Neuaufbau mit dem neuen Stand
  await speichern.click();
  await expect(beschreibung).toBeDisabled();
  await beschreibung.fill("Beim zweiten Speichern getippt");
  await expect(page.getByText("Entwurf gespeichert.")).toBeVisible();
  await expect(beschreibung).toHaveValue("Beim zweiten Speichern getippt");
  await page.unroute(abfrage);

  // Nicht festschreiben: die Nummern der übrigen Tests bleiben, wie sie sind
  await page.getByRole("button", { name: "Entwurf löschen", exact: true }).click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(new RegExp(`/${bereich}(?:\\?.*)?$`));
}

test("Neue Rechnung: Eingaben direkt nach dem Speichern bleiben erhalten (#1148)", async () => {
  await eingabeNachDemSpeichern("rechnungen");
});

test("Neues Angebot: Eingaben direkt nach dem Speichern bleiben erhalten (#1148)", async () => {
  await eingabeNachDemSpeichern("angebote");
});

/** Kurz nacheinander gespeichert, baut sich der Editor jedes Mal mit dem gespeicherten Stand neu auf (#1804) */
async function kurzNacheinanderImEntwurf(bereich: "rechnungen" | "angebote") {
  await go(`/${bereich}/neu`);
  await kundeWaehlen(page);
  const beschreibung = page.getByLabel("Beschreibung Position 1");
  await beschreibung.fill("Erster Stand");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  const speichern = page.getByRole("button", { name: "Entwurf speichern", exact: true });
  await speichern.click();
  // „Entwurf löschen“ gibt es erst im Editor des gespeicherten Entwurfs
  const loeschen = page.getByRole("button", { name: "Entwurf löschen", exact: true });
  await expect(loeschen).toBeVisible();

  await kurzNacheinanderSpeichern({ feld: beschreibung, speichern, texte: ["Stand eins", "Stand zwei", "Stand drei"] });

  // Nicht festschreiben: die Nummern der übrigen Tests bleiben, wie sie sind
  await loeschen.click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(new RegExp(`/${bereich}(?:\\?.*)?$`));
}

test("Rechnungsentwurf: Kurz nacheinander gespeichert, baut sich der Editor jedes Mal neu auf (#1804)", async () => {
  await kurzNacheinanderImEntwurf("rechnungen");
});

test("Angebotsentwurf: Kurz nacheinander gespeichert, baut sich der Editor jedes Mal neu auf (#1804)", async () => {
  await kurzNacheinanderImEntwurf("angebote");
});

/**
 * Zwei Entwürfe für zwei neue Kunden; am zweiten bleibt „Entwurf gespeichert.“ nach dem Speichern stehen, nach dem Wechsel
 * ohne Neuladen über die Schnellsuche zum ersten nicht mehr (#1843). Danach beide Entwürfe wieder gelöscht.
 */
async function meldungBeimWechsel(bereich: "rechnungen" | "angebote") {
  const art = bereich === "rechnungen" ? "Rechnungsentwurf" : "Angebotsentwurf";
  const kunden = [`Meldekunde ${art} Ost · Rostock`, `Meldekunde ${art} West · Aachen`] as const;
  const name = (kunde: string) => kunde.split(" · ")[0]!;
  // Der Entwurf, nicht der Kontakt mit demselben Namen
  const treffer = (kunde: string) => new RegExp(`${art}\\s*${name(kunde)}`);
  const speichern = page.getByRole("button", { name: "Entwurf speichern", exact: true });
  const loeschen = page.getByRole("button", { name: "Entwurf löschen", exact: true });
  const gespeichert = page.getByRole("status").filter({ hasText: "Entwurf gespeichert." });
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e', true)`;
      await tx`insert into contacts (name, ort, land, is_customer, is_supplier)
        values (${name(kunden[0])}, 'Rostock', 'DE', true, false), (${name(kunden[1])}, 'Aachen', 'DE', true, false)`;
    });
    for (const kunde of kunden) {
      await go(`/${bereich}/neu`);
      await kundeWaehlen(page, kunde);
      await page.getByLabel("Beschreibung Position 1").fill("Beratung");
      await page.getByLabel("Menge Position 1").fill("1");
      await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
      await speichern.click();
      // „Entwurf löschen“ gibt es erst im Editor des gespeicherten Entwurfs
      await expect(loeschen).toBeVisible();
    }
    // Derselbe Entwurf geändert und gespeichert: Die Meldung bleibt, auch über den Neuaufbau des Editors
    await page.getByLabel("Beschreibung Position 1").fill("Beratung, zweiter Stand");
    await speichern.click();
    await expect(gespeichert).toBeVisible();

    await ueberSchnellsuche(page, name(kunden[0]), treffer(kunden[0]));
    await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue(kunden[0]);
    await expect(gespeichert).toHaveCount(0);

    // Nicht festschreiben: die Nummern der übrigen Tests bleiben, wie sie sind
    await loeschen.click();
    await bestaetigen(page, "Entwurf löschen");
    await expect(page).toHaveURL(new RegExp(`/${bereich}(?:\\?.*)?$`));
    await ueberSchnellsuche(page, name(kunden[1]), treffer(kunden[1]));
    await loeschen.click();
    await bestaetigen(page, "Entwurf löschen");
    await expect(page).toHaveURL(new RegExp(`/${bereich}(?:\\?.*)?$`));
  } finally {
    // Nicht in den Zahlen der folgenden Tests
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e', true)`;
      await tx`update contacts set archived_at = now() where name in ${sql([name(kunden[0]), name(kunden[1])])}`;
    });
    await sql.end();
  }
}

test("Rechnungsentwurf: Beim Wechsel ohne Neuladen bleibt die Meldung des vorigen Entwurfs nicht stehen (#1843)", async () => {
  await meldungBeimWechsel("rechnungen");
});

test("Angebotsentwurf: Beim Wechsel ohne Neuladen bleibt die Meldung des vorigen Entwurfs nicht stehen (#1843)", async () => {
  await meldungBeimWechsel("angebote");
});

test("Speichern schlägt fehl: der Fokus steht danach wieder im Feld, aus dem gespeichert wurde (#1148)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  const beschreibung = page.getByLabel("Beschreibung Position 1");
  await beschreibung.fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  // Nur die Anfrage zum Speichern scheitert, die Vorschau nicht
  const speichern = (url: URL) => url.pathname.startsWith("/_serverFn/");
  await page.route(speichern, (route) =>
    route.request().method() === "POST" && route.request().postData()?.includes('"draft"') ? route.abort() : route.fallback(),
  );
  // Enter im Feld speichert; während der Anfrage ist das Feld gesperrt und verliert den Fokus
  await beschreibung.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: /fetch|Netzwerk|network/i })).toBeVisible();
  await expect(beschreibung).toBeEnabled();
  await expect(beschreibung).toBeFocused();
  await expect(page).toHaveURL(/\/rechnungen\/neu/);
  await page.unroute(speichern);
});

test("Kopieren mit Fehler im Entwurf: der Fokus steht auf dem Feld mit Fehler, nicht auf dem Knopf (#1148)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page.getByRole("button", { name: "Entwurf löschen", exact: true })).toBeVisible();
  const rabatt = page.getByLabel("Gesamtrabatt (optional)");
  await rabatt.fill("2000");
  // Kopieren prüft vorher die Angaben; während die Aktion läuft, sind die Felder gesperrt und nehmen keinen Fokus an
  await page.getByRole("button", { name: "Kopieren", exact: true }).click();
  await expect(page.getByText("Der Gesamtrabatt ist höher als die Summe der Positionen")).toBeVisible();
  await expect(rabatt).toBeFocused();
  await page.getByRole("button", { name: "Entwurf löschen", exact: true }).click();
  await bestaetigen(page, "Entwurf löschen");
  await expect(page).toHaveURL(/\/rechnungen(?:\?.*)?$/);
});

test("Wiederkehrende Rechnung: Eingaben direkt nach dem Speichern bleiben erhalten (#1793)", async () => {
  await go("/rechnungen/wiederkehrend/neu");
  const bezeichnung = page.getByLabel("Bezeichnung");
  await bezeichnung.fill("Wartung Sperre");
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Wartung");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Vorlage anlegen" }).click();
  await page.waitForURL(/\/rechnungen\/wiederkehrend\/[0-9a-f-]{36}$/);
  // Das Formular der neuen Seite, nicht mehr das von „neu“
  await expect(page.getByRole("heading", { name: "Wartung Sperre", level: 1 })).toBeVisible();

  await bezeichnung.fill("Wartung gespeichert");
  await eingabeNachAktion(page, {
    aktion: page.getByRole("button", { name: "Speichern", exact: true }),
    feld: bezeichnung,
    text: "Gleich danach getippt",
    neuGeladen: page.getByRole("heading", { name: "Wartung gespeichert", level: 1 }),
  });
});

test("Wiederkehrende Rechnung: Kurz nacheinander gespeichert, baut sich das Formular jedes Mal neu auf (#1804)", async () => {
  // Die Vorlage aus dem Test davor
  await kurzNacheinanderSpeichern({
    feld: page.getByLabel("Bezeichnung"),
    speichern: page.getByRole("button", { name: "Speichern", exact: true }),
    texte: ["Wartung eins", "Wartung zwei", "Wartung drei"],
  });
});

test("Wiederkehrende Rechnung: Speichern schlägt fehl, der Fokus steht danach wieder im Feld (#1793)", async () => {
  // Die Vorlage aus den Tests davor
  await fokusNachFehlschlag(page, page.getByLabel("Bezeichnung"));
  // Die Vorlage gehört nur diesen drei Tests
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(page, "Vorlage löschen");
  await expect(page).toHaveURL(/\/rechnungen\/wiederkehrend(?:\?.*)?$/);
});

test("Artikel-API: Rechte, Anlegen, Suchen und Ändern im Katalog (#297)", async ({ request }) => {
  await go("/einstellungen?bereich=ki");
  const access = page.getByLabel("Zugang für KI-Assistenten und API einschalten");
  if (!(await access.isChecked())) {
    await access.click();
    await expect(access).toBeChecked();
  }
  const tokens = page.getByRole("region", { name: "API-Tokens" });
  const form = tokens.getByRole("form", { name: "Neues Token" });
  const scopes = form.getByRole("group", { name: "Rechte" });
  async function tokenHeaders(name: string, scope: "artikel:lesen" | "artikel:schreiben") {
    await form.getByLabel("Name").fill(name);
    await scopes.getByRole("checkbox", { name: /haben:lesen/ }).uncheck();
    await scopes.getByRole("checkbox", { name: new RegExp(`${scope}$`) }).check();
    await form.getByRole("button", { name: "Token anlegen" }).click();
    const token = await tokens.getByLabel(new RegExp(`Token für „${name}“`)).inputValue();
    expect(token).toMatch(/^hb_/);
    // Beim Neuladen der Tokenliste wird das Formular ersetzt.
    await expect(tokens.locator(".history-row", { hasText: name })).toBeVisible();
    return { Authorization: `Bearer ${token}` };
  }
  const reader = await tokenHeaders("Artikel lesen E2E", "artikel:lesen");
  const writer = await tokenHeaders("Artikel schreiben E2E", "artikel:schreiben");

  const path = "/api/v1/artikel";
  const article = {
    number: "KAT-E2E-297",
    description: "Netzwerksprechstunde",
    detail: "Fernwartung nach Termin",
    unit: "Std.",
    unitPrice: 6500,
    taxRate: 1900,
    priceIncludesTax: true,
    note: "Preis je Stunde",
  };
  expect((await page.request.get(path)).status()).toBe(401);
  expect((await request.post(path, { headers: reader, data: article })).status()).toBe(403);
  expect((await request.post(path, { headers: writer, data: { ...article, unitPrice: 65.5 } })).status()).toBe(400);
  const created = await request.post(path, { headers: writer, data: article });
  expect(created.status()).toBe(201);
  const result = (await created.json()) as { id: string };
  expect(result).toMatchObject({ ...article, id: expect.any(String), archived: false });
  const resource = `${path}/${result.id}`;
  expect(created.headers().location).toBe(resource);

  const byNumber = await request.get(path, { headers: reader, params: { q: article.number.toLowerCase(), limit: 1 } });
  expect(byNumber.status()).toBe(200);
  expect(await byNumber.json()).toMatchObject({ data: [result], total: 1, limit: 1, offset: 0 });
  const secondPage = await request.get(path, { headers: reader, params: { q: article.number, limit: 1, offset: 1 } });
  expect(await secondPage.json()).toMatchObject({ data: [], total: 1, offset: 1 });
  const single = await request.get(resource, { headers: reader });
  expect(single.status()).toBe(200);
  expect(await single.json()).toEqual(result);
  expect((await request.get(`${path}/00000000-0000-4000-8000-000000000000`, { headers: reader })).status()).toBe(404);

  const changes = { unitPrice: 7550, description: "Netzwerksprechstunde am Nachmittag" };
  expect((await request.patch(resource, { headers: reader, data: changes })).status()).toBe(403);
  const updated = await request.patch(resource, { headers: writer, data: changes });
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toMatchObject({ ...article, ...changes, id: result.id, archived: false });

  await go("/artikel");
  const list = page.getByRole("region", { name: "Artikelliste" });
  const row = list.locator(".article-cols").filter({ hasText: changes.description });
  await expect(row).toContainText("75,50\u00a0€ brutto je Std.");
  await row.getByRole("button", { name: "Archivieren", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Artikel archiviert." })).toBeVisible();
  const active = await request.get(path, { headers: writer, params: { q: changes.description } });
  expect(await active.json()).toMatchObject({ data: [], total: 0 });
  const archived = await request.get(path, { headers: writer, params: { q: changes.description, archived: true } });
  expect(await archived.json()).toMatchObject({ data: [{ id: result.id, archived: true }], total: 1 });
});

test("Kopieren: festgeschriebene Rechnung und daraus wieder der Entwurf als neuer Entwurf mit denselben Positionen, das Original bleibt", async () => {
  await rechnungFestschreiben(page, {
    customer: "Rheinpixel GmbH · Köln",
    date: day(-4),
    lines: [["Monatliche Betreuung Server", "3", "80,00"]],
    gross: "285,60",
  });
  const originalUrl = page.url();
  await page.getByRole("button", { name: "Kopieren", exact: true }).click();
  await page.waitForURL((url) => /\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname) && url.toString() !== originalUrl);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Monatliche Betreuung Server");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("80,00");
  await expect(page.getByLabel("Rechnungsdatum")).not.toHaveValue(day(-4));

  // Aus dem gerade kopierten Entwurf entsteht mit „Kopieren“ wieder ein neuer Entwurf (#1465); Ungespeichertes wird vorher
  // gespeichert, die Kopie und der Entwurf selbst zeigen also die geänderte Position
  const draftUrl = page.url();
  await page.getByLabel("Beschreibung Position 1").fill("Betreuung Server, Dezember");
  await page.getByRole("button", { name: "Kopieren", exact: true }).click();
  await page.waitForURL((url) => /\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname) && url.toString() !== draftUrl);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Betreuung Server, Dezember");
  await expect(page.getByRole("button", { name: "Festschreiben", exact: true }).first()).toBeVisible();
  await page.goto(draftUrl);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Betreuung Server, Dezember");

  await page.goto(originalUrl);
  await expect(page.getByRole("button", { name: "Kopieren", exact: true })).toBeVisible();
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible();
});

test("Angebotsentwurf kopieren: die Kopie hat Positionen und Ungespeichertes, der Entwurf bleibt als Vorlage (#1881)", async () => {
  await go("/angebote/neu");
  // Kopieren prüft vorher die Angaben wie beim Rechnungsentwurf, auch den Kunden
  await kundeWaehlen(page);
  await page.getByLabel("Beschreibung Position 1").fill("Wartungspaket");
  await page.getByLabel("Menge Position 1").fill("40");
  await page.getByLabel(/Einzelpreis Position 1/).fill("12,50");
  // Ein noch nie gespeichertes Angebot hat nichts zum Kopieren
  await expect(page.getByRole("button", { name: "Kopieren", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/angebote\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  const vorlage = page.url();
  await page.getByLabel("Beschreibung Position 1").fill("Wartungspaket für 50 Geräte");
  await page.getByRole("button", { name: "Kopieren", exact: true }).click();
  await page.waitForURL((url) => /\/angebote\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== vorlage);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Wartungspaket für 50 Geräte");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("12,50");
  await expect(page.getByRole("button", { name: "Festschreiben", exact: true }).first()).toBeVisible();
  await page.goto(vorlage);
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Wartungspaket für 50 Geräte");
});

test("Kontaktseite: Zeiteinträge des Kunden erfassen und ansehen, Rechnung mit diesem Kunden schreiben (#1557)", async () => {
  await go("/kontakte");
  const kontakt = (await page.getByRole("link", { name: "Nordwerk Software GmbH" }).first().getAttribute("href"))!;
  await go(kontakt);
  // Im Seitenkopf: die Navigation hat ebenfalls einen Link „Zeiteinträge“
  const kopf = page.locator(".main > .page-head");
  // Ohne offene Einträge: nur „Zeiteinträge“, als Einstieg zum Erfassen
  await kopf.getByRole("link", { name: "Zeiteinträge", exact: true }).click();
  await page.waitForURL(/\/leistungen\?kunde=[0-9a-f-]{36}$/);
  await page.locator(".page-head").getByRole("button", { name: "Neuer Eintrag" }).click();
  const neu = page.getByRole("form", { name: "Neuer Eintrag" });
  await expect(neu.getByLabel("Kunde").locator("option:checked")).toHaveText("Nordwerk Software GmbH");
  await neu.getByLabel("Dauer", { exact: true }).fill("1:30");
  await neu.getByLabel(/Stundensatz/).fill("95");
  await neu.getByLabel(/Tätigkeit/).fill("Workshop Kontaktseite");
  await neu.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Eintrag angelegt.")).toBeVisible();

  // Mit offenen Einträgen nennt der Link die Dauer und führt zum Stand „offen“
  await go(kontakt);
  await kopf.getByRole("link", { name: "Zeiteinträge · 1:30 offen" }).click();
  await page.waitForURL(/\/leistungen\?kunde=[0-9a-f-]{36}&stand=offen$/);
  const liste = page.getByRole("region", { name: "Leistungsliste" });
  await expect(liste).toContainText("Workshop Kontaktseite");

  // Rechnung schreiben: der Entwurf hat den Kunden schon gewählt
  await go(kontakt);
  await kopf.getByRole("link", { name: "Rechnung schreiben" }).click();
  await page.waitForURL(/\/rechnungen\/neu\?kunde=[0-9a-f-]{36}$/);
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue(/^Nordwerk Software GmbH/);

  // Aufräumen: der Eintrag gehört nur zu diesem Test
  await go("/leistungen");
  await liste
    .locator(".table-row")
    .filter({ hasText: "Workshop Kontaktseite" })
    .getByRole("button", { name: /löschen/ })
    .click();
  await page.getByRole("dialog", { name: "Eintrag löschen?" }).getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByText("Eintrag gelöscht.")).toBeVisible();
});

test("Stornierte Rechnung als Ersatz erneut ausstellen, Leistungszeitraum und Bezug bleiben erhalten (#1454)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Nordwerk Software GmbH · Hamburg");
  await page.getByLabel("Rechnungsdatum").fill(currentDay());
  await page.getByLabel("Leistung von").fill(day(-24));
  await page.getByLabel("Leistung bis").fill(day(-23));
  await page.getByLabel("Beschreibung Position 1").fill("Beratung zur Website");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Festschreiben", exact: true }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const original = new URL(page.url()).pathname;
  const originalTitel = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
  const ersatzAktion = page.getByRole("button", { name: "Ersatzrechnung erstellen", exact: true });
  await expect(ersatzAktion).toHaveCount(0);
  await page.getByRole("button", { name: "Stornieren", exact: true }).click();
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("heading", { level: 1, name: /^Stornorechnung/ })).toBeVisible();
  await go(original);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(ersatzAktion).toBeInViewport({ ratio: 1 });
  if (viewport) await page.setViewportSize(viewport);

  // Eine normale Kopie bleibt eine neue Rechnung ohne alten Leistungszeitraum und ohne Austauschbezug.
  await page.getByRole("button", { name: "Kopieren", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== original && /^\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname));
  await expect(page.getByLabel("Leistung von")).toHaveValue("");
  const originalLink = page.getByRole("link", { name: originalTitel, exact: true });
  await expect(originalLink).toHaveCount(0);
  await go(original);

  await ersatzAktion.click();
  await page.waitForURL((url) => url.pathname !== original && /^\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname));
  const ersatz = new URL(page.url()).pathname;
  await expect(originalLink).toHaveAttribute("href", original);
  await expect(page.getByLabel("Leistung von")).toHaveValue(day(-24));
  await expect(page.getByLabel("Leistung bis")).toHaveValue(day(-23));
  await page.getByLabel("Beschreibung Position 1").fill("Beratung zur Website, ergänzte Beschreibung");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await expect(page.getByText("Entwurf gespeichert.", { exact: true })).toBeVisible();
  await expect(originalLink).toHaveAttribute("href", original);
  await page.getByRole("button", { name: "Festschreiben", exact: true }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  await expect(originalLink).toHaveAttribute("href", original);
  const ersatzTitel = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
  await go(original);
  await expect(page.getByRole("link", { name: ersatzTitel, exact: true })).toHaveAttribute("href", ersatz);
  await expect(ersatzAktion).toHaveCount(0);
});

test("Seiten mit den Daten dieses Abschnitts ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, ["/angebote", "/einstellungen?bereich=email", "/rechnungen"]);
});

test("Sondergebiete: Hinweis ohne stille Änderung in Kontakt, Rechnung und Angebot (#1046)", async () => {
  await sondergebietePruefen(page);
});

test("Sondergebiete: tatsächlichen Leistungsort in Rechnung, Angebot und Serie selbst bestätigen (#1046)", async () => {
  await sondergebietsLeistungsortPruefen(page);
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
