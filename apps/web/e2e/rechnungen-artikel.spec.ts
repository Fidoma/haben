import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { day } from "./daten.ts";
import { type Durchlauf, databaseUrlFuer } from "./durchlaeufe.ts";
import { HANDY } from "./kopfzeile.ts";
import {
  artikelEinfuegen,
  artikelInPosition,
  axeVerstoesse,
  bestaetigen,
  durchlaufSeite,
  gehe,
  kundeWaehlen,
  ohneAxeVerstoesse,
  trefferliste,
  randImDialog,
} from "./einrichtung.ts";
import { abzugEinspielen } from "./abzug.ts";

/**
 * Abschnitt von rechnungen (#1742) mit eigenem Server und eigener Datenbank, parallel zu den anderen Abschnitten:
 * Artikel, Einheiten, Positionstexte, Textbausteine und Textknöpfe, Absenderzeile, Bruttopreise und die Suche nach
 * Kunden und Artikeln (#359).
 * Beginnt mit dem Abzug nach der Einrichtung mit drei Kunden und einer festgeschriebenen Rechnung in rechnungen.spec.ts
 * (e2e/abzug.ts).
 */

const DURCHLAUF = "rechnungen-artikel" satisfies Durchlauf;

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

test("Artikelkatalog: anlegen und im Rechnungseditor einfügen", async () => {
  await go("/artikel");
  await page.locator(".page-head").getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Beratung Softwarearchitektur");
  await form.getByLabel("Artikelnummer (optional)").fill("B-01");
  await form.getByLabel("Preis (€)").fill("110,00");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Artikel angelegt." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("110,00\u00a0€ je Std.");

  // Im Editor ersetzt der Artikel die leere erste Zeile; gespeichert wird nichts
  await go("/rechnungen/neu");
  await artikelEinfuegen(page, "Beratung Softwarearchitektur");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
  // Die Artikelnummer geht in die Position über (BT-155, #388)
  await expect(page.getByLabel("Artikelnummer Position 1 (optional)")).toHaveValue("B-01");
  // Bereits im Katalog: nicht noch einmal speichern
  await expect(page.getByRole("button", { name: "Position 1 als Artikel speichern" })).toBeDisabled();

  // Auswahl aus der Trefferliste der Position: die Bezeichnung übernimmt Einheit und Preis
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await artikelInPosition(page, 2, "Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("110,00");
  await expect(page.getByLabel("Artikelnummer Position 2 (optional)")).toHaveValue("B-01");

  // Eine neue Position als Artikel speichern; danach steht sie im Katalog
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("Beschreibung Position 3").fill("Wartungspauschale");
  await page.getByLabel(/Einzelpreis Position 3/).fill("250,00");
  await page.getByRole("button", { name: "Position 3 als Artikel speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "„Wartungspauschale“ ist jetzt im Artikelkatalog." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Position 3 als Artikel speichern" })).toBeDisabled();
  await page.getByLabel("Aus dem Artikelkatalog einfügen").fill("Wartungspauschale");
  await expect(trefferliste(page).getByRole("option", { name: "Wartungspauschale" })).toContainText("250,00");
});

test("Eigene Einheiten: in den Einstellungen anlegen, im Artikel und in der Rechnung wählen, Code im XML (#748)", async () => {
  await go("/einstellungen?bereich=rechnungen");
  const karte = page.getByRole("region", { name: "Einheiten" });
  // Bezeichnung und Code nach UN/ECE Rec. 20 eintippen; danach steht die Einheit mit ihrem Code in der Tabelle
  await karte.getByLabel("Bezeichnung").fill("m²");
  await karte.getByLabel("Code (UN/ECE Rec. 20)").fill("MTK");
  await karte.getByRole("button", { name: "Einheit anlegen" }).click();
  await expect(karte.getByRole("status").filter({ hasText: "Einheit „m²“ angelegt." })).toBeVisible();
  await expect(karte.getByRole("row", { name: /m²\s+MTK/ })).toBeVisible();
  await expect(karte.getByLabel("Bezeichnung")).toHaveValue("");
  // Groß- und Kleinschreibung zählen nicht: neben m² kein M²
  await karte.getByLabel("Bezeichnung").fill("M²");
  await expect(karte.getByText("Die Einheit „M²“ gibt es schon")).toBeVisible();
  await karte.getByLabel("Bezeichnung").fill("");
  // Ohne Code nennt das Feld, was fehlt, statt den Knopf zu sperren (DESIGN.md, Gesperrte Knöpfe)
  await karte.getByLabel("Bezeichnung").fill("UE");
  await karte.getByRole("button", { name: "Einheit anlegen" }).click();
  await expect(karte.getByLabel("Code (UN/ECE Rec. 20)")).toBeFocused();
  await expect(karte.getByText("Gib den Code ein, ohne passenden C62.")).toBeVisible();
  await karte.getByLabel("Code (UN/ECE Rec. 20)").fill("c62");
  await karte.getByRole("button", { name: "Einheit anlegen" }).click();
  await expect(karte.getByRole("status").filter({ hasText: "Einheit „UE“ angelegt." })).toBeVisible();
  await expect(karte.getByRole("row", { name: /UE\s+C62/ })).toBeVisible();
  // Eine feste Einheit lässt sich nicht noch einmal anlegen
  await karte.getByLabel("Bezeichnung").fill("std.");
  await expect(karte.getByText("Die Einheit „std.“ gibt es schon")).toBeVisible();
  await karte.getByLabel("Bezeichnung").fill("");
  // Archiviert steht m² nicht mehr zur Auswahl
  await karte.getByRole("row", { name: /m²/ }).getByRole("button", { name: "Archivieren" }).click();
  await expect(karte.getByRole("row", { name: /m² \(archiviert\)/ })).toBeVisible();

  await go("/artikel");
  await page.locator(".page-head").getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await expect(form.getByLabel("Einheit").locator("option", { hasText: "m²" })).toHaveCount(0);
  await form.getByLabel("Bezeichnung").fill("Nachhilfe Mathematik");
  await form.getByLabel("Einheit").selectOption("UE");
  await form.getByLabel("Preis (€)").fill("25,00");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("25,00\u00a0€ je UE");

  await go("/rechnungen/neu");
  await kundeWaehlen(page);
  await artikelEinfuegen(page, "Nachhilfe Mathematik");
  await expect(page.getByLabel("Einheit Position 1")).toHaveValue("UE");
  await expect(page.getByLabel("Einheit Position 1").locator("option", { hasText: "m²" })).toHaveCount(0);
  await page.getByLabel("Menge Position 1").fill("2");
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText("2 UE");
  await page.getByRole("button", { name: "Entwurf speichern" }).first().click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).first().click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const id = /rechnungen\/([0-9a-f-]{36})/.exec(page.url())![1];
  const xml = await (await page.request.get(`/api/rechnung/${id}/xml`)).text();
  expect(xml).toContain('<ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity>');
});

test("Positionstext: Artikel mit Bezeichnung und Text, die Vorschau zeigt beides", async () => {
  await go("/artikel");
  await page.locator(".page-head").getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Website-Relaunch");
  await form.getByLabel("Text zur Position (optional)").fill("Konzeption, Design und Umsetzung");
  await form.getByLabel("Artikelnummer (optional)").fill("W-01");
  await form.getByLabel("Preis (€)").fill("4.800,00");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Artikel angelegt." })).toBeVisible();

  // Aus dem Katalog: Bezeichnung und Text des Artikels in die Position
  await go("/rechnungen/neu");
  await artikelEinfuegen(page, "Website-Relaunch");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Website-Relaunch");
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("Konzeption, Design und Umsetzung");
  await expect(page.getByRole("button", { name: "Position 1 als Artikel speichern" })).toBeDisabled();

  // Auswahl in der Bezeichnung: ebenso, dazu Preis und Einheit
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await artikelInPosition(page, 2, "Website-Relaunch");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("4.800,00");
  await expect(page.getByLabel("Text zu Position 2 (optional)")).toHaveValue("Konzeption, Design und Umsetzung");

  // Eigener Text: in der Vorschau unter der Bezeichnung, die Position ist dann nicht mehr die aus dem Katalog
  await page.getByLabel("Text zu Position 2 (optional)").fill("Nachtrag laut Bestellung 4500123456\nAbnahme am 30.09.");
  await expect(page.locator(".sheet").getByText("Nachtrag laut Bestellung 4500123456")).toBeVisible();
  await expect(page.getByRole("button", { name: "Position 2 als Artikel speichern" })).toBeEnabled();
});

test("Positionstext: über 500 Zeichen lässt sich die Position als Artikel speichern und kommt vollständig zurück", async () => {
  // Artikel und Positionen fassen denselben Text (LINE_DETAIL_MAX), die Bezeichnung bleibt bei 500 Zeichen
  const leistungsumfang = "Leistungsumfang ".repeat(40).trim();
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Wartungsvertrag");
  await page.getByLabel(/Einzelpreis Position 1/).fill("90,00");
  await page.getByLabel("Text zu Position 1 (optional)").fill(leistungsumfang);
  await page.getByRole("button", { name: "Position 1 als Artikel speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "„Wartungsvertrag“ ist jetzt im Artikelkatalog." })).toBeVisible();
  await artikelEinfuegen(page, "Wartungsvertrag");
  await expect(page.getByLabel("Text zu Position 2 (optional)")).toHaveValue(leistungsumfang);
});

test("Positionstext: ein einzeiliger Artikel lässt bei der Auswahl den eigenen Text der Position stehen", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Text zu Position 1 (optional)").fill("laut Bestellung 4500123456");
  await artikelInPosition(page, 1, "Beratung Softwarearchitektur");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("110,00");
  await expect(page.getByLabel("Text zu Position 1 (optional)")).toHaveValue("laut Bestellung 4500123456");
});

test("Textbausteine: Kopftext für einen Kunden anlegen und im Rechnungseditor einfügen", async () => {
  await go("/textbausteine");
  await page.locator(".page-head").getByRole("button", { name: "Neuer Textbaustein" }).click();
  const form = page.getByRole("form", { name: "Neuer Textbaustein" });
  await form.getByLabel("Bezeichnung").fill("Bestellnummer Nordwerk");
  await form.getByRole("textbox", { name: "Text", exact: true }).fill("Bestellnummer 4500012345 laut Rahmenvertrag 2026.");
  // Leeres Feld heißt „für alle Kunden“; erst die Wahl macht den Baustein zum Baustein dieses Kunden
  const kundenfeld = form.getByRole("combobox", { name: "Kunde (optional)" });
  await expect(kundenfeld).toHaveAttribute("placeholder", "Für alle Kunden");
  await expect(kundenfeld).toHaveValue("");
  await kundenfeld.fill("Nordwerk");
  await trefferliste(page)
    .getByRole("option", { name: /Nordwerk Software GmbH/ })
    .click();
  await kundenfeld.fill("");
  await kundenfeld.blur();
  await expect(kundenfeld).toHaveValue("");
  await kundenfeld.fill("Nordwerk");
  await trefferliste(page)
    .getByRole("option", { name: /Nordwerk Software GmbH/ })
    .click();
  await expect(form.getByRole("combobox", { name: "Kunde (optional)" })).toHaveValue("Nordwerk Software GmbH · Hamburg");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("region", { name: "Textbausteine" })).toContainText("Bestellnummer Nordwerk");

  // Für diesen Kunden steht der Baustein oben; eingefügt wird eine Kopie in die Einleitung, gespeichert wird nichts
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Nordwerk Software GmbH · Hamburg");
  const insert = page.getByLabel("Kopftext aus den Textbausteinen einfügen");
  await expect(insert.locator('optgroup[label="Für diesen Kunden"] option')).toHaveText(["Bestellnummer Nordwerk"]);
  await insert.selectOption({ label: "Bestellnummer Nordwerk" });
  await expect(page.getByLabel("Einleitung über den Positionen (optional)")).toHaveValue("Bestellnummer 4500012345 laut Rahmenvertrag 2026.");
  await expect(insert).toHaveValue("");
});

// Die allgemeine Regel für Knopfzeilen (Knöpfe füllen die Zeile) steht vor der des Seitenkopfs und darf sie nicht schlagen: Im
// Kopf scrollt die Zeile am Handy seitlich, die Knöpfe schrumpfen nicht und ihre Beschriftung bricht nicht um (DESIGN.md › Seitenkopf)
test("Handy: Knöpfe im Seitenkopf schrumpfen nicht, die Zeile scrollt seitlich", async () => {
  const vorher = page.viewportSize();
  await page.setViewportSize(HANDY);
  try {
    await go("/bank");
    const knoepfe = page.locator(".main > .page-head .actions > .btn");
    await expect(knoepfe.first()).toBeVisible();
    const schrumpfen = await knoepfe.evaluateAll((alle) => alle.map((k) => getComputedStyle(k).flexShrink));
    expect(schrumpfen).toEqual(schrumpfen.map(() => "0"));
  } finally {
    if (vorher) await page.setViewportSize(vorher);
  }
});

test("Textknöpfe: Auswahl per Knopf und Kürzel auszeichnen, Strg+Z nimmt es zurück, Leiste an der Markierung", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const fett = page.getByRole("button", { name: "Fett", exact: true });
  await expect(fett).toBeHidden();

  await einleitung.fill("Vielen Dank für Ihren Auftrag");
  await einleitung.focus();
  // Ohne Markierung keine Leiste, auch nicht im Feld
  await expect(fett).toBeHidden();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 20));
  await expect(fett).toBeVisible();
  await fett.click();
  await expect(einleitung).toHaveValue("Vielen Dank für *Ihren* Auftrag");
  await expect(einleitung).toBeFocused();
  await expect(page.locator(".sheet")).toContainText("Vielen Dank für Ihren Auftrag");

  await page.keyboard.press("ControlOrMeta+i");
  await expect(einleitung).toHaveValue("Vielen Dank für *_Ihren_* Auftrag");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(einleitung).toHaveValue("Vielen Dank für *Ihren* Auftrag");
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 22));
  await fett.click();
  await expect(einleitung).toHaveValue("Vielen Dank für Ihren Auftrag");

  const verstoesse = await new AxeBuilder({ page }).include(".format-field:focus-within").analyze();
  expect(verstoesse.violations).toEqual([]);

  // Per Tastatur: ein Tabstopp für die Leiste, darin die Pfeiltasten
  const detail = page.getByLabel("Text zu Position 1 (optional)");
  await detail.fill("Wartung");
  await detail.focus();
  await detail.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(0, 7));
  await expect(fett).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(fett).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Kursiv", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(detail).toHaveValue("_Wartung_");
  await expect(detail).toBeFocused();
});

test("Textknöpfe: Leiste folgt der Markierung und schließt mit Esc", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  await einleitung.fill("Erstes Wort weit vorn und ein ganz anderes am Ende der Zeile");
  await einleitung.focus();
  const markiere = (start: number, end: number) => einleitung.evaluate((feld: HTMLTextAreaElement, [a, b]) => feld.setSelectionRange(a!, b!), [start, end]);

  await markiere(0, 6);
  await expect(leiste).toBeVisible();
  const links = (await leiste.boundingBox())!;
  const feld = (await einleitung.boundingBox())!;
  // Über der ersten Zeile, also oberhalb des Felds
  expect(links.y + links.height).toBeLessThanOrEqual(feld.y + 12);

  await markiere(50, 55);
  await expect.poll(async () => (await leiste.boundingBox())!.x).toBeGreaterThan(links.x + 100);

  await page.keyboard.press("Escape");
  await expect(leiste).toBeHidden();
  await markiere(0, 6);
  await expect(leiste).toBeVisible();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(3, 3));
  await expect(leiste).toBeHidden();
});

test("Textknöpfe: Doppelklick am rechten Rand markiert das Wort, das dort stand, bevor das Feld den Fokus hatte", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const woerter = Array.from({ length: 20 }, (_, i) => `wort${String(i).padStart(2, "0")}`);
  await einleitung.fill(woerter.join(" "));
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.blur());
  await einleitung.scrollIntoViewIfNeeded();

  // Wo das letzte Wort der ersten Zeile steht, solange das Feld keinen Fokus hat
  const ziel = await einleitung.evaluate((feld: HTMLTextAreaElement, liste: string[]) => {
    const stil = getComputedStyle(feld);
    const messen = document.createElement("canvas").getContext("2d")!;
    messen.font = stil.font;
    const links = parseFloat(stil.paddingLeft);
    const breite = feld.clientWidth - links - parseFloat(stil.paddingRight);
    let anzahl = 1;
    while (messen.measureText(liste.slice(0, anzahl + 1).join(" ")).width <= breite) anzahl++;
    const davor = messen.measureText(`${liste.slice(0, anzahl - 1).join(" ")} `).width;
    const box = feld.getBoundingClientRect();
    return {
      wort: liste[anzahl - 1]!,
      x: box.left + feld.clientLeft + links + davor + messen.measureText(liste[anzahl - 1]!).width / 2,
      y: box.top + feld.clientTop + parseFloat(stil.paddingTop) + parseFloat(stil.fontSize) / 2,
    };
  }, woerter);

  await page.mouse.dblclick(ziel.x, ziel.y);
  const markiert = await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.value.slice(feld.selectionStart, feld.selectionEnd).trim());
  expect(markiert).toBe(ziel.wort);
  await einleitung.fill("");
});

test("Wiederkehrende Rechnung: die Vorschau zeigt die Auszeichnung statt der Zeichen", async () => {
  await go("/rechnungen/wiederkehrend/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Hosting");
  const text = page.getByLabel("Text zu Position 1 (optional)");
  await text.fill("Wartung");
  await text.focus();
  await text.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(0, 7));
  await page.getByRole("button", { name: "Fett", exact: true }).click();
  await expect(text).toHaveValue("*Wartung*");

  const vorschau = page.getByRole("region", { name: "Vorschau" });
  await expect(vorschau).toContainText("Wartung");
  await expect(vorschau).not.toContainText("*Wartung*");
});

test("Textknöpfe: Esc auf einem Knopf schließt die Leiste und führt zurück ins Feld", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  await einleitung.fill("Vielen Dank für Ihren Auftrag");
  await einleitung.focus();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 20));
  await expect(leiste).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Fett", exact: true })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(einleitung).toBeFocused();
  await expect(leiste).toBeHidden();
  await einleitung.fill("");
});

test("Textknöpfe: am ersten Wort einer umbrochenen Zeile steht die Leiste über dem Wort, nicht am Ende der Zeile davor", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  const woerter = Array.from({ length: 40 }, (_, i) => `wort${String(i).padStart(2, "0")}`);
  await einleitung.fill(woerter.join(" "));
  await einleitung.focus();

  // Wie viele Wörter in die erste Zeile passen; das nächste beginnt die zweite Zeile
  const start = await einleitung.evaluate((feld: HTMLTextAreaElement, liste: string[]) => {
    const stil = getComputedStyle(feld);
    const messen = document.createElement("canvas").getContext("2d")!;
    messen.font = stil.font;
    const breite = feld.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight);
    let anzahl = 1;
    while (messen.measureText(liste.slice(0, anzahl + 1).join(" ")).width <= breite) anzahl++;
    return liste.slice(0, anzahl).join(" ").length + 1;
  }, woerter);
  await einleitung.evaluate((feld: HTMLTextAreaElement, von: number) => feld.setSelectionRange(von, von + 6), start);

  await expect(leiste).toBeVisible();
  const box = (await leiste.boundingBox())!;
  const feld = (await einleitung.boundingBox())!;
  expect(box.x - feld.x).toBeLessThan(40);
  await einleitung.fill("");
});

test("Textknöpfe: ein Klick zwischen die Knöpfe lässt Leiste und Markierung stehen", async () => {
  await go("/rechnungen/neu");
  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  const leiste = page.getByRole("toolbar", { name: "Textformatierung" });
  await einleitung.fill("Vielen Dank für Ihren Auftrag");
  await einleitung.focus();
  await einleitung.evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(17, 20));
  await expect(leiste).toBeVisible();

  const fett = (await page.getByRole("button", { name: "Fett", exact: true }).boundingBox())!;
  await page.mouse.click(fett.x + fett.width + 1, fett.y + fett.height / 2);

  await expect(einleitung).toBeFocused();
  await expect(leiste).toBeVisible();
  await einleitung.fill("");
});

test("Artikel und Textbausteine: die Liste zeigt die Auszeichnung statt der Zeichen", async () => {
  await go("/artikel");
  await page.locator(".page-head").getByRole("button", { name: "Neuer Artikel" }).click();
  const artikel = page.getByRole("form", { name: "Neuer Artikel" });
  await artikel.getByLabel("Bezeichnung").fill("Wartung mit Auszeichnung");
  await artikel.getByLabel("Text zur Position (optional)").fill("Monatliche Wartung");
  await artikel.getByLabel("Text zur Position (optional)").evaluate((feld: HTMLTextAreaElement) => feld.setSelectionRange(0, 10));
  await artikel.getByLabel("Text zur Position (optional)").focus();
  await artikel.getByRole("button", { name: "Fett", exact: true }).click();
  await expect(artikel.getByLabel("Text zur Position (optional)")).toHaveValue("*Monatliche* Wartung");
  await artikel.getByLabel("Preis (€)").fill("10,00");
  await artikel.getByRole("button", { name: "Anlegen" }).click();
  const zeile = page.locator(".table-row").filter({ hasText: "Wartung mit Auszeichnung" });
  await expect(zeile.locator("strong").filter({ hasText: "Monatliche" })).toBeVisible();
  await expect(zeile).not.toContainText("*Monatliche*");

  await go("/textbausteine");
  await page.locator(".page-head").getByRole("button", { name: "Neuer Textbaustein" }).click();
  const baustein = page.getByRole("form", { name: "Neuer Textbaustein" });
  await baustein.getByLabel("Bezeichnung").fill("Baustein mit Auszeichnung");
  await baustein.getByRole("textbox", { name: "Text", exact: true }).fill("Bitte *sofort* zahlen");
  await baustein.getByRole("button", { name: "Anlegen" }).click();
  const liste = page.getByRole("region", { name: "Textbausteine" });
  await expect(liste.locator("strong").filter({ hasText: "sofort" })).toBeVisible();
  await expect(liste).not.toContainText("*sofort*");
});

/** Ob der Knopf in der Mitte wirklich oben liegt; verdeckt oder abgeschnitten bliebe er für Maus und Finger unerreichbar */
function liegtObenAuf(p: Page): Promise<boolean> {
  return p.getByRole("button", { name: "Fett", exact: true }).evaluate((knopf) => {
    const rect = knopf.getBoundingClientRect();
    return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[role="toolbar"]');
  });
}

test("Textknöpfe: auf dem Handy liegt die Leiste auch bei einem hochgescrollten Feld nicht hinter der Navigation", async ({ browser }) => {
  // Mit offener Tastatur bleibt auf dem Handy nur rund die halbe Höhe
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: HANDY.width, height: 420 },
    hasTouch: true,
    isMobile: true,
  });
  const handy = await context.newPage();
  await gehe(handy, "/textbausteine");
  await handy.locator(".page-head").getByRole("button", { name: "Neuer Textbaustein" }).click();
  const text = handy.getByRole("form", { name: "Neuer Textbaustein" }).getByLabel("Text", { exact: true });
  await text.fill(["eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "Wartung"].join("\n"));
  const zeileZuSehen = await text.evaluate((feld: HTMLTextAreaElement) => {
    // Das Feld steht oben unter der Navigation, sein unteres Ende ist noch zu sehen und wird markiert
    window.scrollBy(0, feld.getBoundingClientRect().top - 40);
    feld.focus({ preventScroll: true });
    feld.setSelectionRange(feld.value.length - 7, feld.value.length);
    feld.scrollTop = feld.scrollHeight;
    const rect = feld.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 8) === feld;
  });
  expect(zeileZuSehen, "die markierte Zeile ist nicht verdeckt").toBe(true);
  await expect(handy.getByRole("toolbar", { name: "Textformatierung" })).toBeVisible();
  expect(await liegtObenAuf(handy)).toBe(true);
  await context.close();
});

test("Textknöpfe: im gescrollten Artikel-Dialog schneidet der Rand die Leiste nicht ab, Esc auf einem Knopf lässt den Dialog offen", async () => {
  await go("/rechnungen/neu");
  const beschreibung = page.getByLabel("Beschreibung Position 1");
  await beschreibung.fill("Lektorat im Dialog");
  await trefferliste(page).getByRole("option", { name: "„Lektorat im Dialog“ als neuen Artikel anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Neuen Artikel anlegen" });
  const text = dialog.getByLabel("Text zur Position (optional)");
  await text.fill("Wartung");
  // Niedriges Fenster, etwa ein Handy quer oder mit offener Tastatur: Das Formular im Dialog scrollt
  await page.setViewportSize({ width: 1280, height: 460 });
  try {
    await text.evaluate((feld: HTMLTextAreaElement) => {
      const form = feld.closest("form")!;
      form.scrollTop += feld.getBoundingClientRect().top - form.getBoundingClientRect().top;
      feld.focus({ preventScroll: true });
      feld.setSelectionRange(0, 7);
    });
    const leiste = dialog.getByRole("toolbar", { name: "Textformatierung" });
    await expect(leiste).toBeVisible();
    expect(await liegtObenAuf(page)).toBe(true);

    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Fett", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(leiste).toBeHidden();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test("Standard-Textbaustein: je für Rechnungen und Angebote vorbelegt und änderbar, für Mahnungen je Stufe, archiviert kein Standard mehr (#1494, #1678)", async () => {
  const standardBaustein = async (name: string, text: string, standardFuer: string) => {
    await go("/textbausteine");
    await page.locator(".page-head").getByRole("button", { name: "Neuer Textbaustein" }).click();
    const formular = page.getByRole("form", { name: "Neuer Textbaustein" });
    await formular.getByLabel("Bezeichnung").fill(name);
    await formular.getByLabel("Art").selectOption("kopf");
    await formular.getByLabel("Text", { exact: true }).fill(text);
    await formular.getByLabel("Standard für").selectOption({ label: standardFuer });
    await formular.getByRole("button", { name: "Anlegen" }).click();
    await expect(page.getByText("Textbaustein angelegt.")).toBeVisible();
  };
  await standardBaustein("Einleitung Rechnung", "Für die erbrachten Leistungen berechne ich Ihnen:", "Rechnungen");
  await standardBaustein("Einleitung Angebot", "Gerne biete ich Ihnen an:", "Angebote");
  await expect(page.getByRole("region", { name: "Textbausteine" })).toContainText("Standard für Rechnungen");
  await standardBaustein("Einleitung letzte Mahnung", "Trotz Erinnerung und Mahnung ist die Rechnung weiter offen.", "Mahnungen: Letzte Mahnung");
  await expect(page.locator(".table-row").filter({ hasText: "Einleitung letzte Mahnung" })).toContainText("Standard für Mahnungen: Letzte Mahnung");

  const einleitung = page.getByLabel("Einleitung über den Positionen (optional)");
  await go("/rechnungen/neu");
  await expect(einleitung).toHaveValue("Für die erbrachten Leistungen berechne ich Ihnen:");
  await einleitung.fill("Für das Projekt Relaunch berechne ich Ihnen:");
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText("Für das Projekt Relaunch berechne ich Ihnen:");
  await go("/angebote/neu");
  await expect(einleitung).toHaveValue("Gerne biete ich Ihnen an:");

  // Die folgenden Tests rechnen mit leerer Einleitung: archivierte Bausteine sind kein Standard mehr
  await go("/textbausteine");
  for (const name of ["Einleitung Rechnung", "Einleitung Angebot", "Einleitung letzte Mahnung"]) {
    await page.locator(".table-row").filter({ hasText: name }).getByRole("button", { name: "Archivieren" }).click();
    await expect(page.getByText("Textbaustein archiviert.")).toBeVisible();
  }
  await go("/rechnungen/neu");
  await expect(einleitung).toHaveValue("");
});

test("Absenderzeile: in der Vorschau von Rechnung und Angebot ganz zu sehen, lang umbrochen statt abgeschnitten (#518)", async () => {
  const firma = page.getByRole("form", { name: "Firmendaten" });
  const firmendaten = async (name: string, strasse: string, plz: string, ort: string) => {
    await go("/einstellungen");
    await firma.getByLabel("Name", { exact: true }).fill(name);
    await firma.getByLabel("Straße und Hausnummer").fill(strasse);
    await firma.getByLabel("PLZ").fill(plz);
    await firma.getByLabel("Ort").fill(ort);
    await firma.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
    await page.waitForLoadState("networkidle");
  };
  // Beispiel aus dem Issue, 81 Zeichen: im PDF bricht die Zeile im 85 mm breiten Anschriftfeld um
  const zeile = "Muster Consulting, Inh. Max Mustermann · Musterweg 8 · 09999 Musterhausen-Neudorf";
  await firmendaten("Muster Consulting, Inh. Max Mustermann", "Musterweg 8", "09999", "Musterhausen-Neudorf");
  try {
    for (const [pfad, vorschau] of [
      ["/rechnungen/neu", "Vorschau der Rechnung"],
      ["/angebote/neu", "Vorschau des Angebots"],
    ] as const) {
      await go(pfad);
      // Der Umbruch im 85 mm breiten Feld kommt jetzt aus derselben Vorlage wie das PDF
      await expect(page.getByLabel(vorschau)).toContainText(zeile);
    }
  } finally {
    await firmendaten("Mustermann IT · Max Mustermann", "Musterstraße 12", "93047", "Regensburg");
  }
});

test("Bruttopreise: Artikel mit Endpreis, Umrechnung beim Einfügen, Vorschau mit „darin enthalten“", async () => {
  await go("/artikel");
  await page.locator(".page-head").getByRole("button", { name: "Neuer Artikel" }).click();
  const form = page.getByRole("form", { name: "Neuer Artikel" });
  await form.getByLabel("Bezeichnung").fill("Fotoabzug 13 × 18 cm");
  await form.getByLabel("Einheit").selectOption("Stk.");
  await form.getByLabel("Preis (€)").fill("9,80");
  await form.getByLabel(/^Preis ist/).selectOption("brutto");
  await form.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("region", { name: "Artikelliste" })).toContainText("9,80\u00a0€ brutto je Stk.");

  // Netto-Rechnung: der Endpreis wird herausgerechnet
  await go("/rechnungen/neu");
  await artikelEinfuegen(page, "Fotoabzug 13 × 18 cm");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("8,24");

  // Brutto-Rechnung: der Endpreis bleibt, die Steuer steht unter dem Gesamtbetrag
  await page.getByLabel(/^Preise/).selectOption("brutto");
  await page.getByLabel(/Einzelpreis Position 1/).fill("9,80");
  const preview = page.getByLabel("Vorschau der Rechnung");
  await expect(preview).toContainText("Gesamtbetrag (inkl. USt): 9,80\u00a0€");
  await expect(preview).toContainText("darin enthalten");
  await expect(preview).toContainText("Umsatzsteuer 19 %: 1,56\u00a0€");
  await artikelEinfuegen(page, "Fotoabzug 13 × 18 cm");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("9,80");
});

test("Kunde suchen und mit Tastatur oder Maus wählen (#359)", async () => {
  await go("/rechnungen/neu");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  const treffer = trefferliste(page);

  // Suche nach dem Ort, Name und Ort stehen im Treffer
  await kunde.fill("hamburg");
  await expect(kunde).toHaveAttribute("aria-expanded", "true");
  await expect(treffer.getByRole("option", { name: "Nordwerk Software GmbH" })).toContainText("Hamburg");

  // Enter übernimmt den ersten Treffer und schickt das Formular nicht ab
  await kunde.fill("rhein");
  await page.keyboard.press("Enter");
  await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");
  await expect(kunde).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/rechnungen\/neu/);
  await expect(page.locator(".sheet").getByText("Rheinpixel GmbH")).toBeVisible();

  // Pfeile bewegen den aktiven Eintrag, der Fokus bleibt im Feld
  await kunde.fill("gmbh");
  const ersterAktiv = await kunde.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  await expect(kunde).not.toHaveAttribute("aria-activedescendant", ersterAktiv!);
  await expect(kunde).toBeFocused();

  // Escape schließt; ohne Auswahl bleibt der bisherige Kunde
  await page.keyboard.press("Escape");
  await expect(kunde).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("Beschreibung Position 1").click();
  await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");

  // Klick zeigt die Liste mit dem gewählten Kunden, die Maus wählt einen anderen
  await kunde.click();
  await expect(treffer.getByRole("option", { selected: true })).toContainText("Rheinpixel GmbH");
  await treffer.getByRole("option", { name: "Alpenblick Media AG" }).click();
  await expect(kunde).toHaveValue("Alpenblick Media AG · München");

  // Tab übernimmt den aktiven Treffer
  await kunde.fill("nordwerk");
  await page.keyboard.press("Tab");
  await expect(kunde).toHaveValue("Nordwerk Software GmbH · Hamburg");

  // Ein geleertes Feld nimmt den Kunden weg
  await kunde.fill("");
  await page.getByLabel("Beschreibung Position 1").click();
  await expect(kunde).toHaveValue("");
  await expect(page.locator(".sheet").getByText("Nordwerk Software GmbH")).toHaveCount(0);
});

test("Suchfeld: Klick neben den Feldnamen und Mausbewegung stören nicht (#359)", async () => {
  await go("/rechnungen/neu");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  const feldname = page.locator(".field-label", { hasText: /^Kunde$/ });

  // Der leere Bereich rechts vom Feldnamen gehört nicht zum Feld
  await kunde.scrollIntoViewIfNeeded();
  const feld = (await kunde.boundingBox())!;
  const name = (await feldname.boundingBox())!;
  const punkt = { x: feld.x + feld.width - 20, y: name.y + name.height / 2 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, punkt)).toBe("field");
  await page.mouse.click(punkt.x, punkt.y);
  await expect(kunde).not.toBeFocused();
  await expect(kunde).toHaveAttribute("aria-expanded", "false");

  // Der Feldname selbst fokussiert wie jedes Label, öffnet die Liste aber nicht
  await feldname.click();
  await expect(kunde).toBeFocused();
  await expect(kunde).toHaveAttribute("aria-expanded", "false");

  // Die Maus ändert den aktiven Eintrag der Tastatur nicht, sonst rendert jede Zeile das Feld neu
  await kunde.fill("gmbh");
  const aktiv = await kunde.getAttribute("aria-activedescendant");
  await trefferliste(page).getByRole("option").nth(1).hover();
  await expect(kunde).toHaveAttribute("aria-activedescendant", aktiv!);
  await page.keyboard.press("Escape");
});

test("Kunde aus der Trefferliste neu anlegen, ohne die Eingaben zu verlieren (#359)", async () => {
  await go("/rechnungen/neu");
  // Ohne Eingabe steht das Anlegen am Ende der Liste und öffnet den leeren Dialog, auch neben Treffern
  await page.getByRole("combobox", { name: "Kunde", exact: true }).click();
  await trefferliste(page).getByRole("option", { name: "Neuen Kontakt anlegen" }).click();
  const leer = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await expect(leer.getByLabel("Name oder Firma")).toHaveValue("");
  await leer.getByRole("button", { name: "Abbrechen" }).click();
  await expect(leer).toBeHidden();

  // Trotz Teiltreffer: „Rhein“ findet Rheinpixel, das Anlegen bleibt daneben angeboten
  await page.getByRole("combobox", { name: "Kunde", exact: true }).fill("Rhein");
  await expect(trefferliste(page).getByRole("option", { name: "Rheinpixel GmbH" })).toBeVisible();
  await expect(trefferliste(page).getByRole("option", { name: "„Rhein“ als neuen Kunden anlegen" })).toBeVisible();

  await page.getByLabel("Beschreibung Position 1").fill("Workshop Suche");
  await page.getByLabel("Rechnungsdatum").fill(day(-3));
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  await kunde.fill("Kieler Neukunde KG");
  await trefferliste(page).getByRole("option", { name: "„Kieler Neukunde KG“ als neuen Kunden anlegen" }).click();

  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Kieler Neukunde KG");
  await dialog.getByLabel("Ort").fill("Kiel");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();

  await expect(kunde).toHaveValue("Kieler Neukunde KG · Kiel");
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("Workshop Suche");
  await expect(page.getByLabel("Rechnungsdatum")).toHaveValue(day(-3));

  // Nicht speichern; den Kunden archivieren, damit die folgenden Tests mit den bisherigen Kunden rechnen
  await go("/kontakte");
  await page.getByRole("link", { name: /Kieler Neukunde KG/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

test("Artikel in der Position suchen: übernimmt Preis, Einheit und USt, bleibt änderbar, Neuanlage aus der Liste (#359)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Menge Position 1").fill("3");
  const beschreibung = page.getByLabel("Beschreibung Position 1");

  // Ein Klick zeigt den Katalog wie beim Kunden; vorgewählt ist nichts, denn die Eingabe bleibt frei
  await beschreibung.click();
  await expect(trefferliste(page).getByRole("option", { name: "Beratung Softwarearchitektur" })).toBeVisible();
  await expect(beschreibung).not.toHaveAttribute("aria-activedescendant", /.+/);
  // Das Anlegen steht immer am Ende, auch neben Treffern; ein schon vorhandener Name wird nicht angeboten
  await expect(trefferliste(page).getByRole("option", { name: "Neuen Artikel anlegen" })).toBeVisible();
  await beschreibung.fill("Beratung");
  await expect(trefferliste(page).getByRole("option", { name: "Beratung Softwarearchitektur" })).toBeVisible();
  await expect(trefferliste(page).getByRole("option", { name: "„Beratung“ als neuen Artikel anlegen" })).toBeVisible();
  await beschreibung.fill("beratung softwarearchitektur");
  await expect(trefferliste(page).getByRole("option", { name: "als neuen Artikel anlegen" })).toHaveCount(0);
  await expect(trefferliste(page).getByRole("option", { name: "Neuen Artikel anlegen" })).toBeVisible();
  await beschreibung.fill("");
  await page.keyboard.press("Escape");
  await expect(trefferliste(page)).toBeHidden();

  // Nichts passt: anlegen im Dialog, die Position übernimmt den neuen Artikel
  await beschreibung.fill("Lektorat Fachtext");
  await trefferliste(page).getByRole("option", { name: "„Lektorat Fachtext“ als neuen Artikel anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Neuen Artikel anlegen" });
  await expect(dialog.getByLabel("Bezeichnung")).toHaveValue("Lektorat Fachtext");
  await randImDialog(dialog, [dialog.getByLabel("Bezeichnung"), dialog.getByRole("button", { name: "Anlegen" })]);
  await dialog.getByLabel("Artikelnummer (optional)").fill("L-07");
  await dialog.getByLabel("Einheit").selectOption("Stk.");
  await dialog.getByLabel("Preis (€)").fill("45,00");
  await dialog.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("700");
  await dialog.getByRole("button", { name: "Anlegen" }).click();
  await expect(dialog).toBeHidden();
  await expect(beschreibung).toHaveValue("Lektorat Fachtext");
  await expect(page.getByLabel("Artikelnummer Position 1 (optional)")).toHaveValue("L-07");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("45,00");
  await expect(page.getByLabel("Einheit Position 1")).toHaveValue("Stk.");
  await expect(page.getByLabel("Steuersatz Position 1")).toHaveValue("700");
  await expect(page.getByLabel("Menge Position 1")).toHaveValue("3");

  // Danach von Hand änderbar
  await page.getByLabel(/Einzelpreis Position 1/).fill("50,00");
  await expect(page.getByLabel(/Einzelpreis Position 1/)).toHaveValue("50,00");
  await expect(page.getByLabel("Steuersatz Position 1")).toHaveValue("700");

  // Suche nach der Nummer mit der Tastatur; der Treffer nennt Preis und Einheit
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const zweite = page.getByLabel("Beschreibung Position 2");
  await zweite.fill("L-07");
  await expect(trefferliste(page).getByRole("option", { name: "Lektorat Fachtext" })).toContainText("45,00\u00a0€ netto je Stk.");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(zweite).toHaveValue("Lektorat Fachtext");
  await expect(page.getByLabel(/Einzelpreis Position 2/)).toHaveValue("45,00");

  // Freier Text bleibt frei, auch wenn er wie ein Artikel heißt: Nur die Auswahl übernimmt Preis und Einheit
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  const dritte = page.getByLabel("Beschreibung Position 3");
  await dritte.fill("Lektorat Fachtext");
  await page.keyboard.press("Escape");
  await expect(dritte).toHaveValue("Lektorat Fachtext");
  await expect(page.getByLabel(/Einzelpreis Position 3/)).toHaveValue("");
});

/** Testkunden direkt in die Datenbank; danach archiviert, damit die folgenden Tests mit den bisherigen Kunden rechnen */
async function mitKunden<T>(kunden: { name: string; ort: string }[], lauf: () => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    const angelegt = await sql<{ id: string }[]>`insert into contacts ${sql(kunden, "name", "ort")} returning id`;
    try {
      return await lauf();
    } finally {
      await sql`update contacts set archived_at = now() where id in ${sql(angelegt.map((k) => k.id))}`;
    }
  } finally {
    await sql.end();
  }
}

test("Katalogfeld: Klick und Tab fügen keine Position ein (#359)", async () => {
  await go("/rechnungen/neu");
  const katalog = page.getByLabel("Aus dem Artikelkatalog einfügen");
  await katalog.click();
  await expect(trefferliste(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(katalog).not.toBeFocused();
  await expect(page.getByLabel("Beschreibung Position 1")).toHaveValue("");
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
});

test("Katalogfeld: Tab nach dem Tippen fügt keine Position ein, nur beim Kunden übernimmt Tab (#359)", async () => {
  await go("/rechnungen/neu");
  await page.getByLabel("Beschreibung Position 1").fill("Eigene Leistung");
  await page.keyboard.press("Escape");
  const katalog = page.getByLabel("Aus dem Artikelkatalog einfügen");
  await katalog.fill("Beratung");
  await expect(trefferliste(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(katalog).not.toBeFocused();
  await expect(page.getByLabel("Beschreibung Position 2")).toHaveCount(0);
});

test("Kunde: geleertes Feld und Tab nehmen den Kunden weg (#359)", async () => {
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  await kunde.fill("");
  await page.keyboard.press("Tab");
  await expect(kunde).not.toBeFocused();
  await expect(kunde).toHaveValue("");
  await expect(page.locator(".sheet").getByText("Rheinpixel GmbH")).toHaveCount(0);
});

test("Kunde: Klick ins leere Feld und Tab wählen niemanden (#359)", async () => {
  await go("/rechnungen/neu");
  const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
  await kunde.click();
  await expect(trefferliste(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(kunde).not.toBeFocused();
  await expect(kunde).toHaveValue("");
});

test("Kunde außerhalb der ersten 50 Treffer: Klick und Tab oder Enter wechseln ihn nicht (#359)", async () => {
  const viele = Array.from({ length: 60 }, (_, i) => ({ name: `Aaa Testkunde ${String(i).padStart(2, "0")}`, ort: "Testdorf" }));
  await mitKunden(viele, async () => {
    await go("/rechnungen/neu");
    await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
    const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
    await kunde.click();
    await expect(trefferliste(page)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");
    await kunde.click();
    await expect(trefferliste(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(kunde).not.toBeFocused();
    await expect(kunde).toHaveValue("Rheinpixel GmbH · Köln");
  });
});

test("Kunde: Der genau getippte Name gewinnt mit Enter gegen den schon gewählten Kunden (#359)", async () => {
  await mitKunden([{ name: "Rhein", ort: "Bonn" }], async () => {
    await go("/rechnungen/neu");
    await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
    const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
    await kunde.fill("Rhein");
    await expect(trefferliste(page).getByRole("option", { name: "Rhein Bonn" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(kunde).toHaveValue("Rhein · Bonn");
  });
});

test("Trefferliste ist barrierefrei, hell und dunkel (#359)", async () => {
  await go("/rechnungen/neu");
  const pruefen = async () => {
    const kunde = page.getByRole("combobox", { name: "Kunde", exact: true });
    await kunde.fill("gmbh");
    await expect(trefferliste(page)).toBeVisible();
    expect(await axeVerstoesse(page)).toEqual([]);
    await page.getByLabel("Beschreibung Position 1").fill("gibt es nicht im Katalog");
    await expect(trefferliste(page).getByRole("option")).toContainText("als neuen Artikel anlegen");
    expect(await axeVerstoesse(page)).toEqual([]);
  };
  await pruefen();
  await page.evaluate(() => localStorage.setItem("haben-modus", "dunkel"));
  await go("/rechnungen/neu");
  await pruefen();
  await page.evaluate(() => localStorage.removeItem("haben-modus"));
});

test("Seiten mit den Daten dieses Abschnitts ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, ["/artikel", "/textbausteine"]);
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
