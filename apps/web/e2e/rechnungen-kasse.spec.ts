import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { day } from "./daten.ts";
import { type Durchlauf, databaseUrlFuer } from "./durchlaeufe.ts";
import { LAPTOP, sichtbar, zumEnde } from "./kopfzeile.ts";
import {
  axeVerstoesse,
  kontoVerbinden,
  bestaetigen,
  faktenZeigen,
  durchlaufSeite,
  gehe,
  kundeWaehlen,
  ohneAxeVerstoesse,
  rechnungFestschreiben,
} from "./einrichtung.ts";
import { abzugEinspielen } from "./abzug.ts";

/**
 * Abschnitt von rechnungen (#1742) mit eigenem Server und eigener Datenbank, parallel zu den anderen Abschnitten:
 * Kassenbuch und Bareinnahmen, SEPA-Lastschrift, Beleggestaltung mit eigenem Layout, Ansprechpartner und
 * Rechnungsdatum vor der letzten Rechnung.
 * Beginnt mit dem Abzug nach der Einrichtung mit drei Kunden und einer festgeschriebenen Rechnung in rechnungen.spec.ts
 * (e2e/abzug.ts).
 */

const DURCHLAUF = "rechnungen-kasse" satisfies Durchlauf;

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

test("Kassenbuch: Einlage, Entnahme über Bestand abgelehnt, Storno", async () => {
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByLabel("Betrag (€)").fill("50");
  await form.getByLabel("Text (optional)").fill("Wechselgeld");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nr. 1 gebucht" })).toBeVisible();
  await form.getByRole("button", { name: "Entnahme" }).click();
  await form.getByLabel("Betrag (€)").fill("80");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("alert")).toContainText("negativ");
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste).toContainText("Wechselgeld");
  const stornieren = liste.getByRole("button", { name: "Nr. 1 stornieren" });
  await stornieren.click();
  await faktenZeigen(page, "Nummer", "Text", "Betrag");
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr. 2" })).toBeVisible();
  await expect(liste).toContainText("Storno Nr. 1: Wechselgeld");
});

test("Kasse: Rechnung bar bezahlt, erst ein Teil, dann der Rest von der Rechnung aus, Storno der Bareinnahme", async ({ browser }) => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Rechnungsdatum").fill(day(-3));
  await page.getByLabel("Beschreibung Position 1").fill("Flyer gedruckt, bar bezahlt");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const invoicePath = new URL(page.url()).pathname;
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/^Rechnung (\S+)/)?.[1] ?? "";
  expect(number).not.toBe("");
  const zahlungen = page.getByRole("region", { name: "Zahlungen" });
  await expect(zahlungen).toContainText("Noch keine Zahlung");

  // Das Storno nennt, was storniert würde; hier nur ansehen
  await page.getByRole("button", { name: "Stornieren" }).click();
  await faktenZeigen(page, "Nummer", "Kunde", "Betrag");
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();

  // Teilzahlung in der Kasse: 50,00 € von 119,00 €
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Rechnung bar bezahlt" }).click();
  const option = form.getByRole("option", { name: new RegExp(`^${number} · Rheinpixel GmbH`) });
  await form.getByRole("combobox", { name: /^Rechnung/ }).selectOption((await option.getAttribute("value"))!);
  await expect(form.getByLabel("Betrag (€)")).toHaveValue("119,00");
  await form.getByLabel("Betrag (€)").fill("50,00");
  await expect(form).toContainText(/Danach bleiben 69,00\s€ offen/);
  await expect(form.getByRole("checkbox", { name: /als Skonto ausbuchen/ })).not.toBeChecked();
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: `gebucht: Bareinnahme Rechnung ${number} über 50,00` })).toBeVisible();
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste.getByRole("link", { name: `Rechnung ${number} · Rheinpixel GmbH` })).toBeVisible();

  await go(invoicePath);
  await expect(page.getByText("Teilbezahlt").first()).toBeVisible();
  await expect(zahlungen).toContainText("bar am");

  // Der Rest von der Rechnung aus: Rechnung und offener Betrag sind vorbelegt; mehr als offen lehnt Haben ab
  await zahlungen.getByRole("link", { name: "Barzahlung in der Kasse erfassen" }).click();
  await page.waitForURL(/\/kasse\?rechnung=/);
  await page.waitForLoadState("networkidle");
  await expect(form.getByRole("button", { name: "Rechnung bar bezahlt" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Betrag (€)")).toHaveValue("69,00");
  // Die Bareinnahme mit Rechnung prüft axe hier, am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 390]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(page.url());
    await axePage.waitForLoadState("networkidle");
    await expect(axePage.getByLabel("Betrag (€)")).toHaveValue("69,00");
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `/kasse mit Rechnung bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();
  // Mehr als offen wird nicht mehr abgelehnt, sondern aufgeteilt (#455): Der Teil darüber wäre eine weitere Einnahme
  await form.getByLabel("Betrag (€)").fill("70,00");
  await expect(form).toContainText(/1,00\s€ darüber werden eine weitere Einnahme/);
  await expect(form.getByRole("group", { name: /Weitere Einnahme über 1,00/ })).toBeVisible();
  await form.getByLabel("Betrag (€)").fill("69,00");
  await expect(form.getByRole("group", { name: /Weitere Einnahme/ })).toHaveCount(0);
  await form.getByRole("button", { name: "Buchen" }).click();
  const gebucht = page.getByRole("status").filter({ hasText: `gebucht: Bareinnahme Rechnung ${number} über 69,00` });
  await expect(gebucht).toBeVisible();
  const restNr = (await gebucht.textContent())?.match(/Nr\. (\d+) gebucht/)?.[1] ?? "";

  await go(invoicePath);
  await expect(page.getByText("Bezahlt").first()).toBeVisible();
  await expect(zahlungen.getByRole("link", { name: "Barzahlung in der Kasse erfassen" })).toBeHidden();

  // Storno der Restzahlung als Gegenzeile: Die Rechnung ist wieder teilweise offen
  await go("/kasse");
  const stornieren = liste.getByRole("button", { name: `Nr. ${restNr} stornieren` });
  await stornieren.click();
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr." })).toBeVisible();
  await expect(liste).toContainText(`Storno Nr. ${restNr}: Rechnung ${number}`);
  await go(invoicePath);
  await expect(page.getByText("Teilbezahlt").first()).toBeVisible();
  await expect(zahlungen).toContainText("storniert");
});

test("Kasse: Bareinnahme ohne Rechnung als Tagessumme mit Steuer und Notiz, Storno (#276)", async ({ browser }) => {
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Bareinnahme ohne Rechnung" }).click();
  await expect(form.getByRole("button", { name: "Bareinnahme ohne Rechnung" })).toHaveAttribute("aria-pressed", "true");
  // Regelbesteuert: 19 %, 7 % oder steuerfrei; die Kleinunternehmer-Option fehlt
  const steuer = form.getByLabel("Umsatzsteuer");
  await expect(steuer).toHaveValue("regulaer:1900");
  await expect(steuer.getByRole("option")).toHaveText(["Regulär 19 %", "Regulär 7 %", "steuerfrei (§ 4 Nr. 8 bis 29 UStG)"]);
  // Die Notiz ist Pflicht: Ohne Rechnung ist sie der Nachweis
  await expect(form.getByLabel("Notiz")).toHaveAttribute("required", "");
  // Das Formular der Bareinnahme prüft axe am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const axePage = await context.newPage();
  for (const width of [1440, 390]) {
    await axePage.setViewportSize({ width, height: 900 });
    await axePage.goto(page.url());
    await axePage.waitForLoadState("networkidle");
    await axePage.getByRole("button", { name: "Bareinnahme ohne Rechnung" }).click();
    await expect(axePage.getByLabel("Umsatzsteuer")).toBeVisible();
    const { violations } = await new AxeBuilder({ page: axePage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `/kasse mit Bareinnahme bei ${width} px`,
    ).toEqual([]);
  }
  await context.close();

  await form.getByLabel("Betrag (€)").fill("107,00");
  await steuer.selectOption("regulaer:700");
  await form.getByLabel("Notiz").fill("Wochenmarkt, Tagessumme Bücher");
  await form.getByRole("button", { name: "Buchen" }).click();
  const gebucht = page.getByRole("status").filter({ hasText: "gebucht: Bareinnahme über 107,00 €, 7 %." });
  await expect(gebucht).toBeVisible();
  const nr = (await gebucht.textContent())?.match(/Nr\. (\d+) gebucht/)?.[1] ?? "";
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste).toContainText("Wochenmarkt, Tagessumme Bücher");
  await expect(liste).toContainText("Bareinnahme · 7 %");

  await liste.getByRole("button", { name: `Nr. ${nr} stornieren` }).click();
  await bestaetigen(page, "Stornieren");
  await expect(page.getByRole("status").filter({ hasText: "Storniert mit Nr." })).toBeVisible();
  await expect(liste).toContainText(`Storno Nr. ${nr}: Wochenmarkt, Tagessumme Bücher`);
});

test("Kasse: Barzahlung aufteilen, Rechnung voll und Trinkgeld als weitere Einnahme (#455)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Rechnungsdatum").fill(day(-1));
  await page.getByLabel("Beschreibung Position 1").fill("Fotoshooting, bar bezahlt mit Trinkgeld");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("100,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const invoicePath = new URL(page.url()).pathname;
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/^Rechnung (\S+)/)?.[1] ?? "";

  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Rechnung bar bezahlt" }).click();
  const option = form.getByRole("option", { name: new RegExp(`^${number} · Rheinpixel GmbH`) });
  await form.getByRole("combobox", { name: /^Rechnung/ }).selectOption((await option.getAttribute("value"))!);
  // 125,00 € für 119,00 €: Die Rechnung ist bezahlt, 6,00 € werden eine weitere Einnahme
  await form.getByLabel("Betrag (€)").fill("125,00");
  await expect(form).toContainText(/6,00\s€ darüber werden eine weitere Einnahme/);
  const weitere = form.getByRole("group", { name: /Weitere Einnahme über 6,00/ });
  await expect(weitere.getByLabel("Umsatzsteuer")).toHaveValue("regulaer:1900");
  await weitere.getByLabel("Notiz zur weiteren Einnahme").fill("Trinkgeld");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `gebucht: Bareinnahme Rechnung ${number} über 119,00 €, dazu 6,00 € als weitere Einnahme (19 %).` }),
  ).toBeVisible();
  const liste = page.getByRole("region", { name: "Kassenbuch" });
  await expect(liste).toContainText(`Trinkgeld zu Rechnung ${number}`);
  await expect(liste).toContainText("Bareinnahme · 19 %");
  await go(invoicePath);
  await expect(page.getByText("Bezahlt").first()).toBeVisible();
});

test("Ein langes Wort im Titel des Dialogs wird umbrochen, nicht abgeschnitten", async () => {
  const name = "Warenwirtschaftsbestelluebersichtsseiten"; // 40 Zeichen, mehr nimmt das Formular nicht
  await go("/einstellungen?bereich=seiten");
  const form = page.getByRole("form", { name: "Neue eigene Seite" });
  await form.getByLabel("Name im Menü").fill(name);
  await form.getByLabel("Adresse").fill("https://n8n.example.com/form");
  await form.getByRole("button", { name: "Seite hinzufügen" }).click();
  const entfernen = page.getByRole("button", { name: `${name} entfernen` });
  await expect(entfernen).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await entfernen.click();
  const dialog = page.getByRole("dialog", { name: /aus dem Menü entfernen\?$/ });
  const titel = dialog.getByRole("heading");
  await expect(titel).toBeVisible();
  const passt = await titel.evaluate((element) => element.scrollWidth <= element.clientWidth);
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(entfernen).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(passt).toBe(true);
});

test("Doppelklick auf Stornieren im Kassenbuch: Liegt der rote Knopf des Dialogs darunter, bestätigt der zweite Klick nicht", async () => {
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByLabel("Betrag (€)").fill("20");
  await form.getByLabel("Text (optional)").fill("Doppelklick");
  await form.getByRole("button", { name: "Buchen" }).click();
  const eintrag = page.getByRole("region", { name: "Kassenbuch" }).locator(".table-row").filter({ hasText: "Doppelklick" });
  await expect(eintrag).toBeVisible();

  // Handy: Der Knopf der Zeile steht rechts wie die Aktion im Dialog; ob sie sich decken, hängt nur noch an der Höhe
  await page.setViewportSize({ width: 375, height: 812 });
  const stornieren = eintrag.getByRole("button", { name: /stornieren$/ });
  await stornieren.click();
  const dialog = page.getByRole("dialog", { name: /stornieren\?$/ });
  const aktion = (await dialog.getByRole("button", { name: "Stornieren" }).boundingBox())!;
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  const unterDerAktion = aktion.y + aktion.height / 2 - 812 / 2;
  const zeile = (await stornieren.boundingBox())!;
  const mitte = { x: zeile.x + zeile.width / 2, y: zeile.y + zeile.height / 2 };
  expect(mitte.x).toBeGreaterThan(aktion.x);
  expect(mitte.x).toBeLessThan(aktion.x + aktion.width);
  await page.setViewportSize({ width: 375, height: Math.round(2 * (mitte.y - unterDerAktion)) });

  await page.mouse.dblclick(mitte.x, mitte.y);
  await expect(dialog).toBeVisible();
  await expect(eintrag).not.toContainText("storniert");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("Entwurf aus dem stehenden Kopf speichern: die Bestätigung erscheint im Fenster (#356)", async () => {
  const vorher = page.viewportSize();
  await page.setViewportSize(LAPTOP);
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page);
  // Leere Position: „Festschreiben“ fragt nicht nach, sondern nennt unter der Position je Feld, was fehlt (DESIGN.md, Gesperrte
  // Knöpfe); der Fokus geht ins erste Feld mit Fehler (#1277)
  const festschreiben = page.locator(".main > .page-head").getByRole("button", { name: "Festschreiben" });
  const menge = page.getByLabel("Menge Position 1");
  const preis = page.getByLabel(/Einzelpreis Position 1/);
  await festschreiben.click();
  await expect(page.getByLabel("Beschreibung Position 1")).toBeFocused();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveAccessibleDescription("Trag die Beschreibung ein.");
  await expect(preis).toHaveAttribute("aria-invalid", "true");
  await expect(preis).toHaveAccessibleDescription("Trag den Einzelpreis ein, etwa 95,00.");
  await expect(menge).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung");
  await menge.fill("0");
  await festschreiben.click();
  await expect(menge).toBeFocused();
  await expect(menge).toHaveAccessibleDescription("Trag eine Menge über 0 ein, etwa 2 oder 1,5.");
  await expect(page.getByLabel("Beschreibung Position 1")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await menge.fill("1");
  await preis.fill("100");
  const speichern = page.locator(".main > .page-head").getByRole("button", { name: "Entwurf speichern" });
  await speichern.click();
  await expect(page).toHaveURL(/\/rechnungen\/[0-9a-f-]{36}/);
  await expect(speichern).toBeDisabled();
  // Nach dem ersten Speichern lädt die Seite neu: eine zu frühe Eingabe ginge dabei verloren
  await expect(async () => {
    await page.getByLabel("Beschreibung Position 1").fill("Beratung geändert");
    await expect(speichern).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await zumEnde(page);
  await speichern.click();
  await sichtbar(page.getByRole("status").filter({ hasText: "Entwurf gespeichert." }));
  if (vorher) await page.setViewportSize(vorher);
});

test("Kasse: Bareinnahme ohne Rechnung aus einem Monat, in dem noch § 19 galt, bietet „Kleinunternehmer“ an (#276)", async () => {
  // Stand im Änderungsprotokoll: vor 40 Tagen Kleinunternehmer, heute nicht mehr (Ausschalten geht jederzeit), wie in
  // belege-steuern-bank.spec.ts (#295). Der Server prüft die Behandlung gegen den Stand am Ende des Monats der Bareinnahme.
  const datum = day(-40);
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    await sql`insert into audit_log (at, actor, table_name, row_id, action, new_value)
      values (${`${datum}T12:00:00Z`}::timestamptz, 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: true })}),
             (now(), 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: false })})`;
  } finally {
    await sql.end();
  }
  await go("/kasse");
  const form = page.getByRole("form", { name: "Kassenbuchung eintragen" });
  await form.getByRole("button", { name: "Bareinnahme ohne Rechnung" }).click();
  await form.getByLabel("Datum").fill(datum);
  const steuer = form.getByLabel("Umsatzsteuer");
  // Für dieses Datum ist nur „Kleinunternehmer“ oder „steuerfrei“ buchbar; 19 % lehnt der Server ab
  await expect(steuer.getByRole("option")).toHaveText(["Kleinunternehmer (§ 19 UStG)", "steuerfrei (§ 4 Nr. 8 bis 29 UStG)"]);
  await expect(steuer).toHaveValue("kleinunternehmer:0");
  await form.getByLabel("Betrag (€)").fill("25,00");
  await form.getByLabel("Notiz").fill("Flohmarkt, Tagessumme");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "gebucht: Bareinnahme über 25,00 €, Kleinunternehmer (§ 19 UStG)." })).toBeVisible();
});

test("Rechnung per SEPA-Lastschrift: Mandat wählen, festschreiben, Vorabankündigung und Zahlungsart 59 in der E-Rechnung (#445)", async () => {
  // Gläubiger-ID (Test-ID der Bundesbank) und ein Mandat für Alpenblick
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("Gläubiger-ID").fill("DE98ZZZ09999999999");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await go("/kontakte");
  const kontaktPfad = (await page
    .getByRole("link", { name: /Alpenblick Media AG/ })
    .first()
    .getAttribute("href"))!;
  // Ohne Mandat erklärt der Editor das Mandat und verlinkt auf die Stelle beim Kontakt, an der es angelegt wird
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Alpenblick Media AG · München");
  await page.getByLabel("Zahlungsart").selectOption("lastschrift");
  await expect(page.getByText("Das Mandat ist die Einzugsermächtigung deines Kunden")).toBeVisible();
  const mandatLink = page.getByRole("link", { name: "SEPA-Lastschriftmandate (öffnet in neuem Tab)" });
  await expect(mandatLink).toHaveAttribute("href", `${kontaktPfad}#mandate-heading`);
  await expect(mandatLink).toHaveAttribute("target", "_blank");
  await go(kontaktPfad);
  const karte = page.getByRole("region", { name: "SEPA-Lastschriftmandate" });
  await karte.getByRole("button", { name: "Mandat anlegen" }).click();
  const mandat = karte.getByRole("form", { name: "Neues Mandat" });
  await mandat.getByLabel("Mandatsreferenz").fill("AB-2026-01");
  await mandat.getByLabel("Unterschrieben am").fill(day(-30));
  await mandat.getByLabel("IBAN").fill("DE02120300000000202051");
  await mandat.getByRole("button", { name: "Mandat speichern" }).click();
  await expect(page.getByText("Mandat angelegt.")).toBeVisible();

  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page, "Alpenblick Media AG · München");
  // Fällig in 7 Tagen: Auch wenn ein Wochenende oder Ostern die Fälligkeit um bis zu 4 Tage verschiebt, liegt sie
  // weniger als 14 Tage entfernt, und der nächste Test kann die Lastschrift sofort einreichen (#904)
  await page.getByLabel("Rechnungsdatum").fill(day(-7));
  await page.getByLabel("Zahlungsart").selectOption("lastschrift");
  // Das jüngste gültige Mandat des Kunden ist vorgewählt; Skonto entfällt bei Lastschrift
  // Über die Rolle: getByLabel mit exact vergleicht den ganzen Text des umschließenden Labels samt gewählter Option
  const mandatFeld = page.getByRole("combobox", { name: "Mandat", exact: true });
  await expect(mandatFeld).toHaveValue(/.+/);
  await expect(mandatFeld.locator("option:checked")).toHaveText("AB-2026-01 · CORE");
  // Mit gewähltem Mandat entfällt die Erklärung, der Hinweis zur Ankündigung bleibt
  await expect(page.getByText("Das Mandat ist die Einzugsermächtigung deines Kunden")).toHaveCount(0);
  await expect(page.getByText("14 Kalendertage vorher beim Kunden sein")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skontostufe hinzufügen" })).toHaveCount(0);
  await page.getByLabel("Beschreibung Position 1").fill("Wartung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("250");
  await page.getByRole("button", { name: "Entwurf speichern" }).first().click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Zahlungsart")).toHaveValue("lastschrift");
  await page.getByRole("button", { name: "Festschreiben" }).first().click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const id = /rechnungen\/([0-9a-f-]{36})/.exec(page.url())![1];
  const xml = await (await page.request.get(`/api/rechnung/${id}/xml`)).text();
  expect(xml).toMatch(/<ram:TypeCode>59<\/ram:TypeCode>/);
  expect(xml).toContain("<ram:DirectDebitMandateID>AB-2026-01</ram:DirectDebitMandateID>");
  expect(xml).toContain("<ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>");
  expect(xml).toContain("per SEPA-Lastschrift");
});

test("Lastschriftdatei: fällige Rechnung wählen, pain.008 herunterladen, danach nicht mehr angeboten (#445)", async () => {
  await go("/lastschriften");
  // Ohne Bankkonto gibt es kein Gläubigerkonto, auf dem der Betrag eingeht
  await expect(page.getByText(/braucht Haben das Konto, auf dem der Betrag eingeht/)).toBeVisible();
  await go("/bank");
  await kontoVerbinden(page, "Konto ohne Abruf anlegen");
  const kontoForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Konto anlegen" }) });
  await kontoForm.getByRole("textbox", { name: "Name" }).fill("Girokonto");
  await kontoForm.getByRole("textbox", { name: "IBAN" }).fill("DE89 3704 0044 0532 0130 00");
  await kontoForm.getByRole("button", { name: "Konto anlegen" }).click();
  // Das neue Konto ist gewählt: seine Karte steht in der Leiste (#1951)
  await expect(page.getByRole("navigation", { name: "Konten" }).getByRole("link", { name: /^Girokonto/ })).toHaveAttribute("aria-current", "page");

  await go("/lastschriften");
  const form = page.getByRole("form", { name: "SEPA-Lastschrift erzeugen" });
  // Einleitung in drei Schritten statt Dateiformat und Fachwort
  await expect(page.getByRole("list").filter({ hasText: "Online-Banking hochladen" }).getByRole("listitem")).toHaveCount(3);
  await expect(form.getByLabel("Konto, auf das das Geld kommt")).toContainText("Girokonto · DE89 3704 0044 0532 0130 00");
  const zeile = form.getByRole("checkbox", { name: /Alpenblick Media AG .* einziehen/ });
  await expect(form).toContainText("AB-2026-01");
  await expect(form).toContainText("CORE · Erstlastschrift");
  await zeile.check();
  await expect(form.getByText("1 ausgewählt · 297,50 €")).toBeVisible();
  const download = page.waitForEvent("download");
  await form.getByRole("button", { name: "Lastschriftdatei erzeugen" }).click();
  const datei = await download;
  expect(datei.suggestedFilename()).toMatch(/^HABEN-[0-9A-F]{16}\.xml$/);
  const { readFile } = await import("node:fs/promises");
  const xml = await readFile((await datei.path())!, "utf8");
  expect(xml).toContain("urn:iso:std:iso:20022:tech:xsd:pain.008.001.08");
  expect(xml).toContain("<MndtId>AB-2026-01</MndtId>");
  expect(xml).toContain("<SeqTp>FRST</SeqTp>");
  // formatEuro trennt den Betrag mit einem geschützten Leerzeichen vom Euro-Zeichen
  await expect(page.getByText(/1 Lastschrift über 297,50\s€/)).toBeVisible();
  await expect(form.getByRole("checkbox", { name: /Alpenblick Media AG .* einziehen/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Erzeugte Dateien" })).toContainText("297,50 €");
});

test("Beleggestaltung: Einstellungen, die das zugeordnete eigene Layout nicht verwendet, sind aus und sagen warum (#113)", async () => {
  // Hier statt in layouts.spec.ts: Ein eigenes Layout für Rechnungen sähen dort die parallelen Tests der Rechnungsvorschau
  const karte = page.getByRole("region", { name: "Layouts", exact: true });
  const blatt = page.getByRole("region", { name: "Logo und Blatt" });
  const giroCode = blatt.getByRole("checkbox", { name: "GiroCode" });
  const falzmarken = blatt.getByRole("checkbox", { name: "Falz- und Lochmarken" });
  const zuordnen = async (art: string, layout: string) => {
    // Die Wahl je Belegart steht eingeklappt, solange alle Belegarten dasselbe Layout haben
    const jeBeleg = karte.locator("details.layouts-je-beleg");
    if (!(await jeBeleg.evaluate((element: HTMLDetailsElement) => element.open))) await jeBeleg.locator("summary").click();
    await karte.getByLabel(`Layout für ${art}`).selectOption({ label: layout });
    await expect(karte.getByRole("status").first()).toContainText("Gespeichert");
    await go("/einstellungen?bereich=gestaltung");
  };
  const hochladen = async (name: string, art: "beleg" | "mahnung") => {
    // Die eingebaute Vorlage ohne GiroCode und ohne Falz- und Lochmarken
    const quelltext = (await (await page.request.get(`/api/belegvorlagen?datei=start&art=${art}`)).text())
      .replace(/(?<![A-Za-z0-9_])qr(?![A-Za-z0-9_])/g, "ohneqr")
      .replaceAll("look.foldMarks", "false")
      .replaceAll("foldMarks: true, ", "");
    const form = karte.getByRole("form", { name: "Layout hochladen" });
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Für").selectOption(art);
    await form.getByLabel("Typst-Datei").setInputFiles({ name: `${name}.typ`, mimeType: "text/plain", buffer: Buffer.from(quelltext) });
    await form.getByRole("button", { name: "Prüfen und speichern" }).click();
    // Die Meldung stünde vom vorigen Hochladen noch da; erst der Eintrag in der Liste zeigt, dass dieses gespeichert ist
    await expect(karte.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) })).toBeVisible({ timeout: 60_000 });
  };

  await go("/einstellungen?bereich=gestaltung");
  await expect(giroCode).toBeEnabled();
  await expect(giroCode).toHaveAccessibleDescription("");
  await hochladen("Schlicht", "beleg");
  await hochladen("Schlicht Mahnung", "mahnung");
  // Hochgeladen, aber noch nirgends zugeordnet: ändert nichts
  await go("/einstellungen?bereich=gestaltung");
  await expect(giroCode).toHaveAccessibleDescription("");

  try {
    // Die Mahnung hat noch das eingebaute Layout: GiroCode bleibt an, der Hinweis nennt die Rechnungen
    await zuordnen("Rechnung, Storno und Korrektur", "Schlicht");
    await expect(giroCode).toBeEnabled();
    await expect(giroCode).toHaveAccessibleDescription("Wirkt nicht auf Rechnungen: Das Layout „Schlicht“ verwendet qr nicht.");

    // GiroCode gibt es nur auf Rechnung und Mahnung; ohne qr in beiden Layouts ist er aus
    await zuordnen("Mahnung", "Schlicht Mahnung");
    await expect(giroCode).toBeDisabled();
    await expect(giroCode).toHaveAccessibleDescription("Die Layouts „Schlicht“ und „Schlicht Mahnung“ verwenden qr nicht.");
    await expect(blatt.getByText("Die Layouts „Schlicht“ und „Schlicht Mahnung“ verwenden qr nicht.")).toBeVisible();
    // Falzmarken wirken noch auf Angebot, Auftragsbestätigung und Lieferschein mit dem eingebauten Layout
    await expect(falzmarken).toBeEnabled();
    await expect(falzmarken).toHaveAccessibleDescription(/^Wirkt nicht auf Rechnungen und Mahnungen: /);
    await expect(blatt.getByRole("checkbox", { name: "Kundennummer" })).toHaveAccessibleDescription("");
    expect(await axeVerstoesse(page)).toEqual([]);
  } finally {
    // Löschen setzt die Zuordnung auf das eingebaute Layout zurück
    for (const name of ["Schlicht", "Schlicht Mahnung"]) {
      await karte
        .getByRole("listitem")
        .filter({ has: page.getByText(name, { exact: true }) })
        .getByRole("button", { name: "Löschen" })
        .click();
      await page
        .getByRole("dialog", { name: `Layout „${name}“ löschen?` })
        .getByRole("button", { name: "Layout löschen" })
        .click();
      await expect(karte.getByText(name, { exact: true })).toHaveCount(0);
    }
  }
  await go("/einstellungen?bereich=gestaltung");
  await expect(giroCode).toBeEnabled();
  await expect(giroCode).toHaveAccessibleDescription("");
});

test("Ansprechpartner: am Kontakt anlegen, in der Rechnung wählen und festschreiben; die Rechnung behält den Stand (#424)", async () => {
  await go("/kontakte");
  await go(
    (await page
      .getByRole("link", { name: /Rheinpixel GmbH/ })
      .first()
      .getAttribute("href"))!,
  );
  const karte = page.getByRole("region", { name: "Ansprechpartner" });
  await karte.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();
  const neu = karte.getByRole("form", { name: "Neuer Ansprechpartner" });
  await neu.getByLabel("Name").fill("Mara Beispiel");
  await neu.getByLabel("E-Mail").fill("mara@rheinpixel.example");
  await neu.getByLabel("Telefon").fill("+49 221 7654321");
  await neu.getByLabel("Funktion").fill("Einkauf");
  await neu.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Ansprechpartner angelegt.")).toBeVisible();
  await expect(karte).toContainText("Einkauf · mara@rheinpixel.example · +49 221 7654321");

  // Ein Kunde ohne Ansprechpartner bekommt das Feld nicht
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page, "Nordwerk Software GmbH · Hamburg");
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" })).toHaveCount(0);

  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  const feld = page.getByRole("combobox", { name: "Ansprechpartner" });
  // Genau ein aktiver Ansprechpartner: gleich gewählt und abwählbar (#1335)
  await expect(feld.locator("option:checked")).toHaveText("Mara Beispiel");
  await feld.selectOption({ label: "Keiner" });
  await expect(feld).toHaveValue("");
  await feld.selectOption({ label: "Mara Beispiel" });
  await page.getByLabel("Beschreibung Position 1").fill("Wartung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("300");
  await page.getByRole("button", { name: "Entwurf speichern" }).first().click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  // Gespeichert: die Auswahl steht nach dem Neuladen noch da
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" }).locator("option:checked")).toHaveText("Mara Beispiel");
  await page.getByRole("button", { name: "Festschreiben" }).first().click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const id = /rechnungen\/([0-9a-f-]{36})/.exec(page.url())![1];
  const buyer = (xml: string) => /<ram:BuyerTradeParty>([\s\S]*?)<\/ram:BuyerTradeParty>/.exec(xml)![1]!;
  const xml = await (await page.request.get(`/api/rechnung/${id}/xml`)).text();
  expect(buyer(xml)).toContain("<ram:PersonName>Mara Beispiel</ram:PersonName>");

  // Die Person ändert sich und wird deaktiviert; die festgeschriebene Rechnung behält den Stand
  await go("/kontakte");
  await go(
    (await page
      .getByRole("link", { name: /Rheinpixel GmbH/ })
      .first()
      .getAttribute("href"))!,
  );
  await karte.getByRole("button", { name: "Mara Beispiel ändern" }).click();
  const aendern = karte.getByRole("form", { name: "Ansprechpartner ändern" });
  await aendern.getByLabel("Name").fill("Mara Beispielmann");
  await aendern.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Ansprechpartner gespeichert.")).toBeVisible();
  await karte.getByRole("button", { name: "Mara Beispielmann deaktivieren" }).click();
  // exact (case-sensitive, ganzes Wort): sonst trifft der Substring auch den Hinweis „Wer nicht mehr dabei ist, wird deaktiviert.“ (#881)
  await expect(karte.getByText("deaktiviert", { exact: true })).toBeVisible();
  expect(buyer(await (await page.request.get(`/api/rechnung/${id}/xml`)).text())).toContain("<ram:PersonName>Mara Beispiel</ram:PersonName>");

  // Eine deaktivierte Person wird im neuen Entwurf nicht mehr angeboten
  await page.goto("/rechnungen/neu", { waitUntil: "networkidle" });
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" })).toHaveCount(0);
});

test("Ansprechpartner: der einzige aktive ist in Rechnung und Angebot gleich gewählt, bei zweien keiner (#1335)", async () => {
  await go("/kontakte");
  const kontakt = (await page
    .getByRole("link", { name: /Rheinpixel GmbH/ })
    .first()
    .getAttribute("href"))!;
  await go(kontakt);
  const karte = page.getByRole("region", { name: "Ansprechpartner" });
  // Mara Beispielmann ist deaktiviert (#424): Jonas ist danach der einzige aktive
  await karte.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();
  const neu = karte.getByRole("form", { name: "Neuer Ansprechpartner" });
  await neu.getByLabel("Name").fill("Jonas Muster");
  await neu.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Ansprechpartner angelegt.")).toBeVisible();

  // „Rechnung schreiben“ am Kontakt (#1557): Kunde und Ansprechpartner stehen schon
  await page.getByRole("link", { name: "Rechnung schreiben" }).click();
  await page.waitForURL(/rechnungen\/neu/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" }).locator("option:checked")).toHaveText("Jonas Muster");

  // Angebot: beim Wählen des Kunden ebenso
  await go("/angebote/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" }).locator("option:checked")).toHaveText("Jonas Muster");

  // Zwei aktive: Haben wählt nicht für dich
  await go(kontakt);
  await karte.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();
  await neu.getByLabel("Name").fill("Lea Beispiel");
  await neu.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Ansprechpartner angelegt.")).toBeVisible();
  await go("/angebote/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await expect(page.getByRole("combobox", { name: "Ansprechpartner" })).toHaveValue("");
});

test("Rechnungsdatum vor der letzten festgeschriebenen Rechnung: Warnung beim Festschreiben ohne Sperre (#713)", async () => {
  await rechnungFestschreiben(page, {
    customer: "Rheinpixel GmbH · Köln",
    date: "2026-11-09",
    lines: [["Beratung", "1", "500,00"]],
    gross: "595,00",
  });

  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await page.getByLabel("Rechnungsdatum").fill("2026-10-01");
  await page.getByLabel("Beschreibung Position 1").fill("Rückdatierte Leistung");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("200");

  await page.getByRole("button", { name: "Festschreiben", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toContainText("Das Rechnungsdatum (01.10.2026) liegt vor der zuletzt festgeschriebenen Rechnung");
  await expect(dialog.getByRole("status")).toContainText("vom 09.11.2026");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();

  // Datum in der Vergangenheit allein (anderer Nummernkreis ohne Rechnung) warnt nicht
  await page.getByLabel("Rechnungsdatum").fill("2024-12-15");
  await page.getByRole("button", { name: "Festschreiben", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();

  // Warnung sperrt nicht: Festschreiben bleibt möglich
  await page.getByLabel("Rechnungsdatum").fill("2026-10-01");
  await page.getByRole("button", { name: "Festschreiben", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("01.10.2026");
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText("Festgeschrieben", { exact: true })).toBeVisible();

  // Rückweg zur Buchung (#1855): unter Angaben „Im Journal“, die Zeile im Journal hervorgehoben
  await page
    .locator("section[aria-labelledby=facts-heading]")
    .getByRole("link", { name: /^Buchung vom / })
    .click();
  await page.waitForURL(/\/buchungen\?.*#buchung-/);
  await expect(page.locator('tr[aria-current="true"]')).toContainText("Rechnung");
  await expect(page.locator('tr[aria-current="true"]')).toBeFocused();
});

test("Seiten mit den Daten dieses Abschnitts ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, ["/kasse"]);
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
