import { kategorieName, waehleKategorie } from "./kategorie.ts";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { day, YEAR } from "./daten.ts";
import { type Durchlauf, databaseUrlFuer } from "./durchlaeufe.ts";
import {
  bestaetigen,
  kontoVerbinden,
  dkb,
  durchlaufSeite,
  gehe,
  lieferantWaehlen,
  neuenLieferantenOeffnen,
  ohneAxeVerstoesse,
  axeVerstoesse,
} from "./einrichtung.ts";
import { LAPTOP } from "./kopfzeile.ts";
import { abzugEinspielen } from "./abzug.ts";
import { receiptJpeg } from "./belegbild.ts";
import { eingabeNachAktion, fokusNachFehlschlag, kurzNacheinanderSpeichern } from "./felder-sperre.ts";

/**
 * Abschnitt von belege-steuern (#1742) mit eigenem Server und eigener Datenbank, parallel zu den anderen Abschnitten:
 * Fremdwährung, Anlagen, Bankabgleich mit Steuerzahlung, Darlehen, Direktbuchungen, gelernte Vorschläge, IBAN aus der
 * E-Rechnung, Sammelrechnung eines Zahlungsdienstleisters und unbekannte Bank-CSV. Beginnt mit dem Abzug nach
 * Einrichtung und Steuerdaten in belege-steuern.spec.ts (e2e/abzug.ts).
 */

const DURCHLAUF = "belege-steuern-bank" satisfies Durchlauf;

test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser, await abzugEinspielen("belege-steuern", DURCHLAUF)));
});

test.afterAll(async () => {
  await page.context().close();
});

const go = (path: string) => gehe(page, path);

test("Fremdwährung: Kurs von Hand mit der Monatsauswahl, fehlende Angaben stehen am Feld (#928)", async () => {
  await go("/einstellungen?bereich=waehrung");
  const form = page.getByRole("form", { name: "Kurs von Hand" });
  const waehrung = form.getByLabel("Währung", { exact: true });
  const monat = form.getByLabel("Monat", { exact: true });
  await form.getByRole("button", { name: "Kurs speichern" }).click();
  await expect(waehrung).toBeFocused();
  await expect(waehrung).toHaveAccessibleDescription("Trag die Währung ein.");
  await expect(monat).toHaveAccessibleDescription("Wähle den Monat.");
  await waehrung.fill("ISK");
  await monat.click();
  await page
    .getByRole("dialog", { name: "Monat wählen" })
    .getByRole("button", { name: `Januar ${YEAR}` })
    .click();
  await expect(monat).not.toHaveAttribute("aria-invalid");
  await form.getByLabel("1 EUR = …", { exact: true }).fill("152,3");
  await form.getByRole("button", { name: "Kurs speichern" }).click();
  await expect(page.getByText("Kurs gespeichert.")).toBeVisible();
  await expect(monat).toContainText("Monat wählen");
  // Nach dem Speichern zeigt die Liste den Monat des Kurses (#1040); der Monat steht dann in der Auswahl, nicht in der Zeile
  const karte = page.getByRole("region", { name: "Umsatzsteuer-Umrechnungskurse" });
  await expect(karte.getByRole("combobox", { name: "Monat" })).toHaveValue(`${YEAR}-01`);
  const zeile = karte.getByRole("row").filter({ hasText: "ISK" });
  await expect(zeile).toContainText("von Hand");
  await zeile.getByRole("button", { name: "Löschen" }).click();
  await expect(zeile).toHaveCount(0);
});

/** Kurse in Monaten weit vor dem Testjahr, damit kein Beleg des Durchlaufs sie nutzt; die Tests räumen sie wieder ab */
const KURS_JAHR = YEAR - 3;

async function kurseAnlegen(): Promise<void> {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    await sql`insert into exchange_rates (currency, month, rate, source) values
      ('CHF', ${`${KURS_JAHR}-01`}, '0.94', 'bmf'), ('USD', ${`${KURS_JAHR}-01`}, '1.08', 'bmf'),
      ('CHF', ${`${KURS_JAHR}-02`}, '0.95', 'bmf'), ('GBP', ${`${KURS_JAHR}-02`}, '0.85', 'bmf'),
      ('USD', ${`${KURS_JAHR}-02`}, '1.09', 'bmf'), ('JPY', ${`${KURS_JAHR}-02`}, '160.5', 'manuell')
      on conflict do nothing`;
  } finally {
    await sql.end();
  }
}

async function kurseEntfernen(): Promise<void> {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    await sql`delete from exchange_rates where month like ${`${KURS_JAHR}-%`}`;
  } finally {
    await sql.end();
  }
}

test("Fremdwährung: Kurse nach Monat, nach Währung und nur eigene (#1040)", async () => {
  await kurseAnlegen();
  try {
    await go("/einstellungen?bereich=waehrung");
    const karte = page.getByRole("region", { name: "Umsatzsteuer-Umrechnungskurse" });
    const zeilen = karte.locator("tbody tr");
    // Ohne Wahl der neueste Monat, ohne Spalte für den Monat
    await expect(karte.getByRole("combobox", { name: "Monat" })).toHaveValue(`${KURS_JAHR}-02`);
    await expect(zeilen).toHaveCount(4);
    await expect(karte.getByRole("columnheader", { name: "Monat" })).toHaveCount(0);
    await karte.getByRole("searchbox", { name: "Währung filtern" }).fill("us");
    await expect(zeilen).toHaveCount(1);
    await expect(zeilen).toContainText("USD");
    await karte.getByRole("combobox", { name: "Monat" }).selectOption(`${KURS_JAHR}-01`);
    await expect(zeilen).toHaveCount(1);
    await expect(zeilen).toContainText("1,08");
    await karte.getByRole("searchbox", { name: "Währung filtern" }).fill("");

    await karte.getByRole("button", { name: "Nach Währung" }).click();
    await expect(karte.getByRole("button", { name: "Nach Währung" })).toHaveAttribute("aria-pressed", "true");
    await expect(karte.getByRole("combobox", { name: "Währung" })).toHaveValue("USD");
    await expect(zeilen).toHaveCount(2);
    await expect(zeilen.first()).toContainText(`02/${KURS_JAHR}`);
    await karte.getByRole("combobox", { name: "Währung" }).selectOption("GBP");
    await expect(zeilen).toHaveCount(1);

    await karte.getByRole("button", { name: "Nur eigene (1)" }).click();
    await expect(zeilen).toHaveCount(1);
    await expect(zeilen).toContainText("JPY");
    await zeilen.getByRole("button", { name: "Löschen" }).click();
    await expect(page.getByText("Kurs gelöscht.")).toBeVisible();
    // Ohne eigene Kurse fällt die Ansicht auf den Monat zurück
    await expect(karte.getByRole("button", { name: /^Nur eigene/ })).toHaveCount(0);
    await expect(karte.getByRole("button", { name: "Nach Monat" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await kurseEntfernen();
  }
});

test("Fremdwährung: Kursliste am Handy ohne seitliches Scrollen und ohne axe-Verstöße, hell und dunkel (#1040)", async () => {
  await kurseAnlegen();
  const vorher = page.viewportSize();
  try {
    for (const modus of ["hell", "dunkel"]) {
      for (const viewport of [LAPTOP, { width: 375, height: 812 }]) {
        await page.setViewportSize(viewport);
        await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
        await go("/einstellungen?bereich=waehrung");
        const karte = page.getByRole("region", { name: "Umsatzsteuer-Umrechnungskurse" });
        await expect(karte.getByRole("button", { name: "Nur eigene (1)" })).toBeVisible();
        const ueberstand = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(ueberstand, `${modus}, ${viewport.width} px: seitliches Scrollen`).toBeLessThanOrEqual(1);
        const kante = await karte.evaluate((el) => el.getBoundingClientRect().right);
        const gruppe = await karte.getByRole("group", { name: "Darstellung der Kurse" }).evaluate((el) => el.getBoundingClientRect().right);
        expect(gruppe, `${modus}, ${viewport.width} px: Umschalter ragt aus der Karte`).toBeLessThanOrEqual(kante);
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
          `${modus}, ${viewport.width} px`,
        ).toEqual([]);
      }
    }
  } finally {
    await page.evaluate(() => localStorage.setItem("haben-modus", "hell"));
    if (vorher) await page.setViewportSize(vorher);
    await kurseEntfernen();
  }
});

test("Kennzahlen am Handy: Bei ungerader Zahl füllt die letzte Karte die Zeile", async () => {
  // Zwei Spalten am Handy (DESIGN.md, Karten): Die fünfte Karte der Pauschalen und die dritte der Kasse standen allein in halber Breite
  const vorher = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [pfad, anzahl] of [
    ["/pauschalen", 5],
    ["/kasse", 3],
  ] as const) {
    await go(pfad);
    const raster = page.locator(".grid-3, .grid-4, .grid-5").first();
    await expect(raster.locator(":scope > .card")).toHaveCount(anzahl);
    const breiten = await raster.evaluate((r) => ({
      raster: r.getBoundingClientRect().width,
      erste: (r.firstElementChild as HTMLElement).getBoundingClientRect().width,
      letzte: (r.lastElementChild as HTMLElement).getBoundingClientRect().width,
    }));
    expect(breiten.erste, `${pfad}: zwei Spalten`).toBeLessThan(breiten.raster / 2);
    expect(breiten.letzte, `${pfad}: letzte Karte über die ganze Breite`).toBeCloseTo(breiten.raster, 0);
  }
  if (vorher) await page.setViewportSize(vorher);
});

test("Anlage: ein Satz über dem Höchstsatz ist ein Fehler am Satz, der Fokus geht zum ersten Fehler (Review #971)", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("Fräse");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Anschaffungsdatum").fill("2024-04-10");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("50.000,00");
  await form.getByRole("combobox", { name: "Abschreibung", exact: true }).selectOption("degressiv");
  // Bei degressiv gibt es keinen Hinweis unter der Auswahl, also zeigt auch aria-describedby nicht darauf
  await expect(form.getByRole("combobox", { name: "Abschreibung", exact: true })).not.toHaveAttribute("aria-describedby", /method-hint/);
  await form.getByLabel("Nutzungsdauer in Jahren").fill("10");
  await form.getByLabel("Abschreibungssatz in % (degressiv)").fill("30");
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  // Erstes Feld mit Fehler ist der Satz, und er sagt warum; der Restbuchwert darunter trägt seinen eigenen Fehler
  await expect(form.getByLabel("Abschreibungssatz in % (degressiv)")).toBeFocused();
  await expect(form.getByLabel("Abschreibungssatz in % (degressiv)")).toHaveAccessibleDescription(/Höchstens 20 %/);
  await expect(form.getByLabel("Restbuchwert zum Stichtag (€)")).toHaveAccessibleDescription(/Trag den Restbuchwert ein/);
});

test("Anlage übernehmen: degressive AfA mit Höchstsatz, Restbuchwert geprüft, Wechsel zur linearen", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  // Leer abgeschickt: die Fehler stehen an den Feldern, der Fokus in der Bezeichnung (DESIGN.md, Gesperrte Knöpfe)
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await expect(form.getByLabel("Bezeichnung")).toBeFocused();
  await expect(form.getByLabel("Bezeichnung")).toHaveAccessibleDescription("Trag eine Bezeichnung ein.");
  await expect(form.getByLabel("Anschaffungskosten netto (€)")).toHaveAccessibleDescription("Trag die Anschaffungskosten netto ein, etwa 1.200,00.");
  await form.getByLabel("Bezeichnung").fill("Drehbank degressiv");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Anschaffungsdatum").fill("2024-04-10");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("50.000,00");
  await form.getByRole("combobox", { name: "Abschreibung", exact: true }).selectOption("degressiv");
  await form.getByLabel("Nutzungsdauer in Jahren").fill("10");
  // Wachstumschancengesetz: April bis Dezember 2024 höchstens das Doppelte des linearen Satzes und 20 %
  await expect(form.getByText("Höchstens 20 %; leer lassen für den Höchstsatz.")).toBeVisible();
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("30.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await expect(page.getByRole("alert")).toContainText("Restbuchwert passt nicht zur degressiven AfA (rechnerisch 34.000,00 €)");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("34.000,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  const plan = page.getByRole("region", { name: "Abschreibungsplan", exact: true });
  await expect(plan).toContainText("Degressiv mit Wechsel zur linearen (§ 7 Abs. 2 EStG), 10 Jahre, 20 %");
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).toContainText("6.800,00");

  // Wechsel zur linearen AfA ab 2027: 27.200 € über die Restnutzungsdauer von 87 Monaten
  const angaben = page.getByRole("region", { name: "Angaben" });
  await angaben.getByLabel("Linear ab Jahr (optional)").fill("2027");
  await angaben.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
  await expect(plan).toContainText("linear ab 2027");
  await expect(plan.locator(".table-row", { hasText: /^2027/ })).toContainText("3.751,72");
  await expect(angaben.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen")).not.toBeChecked();

  const sonderAfA = angaben.getByRole("button", { name: "Sonder-AfA speichern" });
  await expect(sonderAfA).toHaveCount(1);
  const betrag = angaben.getByRole("textbox", { name: "2026 (€)", exact: true });
  await betrag.fill("5000");
  const bestaetigung = angaben.getByRole("checkbox", { name: /maßgebliche Vorjahresgewinn/ });
  await sonderAfA.click();
  await expect(bestaetigung).toBeFocused();
  await expect(bestaetigung).toHaveAccessibleDescription("Bestätige die Voraussetzungen für die Sonder-AfA.");
  await bestaetigung.check();
  await sonderAfA.click();
  await expect(page.getByRole("status").filter({ hasText: "Sonder-AfA gespeichert." })).toBeVisible();
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).toContainText("5.000,00 Sonder-AfA");
  await page.reload();
  await expect(betrag).toHaveValue("5.000,00");
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).toContainText("5.000,00 Sonder-AfA");
  await betrag.fill("0");
  await sonderAfA.click();
  await expect(betrag).toHaveValue("0,00");
  await expect(plan.locator(".table-row", { hasText: /^2026/ })).not.toContainText("Sonder-AfA");
});

test("Beleg als Anlagegut: Wechsel von Fahrzeug zu Sonstige Transportmittel lässt die sechs Jahre für Pkw nicht stehen (#312)", async ({ browser }) => {
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "anhaenger.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Anhänger Center") }]);
  await expect(page.getByText("anhaenger.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /anhaenger\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await waehleKategorie(page.getByLabel("Kategorie"), "anlage");
  await page.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Fahrzeug" });
  await expect(page.getByLabel("Nutzungsdauer in Jahren")).toHaveValue("6");
  await page.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Transportmittel (z. B. Anhänger, Lastenrad, Boot)" });
  await expect(page.getByLabel("Nutzungsdauer in Jahren")).toHaveValue("");
  // Nicht buchen: der Beleg würde die folgenden Auswertungen verändern
  await page.getByRole("button", { name: "Löschen" }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
});

test("Anlage anlegen: Erinnerungswert angehakt, dann zu Computer gewechselt, wird ohne Erinnerungswert gespeichert", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  await form.getByLabel("Bezeichnung").fill("Notebook mit Haken");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Nutzungsdauer in Jahren").fill("5");
  await form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen").check();
  // Computer: Nutzungsdauer ein Jahr, ohne Erinnerungswert; das ausgeblendete Häkchen darf nicht mitgehen
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Computer, Hardware und Software" });
  await expect(form.getByLabel("Erinnerungswert 1 € bis zum Abgang stehen lassen")).toHaveCount(0);
  await form.getByLabel("Anschaffungsdatum").fill("2025-03-01");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("1.500,00");
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("0,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("region", { name: "Abschreibungsplan", exact: true })).not.toContainText("Erinnerungswert");
});

test("Anlage: Eingaben direkt nach dem Speichern bleiben erhalten (#1793)", async () => {
  await go("/anlagen/neu");
  const form = page.getByRole("region", { name: "Angaben" });
  const bezeichnung = form.getByLabel("Bezeichnung");
  await bezeichnung.fill("Werkbank Sperre");
  await form.getByRole("combobox", { name: "Art", exact: true }).selectOption({ label: "Sonstige Betriebs- und Geschäftsausstattung" });
  await form.getByLabel("Nutzungsdauer in Jahren").fill("10");
  await form.getByLabel("Anschaffungsdatum").fill("2025-03-01");
  await form.getByLabel("Anschaffungskosten netto (€)").fill("2.400,00");
  await form.getByLabel("Übernahmestichtag").fill("2026-01-01");
  await form.getByLabel("Restbuchwert zum Stichtag (€)").fill("2.200,00");
  await form.getByRole("button", { name: "Anlage übernehmen" }).click();
  await page.waitForURL(/\/anlagen\/[0-9a-f-]{36}$/);
  // Das Formular der neuen Seite, nicht mehr das von „neu“
  await expect(page.getByRole("heading", { name: "Werkbank Sperre", level: 1 })).toBeVisible();

  await bezeichnung.fill("Werkbank gespeichert");
  await eingabeNachAktion(page, {
    aktion: form.getByRole("button", { name: "Speichern", exact: true }),
    feld: bezeichnung,
    text: "Gleich danach getippt",
    neuGeladen: page.getByRole("heading", { name: "Werkbank gespeichert", level: 1 }),
  });
});

test("Anlage: Kurz nacheinander gespeichert, baut sich das Formular jedes Mal neu auf (#1804)", async () => {
  // Die Anlage aus dem Test davor
  const form = page.getByRole("region", { name: "Angaben" });
  await kurzNacheinanderSpeichern({
    feld: form.getByLabel("Bezeichnung"),
    speichern: form.getByRole("button", { name: "Speichern", exact: true }),
    texte: ["Werkbank eins", "Werkbank zwei", "Werkbank drei"],
  });
});

test("Anlage: Speichern schlägt fehl, der Fokus steht danach wieder im Feld (#1793)", async () => {
  // Die Anlage aus den Tests davor
  await fokusNachFehlschlag(page, page.getByRole("region", { name: "Angaben" }).getByLabel("Bezeichnung"));
  // Die Anlage gehört nur diesen drei Tests: die folgenden rechnen ohne sie
  await page.locator(".page-head").getByRole("button", { name: "Löschen", exact: true }).click();
  await bestaetigen(page, "Anlage löschen");
  await expect(page).toHaveURL(/\/anlagen(?:\?.*)?$/);
});

test("Aufteilen mit zu viel verteilt: der Fehler am Betrag sagt, wie viel zu viel ist (Review #970)", async () => {
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      dkb(day(0)),
      dkb(day(0)),
      "Gebucht",
      "Max Mustermann",
      "Kasse Überschuss",
      "Zahlung Ueberschuss",
      "Ausgang",
      "DE91750500000000123456",
      "-43,00",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "ueberschuss.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Kasse Überschuss/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await panel.getByRole("button", { name: "Aufteilen" }).click();
  const form = panel.getByRole("form", { name: "Umsatz aufteilen" });
  const rows = form.locator(".split-row");
  await rows.nth(0).locator("select").first().selectOption("privat");
  await rows.nth(0).getByLabel("Betrag").fill("-40,00");
  await rows.nth(1).locator("select").first().selectOption("privat");
  // Zusammen -46,00 € bei einem Umsatz von -43,00 €: 3,00 € zu viel verteilt
  await rows.nth(1).getByLabel("Betrag").fill("-6,00");
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  await expect(rows.nth(1).getByLabel("Betrag")).toBeFocused();
  await expect(rows.nth(1).getByLabel("Betrag")).toHaveAccessibleDescription("Zusammen sind 3,00 € zu viel verteilt.");
  // Richtig verteilt und gebucht, damit kein offener Umsatz für die folgenden Tests stehen bleibt
  await rows.nth(1).getByLabel("Betrag").fill("-3,00");
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  await expect(panel.getByText("Zugeordnet")).toBeVisible();
});

test("Steuerzahlung im Bankabgleich: Gewerbesteuerbescheid auf Steuer und Verspätungszuschlag aufteilen, in der EÜR nur nachrichtlich", async () => {
  const bezugsjahr = String(YEAR - 2);
  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      dkb(day(0)),
      dkb(day(0)),
      "Gebucht",
      "Max Mustermann",
      "Stadtkasse Regensburg",
      `GewSt ${bezugsjahr} Bescheid`,
      "Ausgang",
      "DE91750500000000123456",
      "-543,00",
      "",
      "",
      "",
    ]
      .map((v) => `"${v}"`)
      .join(";") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "gewerbesteuer.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Stadtkasse Regensburg/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Stadtkasse Regensburg" })).toBeVisible();

  // „Buchen“ bleibt bedienbar; ohne Bezugsjahr steht der Fehler am Feld, der Fokus dort, gebucht wird nichts (DESIGN.md, Gesperrte Knöpfe)
  await panel.getByLabel("Buchen als").selectOption("steuer");
  await panel.getByLabel("Bezugsjahr").fill("");
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await expect(panel.getByLabel("Bezugsjahr")).toBeFocused();
  await expect(panel.getByLabel("Bezugsjahr")).toHaveAccessibleDescription("Trag das Bezugsjahr vierstellig ein, etwa 2025.");
  await expect(panel.getByText("Zugeordnet")).toHaveCount(0);

  // Eine Zahlung, zwei Teile: die Steuer für ein Vorjahr und der Verspätungszuschlag, beide zur Gewerbesteuer
  await panel.getByRole("button", { name: "Aufteilen" }).click();
  const form = panel.getByRole("form", { name: "Umsatz aufteilen" });
  const rows = form.locator(".split-row");
  for (const [index, posten, betrag] of [
    [0, "steuer", "-500,00"],
    [1, "verspaetung", "-43,00"],
  ] as const) {
    const row = rows.nth(index);
    // Ziel des Teils: die erste Auswahl der Zeile („Teil 1“, „Teil 2“)
    await row.locator("select").first().selectOption("steuer");
    await row.getByLabel("Steuerart").selectOption("gewst");
    await row.getByLabel("Bezugsjahr").fill(bezugsjahr);
    await row.getByLabel("Teil der Zahlung").selectOption(posten);
    await row.getByLabel("Betrag").fill(betrag);
  }
  await expect(form.getByText("Keine Betriebsausgabe, auch nicht Zinsen und Zuschläge darauf (§ 4 Abs. 5b EStG)").first()).toBeVisible();

  // Ergeben die Teile nicht den Umsatz, steht der fehlende Rest am Betrag des letzten Teils
  await rows.nth(1).getByLabel("Betrag").fill("-40,00");
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  await expect(rows.nth(1).getByLabel("Betrag")).toBeFocused();
  await expect(rows.nth(1).getByLabel("Betrag")).toHaveAccessibleDescription("Zusammen fehlen noch -3,00 €.");
  await rows.nth(1).getByLabel("Betrag").fill("-43,00");
  await expect(rows.nth(1).getByLabel("Betrag")).not.toHaveAttribute("aria-invalid");
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText(`Steuer: Gewerbesteuer ${bezugsjahr} · Zahlung`)).toBeVisible();
  await expect(panel.getByText(`Steuer: Gewerbesteuer ${bezugsjahr} · Verspätungszuschlag (§ 152 AO) oder Zwangsgeld (§ 329 AO)`)).toBeVisible();

  // Keine Betriebsausgabe: die EÜR nennt die Gewerbesteuer nur nachrichtlich
  await go("/auswertungen");
  const nachrichtlich = page.getByRole("row", { name: /Nachrichtlich: Gewerbesteuer/ });
  await expect(nachrichtlich).toContainText("543,00");
});

test("Darlehen: anlegen, Auszahlung zuordnen, Rate in Tilgung und Zinsen aufteilen, Bestand sinkt um die Tilgung", async () => {
  await go("/darlehen");
  const neu = page.getByRole("form", { name: "Darlehen anlegen" });
  await neu.getByLabel("Name").fill("Hausbank Investitionskredit");
  // Nicht lesbare Restschuld: Meldung am Feld, Fokus dort, nichts angelegt (#1270)
  const restschuld = neu.getByLabel(/Restschuld bei Übernahme/);
  await restschuld.fill("12€50");
  await neu.getByRole("button", { name: "Darlehen anlegen" }).click();
  await expect(neu.getByText("Trag die Restschuld ein, etwa 25.000,00, oder lass das Feld leer.")).toBeVisible();
  await expect(restschuld).toBeFocused();
  await expect(page.getByRole("row", { name: /Hausbank Investitionskredit/ })).toHaveCount(0);
  // Restschuld ohne Stichtag: Meldung am Stichtag statt der Ablehnung durch den Server
  await restschuld.fill("25.000,00");
  await neu.getByRole("button", { name: "Darlehen anlegen" }).click();
  await expect(neu.getByText("Wähle den Stichtag der Restschuld.")).toBeVisible();
  await expect(neu.getByLabel("Stichtag der Restschuld")).toBeFocused();
  await restschuld.fill("");
  await neu.getByRole("button", { name: "Darlehen anlegen" }).click();
  await expect(page.getByRole("row", { name: /Hausbank Investitionskredit/ })).toContainText("0630");

  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      [dkb(day(-1)), "Hausbank Regensburg", "Max Mustermann", "Auszahlung Darlehen 4711", "Eingang", "10.000,00"],
      [dkb(day(0)), "Max Mustermann", "Hausbank Regensburg", "Rate Darlehen 4711", "Ausgang", "-1.000,00"],
    ]
      .map(([date, from, to, purpose, type, amount]) =>
        [date, date, "Gebucht", from, to, purpose, type, "DE27750500000000654321", amount, "", "", ""].map((v) => `"${v}"`).join(";"),
      )
      .join("\n") +
    "\n";
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "darlehen.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Zuordnung" });

  // Auszahlung: ohne Rechnung als Darlehen, erfolgsneutral
  await page
    .getByRole("link", { name: /Auszahlung Darlehen 4711/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  // Erst weiter, wenn rechts der gewählte Umsatz steht; sonst gehört das Formular noch zum vorigen
  await expect(panel.getByText("Auszahlung Darlehen 4711")).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("darlehen");
  await expect(panel.getByLabel("Teil der Rate")).toHaveValue("auszahlung");
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // Rate: 800 € Tilgung und 200 € Zinsen
  await page
    .getByRole("link", { name: /Rate Darlehen 4711/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Rate Darlehen 4711")).toBeVisible();
  await panel.getByRole("button", { name: "Aufteilen" }).click();
  const form = panel.getByRole("form", { name: "Umsatz aufteilen" });
  const rows = form.locator(".split-row");
  for (const [index, teil, betrag] of [
    [0, "tilgung", "-800,00"],
    [1, "zins", "-200,00"],
  ] as const) {
    const row = rows.nth(index);
    await row.locator("select").first().selectOption("darlehen");
    await row.getByLabel("Teil der Rate").selectOption(teil);
    await row.getByLabel("Betrag").fill(betrag);
  }
  await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Darlehen: Darlehen Hausbank Investitionskredit · Tilgung")).toBeVisible();
  await expect(panel.getByText("Darlehen: Darlehen Hausbank Investitionskredit · Zinsen")).toBeVisible();

  await go("/darlehen");
  await expect(page.getByRole("row", { name: /Hausbank Investitionskredit/ })).toContainText("9.200,00");
});

test("Beleg: Kategorie und Bezahlung aus früheren Belegen des Lieferanten, mit Begründung, übernehmen auf Klick (#295)", async ({ browser }) => {
  const beleg = async (n: number) => {
    await go("/belege");
    await page
      .locator("input[type=file][multiple]")
      .setInputFiles([{ name: `kiosk-${n}.jpg`, mimeType: "image/jpeg", buffer: await receiptJpeg(browser, `Kiosk am Markt ${n}`) }]);
    await expect(page.getByText(`kiosk-${n}.jpg: abgelegt.`)).toBeVisible();
    await page
      .getByRole("link", { name: new RegExp(`kiosk-${n}\\.jpg`) })
      .first()
      .click();
    await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Lieferant", { exact: true }).fill("Kiosk am Markt");
    await page.getByLabel("Rechnungsnummer").fill(`Q-${n}`);
    await page.getByLabel("Belegdatum").fill(day(-3));
    await page.getByLabel("Netto", { exact: true }).fill("10,00");
  };
  // Zwei Belege als Telefon, privat bezahlt
  for (const n of [1, 2]) {
    await beleg(n);
    await waehleKategorie(page.getByLabel("Kategorie"), "telefon");
    await page.getByLabel("Privat bezahlt (Privateinlage)").check();
    await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
    await bestaetigen(page, "Buchen");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Der Beleg ist festgeschrieben/)).toBeVisible();
  }
  // Der dritte: Hinweise mit Anzahl und Tag der letzten Buchung, gewählt wird erst mit „übernehmen“
  await beleg(3);
  await page.locator(".doc-actions").getByRole("button", { name: "Speichern" }).click();
  await page.waitForLoadState("networkidle");
  const heute = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
  const kategorie = page.locator(".field").filter({ has: page.getByLabel("Kategorie") });
  await expect(kategorie).toContainText(new RegExp(`Bisher 2× als [0-9]{4} · Telefon gebucht, zuletzt am ${heute.replaceAll(".", "[.]")}`));
  const bezahlung = page.getByRole("group", { name: "Bezahlung" });
  await expect(bezahlung).toContainText(`Bisher 2× privat bezahlt, zuletzt am ${heute}`);
  await expect(bezahlung.getByLabel("Über das Geschäftskonto (Zuordnung beim Bankabgleich)")).toBeChecked();
  await bezahlung.getByRole("button", { name: "übernehmen" }).click();
  await expect(bezahlung.getByLabel("Privat bezahlt (Privateinlage)")).toBeChecked();
  await expect(bezahlung.getByRole("button", { name: "übernehmen" })).toBeHidden();
  await kategorie.getByRole("button", { name: "übernehmen" }).click();
  await expect(page.getByLabel("Kategorie")).toHaveValue(kategorieName("telefon"));
  // Nichts ist gebucht, bis bestätigt wird
  await expect(page.getByText(/Der Beleg ist festgeschrieben/)).toBeHidden();
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Der Beleg ist festgeschrieben/)).toBeVisible();
});

test("Direkt buchen auf eine Kategorie: Zahlung eines Privatkunden mit 19 %, Ausgabe ohne Vorsteuer (#324)", async () => {
  const zeile = (name: string, zweck: string, betrag: string) =>
    [dkb(day(0)), dkb(day(0)), "Gebucht", betrag.startsWith("-") ? "Max Mustermann" : name, betrag.startsWith("-") ? name : "Max Mustermann", zweck]
      .concat([betrag.startsWith("-") ? "Ausgang" : "Eingang", "", betrag, "", "", ""])
      .map((v) => `"${v}"`)
      .join(";");
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zeile("Erika Beispiel", "Reparatur Notebook", "119,00")}\n${zeile("Kiosk am Markt", "Prepaid-Aufladung", "-35,70")}\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "direkt.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Zuordnung" });

  // Eingang: Erlöse mit 19 %, Netto und Steuer werden angezeigt
  await page
    .getByRole("link", { name: /Erika Beispiel/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByRole("heading", { name: "Erika Beispiel" })).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  await expect(panel.getByRole("combobox", { name: "Kategorie", exact: true })).toHaveValue(kategorieName("erloese"));
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).toHaveValue("1900");
  await expect(panel.getByText("100,00 € netto, 19,00 € Umsatzsteuer")).toBeVisible();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // Ausgang: Telefon, brutto ohne Vorsteuer; einen Steuersatz gibt es dort nicht
  await page
    .getByRole("link", { name: /Kiosk am Markt/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByRole("heading", { name: "Kiosk am Markt" })).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  await waehleKategorie(panel.getByRole("combobox", { name: "Kategorie", exact: true }), "telefon");
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).toBeHidden();
  await expect(panel.getByText(/ohne Vorsteuer/)).toBeVisible();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText(/Direkt: [0-9]{4} · Telefon/)).toBeVisible();

  // In der Voranmeldung des Monats als Direktbuchung unter Kz 81, verlinkt auf den Bankumsatz mit seiner Zuordnung
  await go(`/umsatzsteuer/${day(0).slice(0, 7)}`);
  await page
    .getByRole("button", { name: /Direktbuchung/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Direkt gebucht · Erika Beispiel" }).click();
  await page.waitForURL(/\/bank\?/);
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Direkt: Erlöse 19 %")).toBeVisible();
});

test("Von der Zuordnung zur Buchung im Journal und über die Herkunft „Bank“ zurück zum Umsatz (#1855)", async () => {
  // Gewählt ist noch die Zahlung von Erika Beispiel aus dem Test davor
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByText("Direkt: Erlöse 19 %")).toBeVisible();
  await panel.getByRole("link", { name: /^Buchung vom / }).click();
  await page.waitForURL(/\/buchungen\?.*#buchung-/);
  const zeile = page.locator('tr[aria-current="true"]');
  await expect(zeile).toContainText("Erika Beispiel");
  await expect(zeile).toBeFocused();
  // Bisher führte die Herkunft nur auf die Seite Bank; jetzt öffnet sie genau diesen Umsatz
  await zeile.getByRole("link", { name: "Bank", exact: true }).click();
  await page.waitForURL(/\/bank\?.*umsatz=/);
  await page.waitForLoadState("networkidle");
  await expect(panel.getByRole("heading", { name: "Erika Beispiel" })).toBeVisible();
  await expect(panel.getByText("Direkt: Erlöse 19 %")).toBeVisible();
});

test("Direkt buchen als nicht steuerbare Einnahme: ohne Steuersatz, auch nach Wechsel von Erlöse 19 % (#1131)", async () => {
  const zeile = (name: string, zweck: string, betrag: string) =>
    [dkb(day(0)), dkb(day(0)), "Gebucht", betrag.startsWith("-") ? "Max Mustermann" : name, betrag.startsWith("-") ? name : "Max Mustermann", zweck]
      .concat([betrag.startsWith("-") ? "Ausgang" : "Eingang", "", betrag, "", "", ""])
      .map((v) => `"${v}"`)
      .join(";");
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zeile("Versandlager GmbH", "Erstattung verlorene Ware", "12,50")}\n${zeile("Versandlager GmbH", "Rückforderung Erstattung", "-4,20")}\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "schadenersatz.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Zuordnung" });

  await page
    .getByRole("link", { name: /Erstattung verlorene Ware/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Erstattung verlorene Ware")).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  // Vorbelegt bleibt Erlöse 19 %; der Wechsel setzt den Satz zurück, ein Steuersatz-Feld gibt es dann nicht
  await expect(panel.getByRole("combobox", { name: "Kategorie", exact: true })).toHaveValue(kategorieName("erloese"));
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).toHaveValue("1900");
  await waehleKategorie(panel.getByRole("combobox", { name: "Kategorie", exact: true }), "nichtSteuerbar");
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).toBeHidden();
  await expect(panel.getByText("Gebucht als Einnahme ohne Umsatzsteuer, nicht in der Voranmeldung.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // Danach steht die Rückforderung im Panel: Ausgang, vorbelegt als Ausgabe; ebenfalls nicht steuerbar, mindert die Einnahme
  await expect(panel.getByText("Rückforderung Erstattung")).toBeVisible();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  await waehleKategorie(panel.getByRole("combobox", { name: "Kategorie", exact: true }), "nichtSteuerbar");
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).toBeHidden();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Direkt: Nicht steuerbare Einnahme")).toBeVisible();
});

/** Beleg mit abweichender IBAN aus dem Test unten, für die Prüfung mit axe */
let ibanBeleg = "";

test("Abweichende IBAN der E-Rechnung: Warnung am Beleg, gesperrt unter Überweisungen bis zur Entscheidung (#410)", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Netzwerk Hosting GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("IBAN").fill("DE75 5121 0800 1245 1261 99");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  // Auftraggeberkonto für Überweisungen: das Girokonto aus dem Bankabgleich weiter oben

  // E-Rechnung mit IBAN DE02 1203 … (BT-84), anders als im Kontakt
  await go("/belege");
  const xml = readFileSync(new URL("../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url));
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "RE-2026-0815.xml", mimeType: "application/xml", buffer: xml }]);
  await expect(page.getByText("RE-2026-0815.xml: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /Netzwerk Hosting GmbH RE-2026\/0815/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  // Der Abgleich läuft, sobald der Kontakt am Beleg hängt
  await expect(page.getByRole("region", { name: "Bankverbindung prüfen" })).toHaveCount(0);
  await lieferantWaehlen(page, "Netzwerk Hosting GmbH");
  await waehleKategorie(page.getByLabel("Kategorie"), "software");
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();
  ibanBeleg = new URL(page.url()).pathname;
  const pruefen = page.getByRole("region", { name: "Bankverbindung prüfen" });
  await expect(pruefen).toContainText("DE75 5121 0800 1245 1261 99");
  await expect(pruefen).toContainText("DE02 1203 0000 0000 2020 51");

  // Ohne Entscheidung nicht auswählbar, auch nicht über „Alle auswählen“
  await go("/ueberweisungen");
  const zeile = page.locator(".table-row").filter({ hasText: "Netzwerk Hosting GmbH" });
  await expect(zeile.getByRole("checkbox")).toBeDisabled();
  await expect(zeile).toContainText("am Beleg entscheiden");
  // „Alle auswählen“ nimmt nur wählbare Zeilen; ist keine andere offen, ist der Knopf selbst gesperrt
  const alle = page.getByRole("button", { name: "Alle auswählen" });
  if (await alle.isEnabled()) await alle.click();
  await expect(zeile.getByRole("checkbox")).not.toBeChecked();
  await zeile.getByRole("link", { name: /am Beleg entscheiden/ }).click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  // Am gebuchten Beleg entscheiden: die IBAN der E-Rechnung nur für diesen Beleg
  await pruefen.getByRole("button", { name: "IBAN der E-Rechnung nur für diesen Beleg" }).click();
  await expect(pruefen).toContainText("Es gilt die IBAN der E-Rechnung, nur für diesen Beleg. Entschieden von");
  await go("/ueberweisungen");
  await expect(zeile.getByRole("checkbox")).toBeEnabled();
  await expect(zeile).toContainText("DE02 1203 0000 0000 2020 51");
  await expect(zeile).toContainText("Am Beleg entschieden: IBAN der E-Rechnung nur für diesen Beleg");
  // Der Kontakt bleibt, wie er war
  await go("/kontakte");
  await page
    .getByRole("link", { name: /Netzwerk Hosting GmbH/ })
    .first()
    .click();
  await expect(page.getByLabel("IBAN")).toHaveValue(/DE75\s?5121/);
});

test("Vorschlag aus früheren Direktbuchungen: Kategorie vorbelegt, mit Begründung, gebucht erst auf Klick (#295)", async () => {
  // „Kiosk am Markt“ ist aus dem Test davor einmal als Telefon gebucht; zwei weitere Aufladungen kommen dazu
  const zeile = (datum: string, zweck: string, betrag: string) =>
    [datum, datum, "Gebucht", "Max Mustermann", "Kiosk am Markt", zweck, "Ausgang", "", betrag, "", "", ""].map((v) => `"${v}"`).join(";");
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zeile(dkb(day(0)), "Prepaid-Aufladung Mai", "-15,00")}\n${zeile(dkb(day(1)), "Prepaid-Aufladung Juli", "-20,00")}\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "kiosk.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/2 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  const panel = page.getByRole("complementary", { name: "Zuordnung" });

  // Erst ein Telefon-Umsatz: noch kein Vorschlag (nur eine frühere Zuordnung), also von Hand
  await page
    .getByRole("link", { name: /Prepaid-Aufladung Mai/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Prepaid-Aufladung Mai")).toBeVisible();
  await expect(panel.getByText("Vorschlag ohne Rechnung")).toBeHidden();
  if (await panel.getByRole("button", { name: "Direkt buchen" }).isVisible()) await panel.getByRole("button", { name: "Direkt buchen" }).click();
  await panel.getByLabel("Buchen als").selectOption("kategorie");
  await waehleKategorie(panel.getByRole("combobox", { name: "Kategorie", exact: true }), "telefon");
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // Danach: zweimal so gebucht, die Liste zeigt „Vorschlag“, rechts Begründung und vorbelegte Felder
  await expect(page.getByRole("link", { name: /Prepaid-Aufladung Juli/ }).first()).toContainText("Vorschlag");
  await page
    .getByRole("link", { name: /Prepaid-Aufladung Juli/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Prepaid-Aufladung Juli")).toBeVisible();
  await expect(panel.getByText("Vorschlag ohne Rechnung")).toBeVisible();
  await expect(panel.getByText(/Ausgabe: [0-9]{4} · Telefon/)).toBeVisible();
  await expect(panel.getByText(`2 von 2 Umsätzen von dieser Gegenpartei so gebucht, zuletzt am ${day(0).split("-").reverse().join(".")}`)).toBeVisible();
  await expect(panel.getByLabel("Buchen als")).toHaveValue("kategorie");
  await expect(panel.getByRole("combobox", { name: "Kategorie", exact: true })).toHaveValue(kategorieName("telefon"));
  // Nichts ist gebucht, bis bestätigt wird
  await expect(panel.getByText(/Direkt: [0-9]{4} · Telefon/)).toBeHidden();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");
  // Danach springt die Auswahl zum nächsten offenen Umsatz; unter „Alle“ steht der gebuchte mit seiner Zuordnung
  await go("/bank?filter=alle");
  await page
    .getByRole("link", { name: /Prepaid-Aufladung Juli/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Prepaid-Aufladung Juli")).toBeVisible();
  await expect(panel.getByText(/Direkt: [0-9]{4} · Telefon/)).toBeVisible();
});

test("Gelernte Erlöse als Kleinunternehmer, § 19 inzwischen aufgegeben: das Formular zeigt, was gebucht wird (#295)", async () => {
  // Drei Zahlungen eines Privatkunden im Vormonat, als noch die Kleinunternehmerregelung galt
  const datum = day(-40);
  const zeile = (zweck: string, betrag: string) =>
    [dkb(datum), dkb(datum), "Gebucht", "Paula Privat", "Max Mustermann", zweck, "Eingang", "DE02100100100006820199", betrag, "", "", ""]
      .map((v) => `"${v}"`)
      .join(";");
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    `${zeile("Fenster putzen 1", "100,00")}\n${zeile("Fenster putzen 2", "200,00")}\n${zeile("Fenster putzen 3", "300,00")}\n`;
  await go("/bank");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "paula.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/3 neue Umsätze/)).toBeVisible({ timeout: 30_000 });

  // Stand im Änderungsprotokoll: im Vormonat Kleinunternehmer, heute nicht mehr (Ausschalten geht jederzeit).
  // Zwei Zahlungen von damals als Erlöse ohne Steuer zugeordnet.
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    await sql`insert into audit_log (at, actor, table_name, row_id, action, new_value)
      values (${`${datum}T12:00:00Z`}::timestamptz, 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: true })}),
             (now(), 'e2e', 'company', '1', 'UPDATE', ${sql.json({ kleinunternehmer: false })})`;
    for (const zweck of ["Fenster putzen 1", "Fenster putzen 2"]) {
      await sql`insert into allocations (transaction_id, kind, amount, category, tax_rate)
        select id, 'kategorie', amount, 'erloese', 0 from bank_transactions where purpose = ${zweck}`;
    }
  } finally {
    await sql.end();
  }

  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await go("/bank");
  await page
    .getByRole("link", { name: /Fenster putzen 3/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Fenster putzen 3")).toBeVisible();
  // Vorgeschlagen und vorbelegt sind Erlöse ohne Steuer; das Formular darf nicht „19 %“ zeigen
  await expect(panel.getByText("Einnahme: Erlöse (Kleinunternehmer)")).toBeVisible();
  await expect(panel.getByLabel("Buchen als")).toHaveValue("kategorie");
  await expect(panel.getByRole("combobox", { name: "Steuersatz", exact: true })).not.toHaveValue("1900");
  await expect(panel.getByText("Als Kleinunternehmer ohne Umsatzsteuer (§ 19 UStG).")).toBeVisible();
  await panel.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.waitForLoadState("networkidle");
  // Gebucht wie angezeigt: ohne Steuer, wie am Tag der Zahlung
  await go("/bank?filter=alle");
  await page
    .getByRole("link", { name: /Fenster putzen 3/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await expect(panel.getByText("Fenster putzen 3")).toBeVisible();
  await expect(panel.getByText("Direkt: Erlöse (Kleinunternehmer)")).toBeVisible();
});

test("Neuer Lieferant aus der E-Rechnung: Anschrift vorbelegt, IBAN nur als Vorschlag zum Übernehmen (#329)", async () => {
  await go("/belege");
  // Eigene Rechnungsnummer, damit die Datei keine Dublette eines anderen Tests ist
  const xml = readFileSync(new URL("../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url), "utf8").replaceAll(
    "RE-2026/0815",
    "RE-2026/0816",
  );
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "RE-2026-0816.xml", mimeType: "application/xml", buffer: Buffer.from(xml) }]);
  await expect(page.getByText("RE-2026-0816.xml: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /Netzwerk Hosting GmbH RE-2026\/0816/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await neuenLieferantenOeffnen(page);
  const dialog = page.getByRole("dialog", { name: "Neuen Lieferanten anlegen" });
  await expect(dialog.getByLabel("Name oder Firma")).toHaveValue("Netzwerk Hosting GmbH");
  await expect(dialog.getByLabel("Straße und Hausnummer")).not.toHaveValue("");
  await expect(dialog.getByLabel("PLZ")).not.toHaveValue("");
  await expect(dialog.getByLabel("Ort")).not.toHaveValue("");
  // Die IBAN steht nicht von selbst im Feld, nur als Vorschlag mit Herkunft und Prüfziffer
  const iban = dialog.getByLabel("IBAN");
  await expect(iban).toHaveValue("");
  await expect(dialog.getByText(/Vorschlag vom Beleg: DE02 1203 0000 0000 2020 51, aus der E-Rechnung \(BT-84\)\. Prüfziffer stimmt\./)).toBeVisible();
  await dialog.getByRole("button", { name: "IBAN übernehmen" }).click();
  await expect(iban).toHaveValue("DE02120300000000202051");
  await expect(iban).toBeFocused();
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Lieferant", { exact: true })).toHaveValue("Netzwerk Hosting GmbH");
});

test("IBAN aus der E-Rechnung ohne Kontakt-IBAN: gesperrt bis zur Bestätigung, auf Wunsch auch in den Kontakt (#410)", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Hosting Süd GmbH");
  await page.getByLabel("Kunde", { exact: true }).uncheck();
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  const kontaktUrl = page.url();

  await go("/belege");
  const xml = readFileSync(new URL("../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url), "utf8").replaceAll(
    "RE-2026/0815",
    "RE-2026/0817",
  );
  await page.locator("input[type=file][multiple]").setInputFiles([{ name: "RE-2026-0817.xml", mimeType: "application/xml", buffer: Buffer.from(xml) }]);
  await expect(page.getByText("RE-2026-0817.xml: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /RE-2026\/0817/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await lieferantWaehlen(page, "Hosting Süd GmbH");
  await waehleKategorie(page.getByLabel("Kategorie"), "software");
  // Auf dem Beleg bleiben: Ein anderer Test lässt einen Beleg offen, zu dem Haben sonst weiterspringt
  await page.getByLabel("Nach dem Buchen zum nächsten offenen Beleg").uncheck();
  await page.getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await expect(page.getByText(/Gebucht .*festgeschrieben/)).toBeVisible();
  const belegUrl = page.url();
  const offen = page.getByRole("region", { name: "IBAN aus der E-Rechnung, noch nicht bestätigt" });
  await expect(offen).toContainText("DE02 1203 0000 0000 2020 51");

  // Bis zur Bestätigung gesperrt, auch für „Alle auswählen“
  await go("/ueberweisungen");
  const zeile = page.locator(".table-row").filter({ hasText: "RE-2026/0817" });
  await expect(zeile.getByRole("checkbox")).toBeDisabled();
  await expect(zeile).toContainText("noch nicht bestätigt");
  const alle = page.getByRole("button", { name: "Alle auswählen" });
  if (await alle.isEnabled()) await alle.click();
  await expect(zeile.getByRole("checkbox")).not.toBeChecked();

  // Übernehmen und zusätzlich in den Kontakt: danach gilt die IBAN des Kontakts, der Hinweis entfällt
  await go(new URL(belegUrl).pathname);
  await offen.getByLabel("Auch im Kontakt des Lieferanten eintragen").check();
  await offen.getByRole("button", { name: "Übernehmen" }).click();
  await expect(offen).toHaveCount(0);
  await go("/ueberweisungen");
  await expect(zeile.getByRole("checkbox")).toBeEnabled();
  await expect(zeile).toContainText("DE02 1203 0000 0000 2020 51");
  await go(new URL(kontaktUrl).pathname);
  await expect(page.getByLabel("IBAN")).toHaveValue(/DE02\s?1203/);
});

test("Sammelrechnung des Dienstleisters: an der Gebührenzeile als bester Treffer, ein Klick ordnet alle Gebühren und Gutschriften des Monats zu (#680)", async ({
  browser,
}) => {
  // Oktober vor dem Vorjahr: ohne Buchungen, damit die übrigen Auswertungen dieses Durchlaufs unverändert bleiben
  const year = YEAR - 2;
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "etsy-gebuehren.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Etsy Ireland UC") }]);
  await expect(page.getByText("etsy-gebuehren.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /etsy-gebuehren\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Lieferant", { exact: true }).fill("Etsy Ireland UC");
  await page.getByLabel("Rechnungsnummer").fill(`ETSY-${year}-10`);
  await page.getByLabel("Belegdatum").fill(`${year}-10-31`);
  await waehleKategorie(page.getByLabel("Kategorie"), "geldverkehr");
  await page.getByRole("combobox", { name: /^Satz/ }).selectOption("0");
  // Gebühren minus Gutschriften unten: 7,44 + 9,89 + 8,19 + 93,77 − 1,50 − 1,22
  await page.getByLabel("Netto", { exact: true }).fill("116,57");
  await page.locator(".doc-actions").getByRole("button", { name: "Bestätigen und buchen" }).click();
  await bestaetigen(page, "Buchen");
  await expect(page.locator(".page-head").getByText("Gebucht", { exact: true })).toBeVisible();

  await go("/bank");
  await kontoVerbinden(page, "Konto ohne Abruf anlegen");
  const neuesKonto = page.locator("form", { has: page.getByRole("button", { name: "Konto anlegen" }) });
  await neuesKonto.getByLabel("Art", { exact: true }).selectOption("provider");
  await neuesKonto.getByLabel("Dienstleister", { exact: true }).selectOption("etsy");
  await neuesKonto.getByLabel("Name", { exact: true }).fill("Etsy Shop");
  await neuesKonto.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByText("Konto angelegt.")).toBeVisible();
  const csv = [
    `Date,Type,Title,Info,Currency,Amount,"Fees & Taxes",Net,"Tax Details"`,
    `"October 1, ${year}",Fee,"Einstellgebühr","",EUR,--,-€7.44,-€7.44,--`,
    `"October 2, ${year}",Fee,"Transaktionsgebühr","",EUR,--,-€9.89,-€9.89,--`,
    `"October 3, ${year}",Fee,"Zahlungsabwicklung","",EUR,--,-€8.19,-€8.19,--`,
    `"October 4, ${year}",Fee,"Werbung","",EUR,--,-€93.77,-€93.77,--`,
    `"October 5, ${year}",Fee,"Credit for transaction fee","",EUR,--,€1.50,€1.50,--`,
    `"October 6, ${year}",Fee,"Gutschrift für Einstellgebühr","",EUR,--,€1.22,€1.22,--`,
  ].join("\n");
  await page
    .locator('input[type=file][aria-label="Kontoauszugsdateien"]')
    .setInputFiles([{ name: "etsy.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  // Der Export nennt kein Konto: die Meldung fragt danach, vorgewählt ist das eben angelegte (#1951)
  const nachfrage = page.getByRole("form", { name: "Konto für etsy.csv" });
  await expect(nachfrage.getByLabel("Konto").locator("option:checked")).toHaveText("Etsy Shop", { timeout: 30_000 });
  await nachfrage.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByText(/6 neue Umsätze für Etsy Shop/)).toBeVisible({ timeout: 30_000 });

  await go("/bank?filter=alle&suche=Etsy");
  const gebuehren = page.locator(".tx-row", { hasText: "Etsy" });
  await expect(gebuehren).toHaveCount(6);
  await gebuehren.filter({ hasText: "7,44" }).click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  // Die einzelne Gebühr passt nie auf die Rechnung; Gebühren und Gutschriften des Monats zusammen schon
  await expect(panel.getByText("Beleg Etsy Ireland UC", { exact: true })).toBeVisible();
  await expect(panel.getByText("Betrag stimmt exakt")).toBeVisible();
  await panel.getByRole("button", { name: `Alle offenen Gebühren aus 10.${year} diesem Beleg zuordnen` }).click();
  await page.waitForLoadState("networkidle");
  for (const zeile of await gebuehren.all()) await expect(zeile).toContainText("Zugeordnet");
});

test("Unbekannte Bank-CSV: Spalten zuordnen, importieren, der nächste Export geht ohne Rückfrage durch (#1275)", async () => {
  // Erfundene Bank mit Kopfblock, Soll und Haben in eigenen Spalten und dem Kontostand in der letzten Zeile
  const datei = readFileSync(new URL("../../../packages/import/test-fixtures/unbekannte-bank-soll-haben.csv", import.meta.url));
  await go("/bank");
  await kontoVerbinden(page, "Konto ohne Abruf anlegen");
  const neuesKonto = page.locator("form", { has: page.getByRole("button", { name: "Konto anlegen" }) });
  await neuesKonto.getByLabel("Name", { exact: true }).fill("Konto ohne Format");
  await neuesKonto.getByLabel("IBAN", { exact: true }).fill("DE75 5121 0800 1245 1261 99");
  await neuesKonto.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByText("Konto angelegt.")).toBeVisible();
  // „Datei importieren“ im Kopf nimmt das Konto aus der Datei; sie nennt keine IBAN, gewählt wird es in der Zuordnung
  const upload = page.locator('input[type=file][aria-label="Kontoauszugsdateien"]');
  await upload.setInputFiles([{ name: "umsaetze.csv", mimeType: "text/csv", buffer: datei }]);
  await expect(page.getByText("umsaetze.csv: Haben kennt diese Bank nicht. Ordne die Spalten einmal selbst zu.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Spalten zuordnen" }).click();

  const dialog = page.getByRole("dialog", { name: "Spalten zuordnen" });
  // Die Vorschau steht oben; Spalten mit einem Wert aus der Datei, Kopfzeile und Zahlenformat eingeklappt
  await expect(dialog.getByRole("status")).toContainText("4 Umsätze, 1 Zeile mit Fehlern, die Haben nicht übernimmt");
  await expect(dialog.getByRole("listitem").filter({ hasText: "Kontostand" })).toContainText("Zeile 9: Buchungstag „Kontostand“ ist kein Datum");
  await expect(dialog.getByLabel("Soll (Ausgänge)")).toHaveValue("15");
  await expect(dialog.getByLabel("Soll (Ausgänge)").locator("option:checked")).toHaveText("Soll – -1.190,00");
  await expect(dialog.getByLabel("Haben (Eingänge)")).toHaveValue("16");
  await expect(dialog.getByLabel("Kopfzeile")).toBeHidden();
  await dialog.getByText("Weitere Spalten, Kopfzeile und Zahlenformat").click();
  // Die leere dritte Zeile zählt nicht mit: Index 2 ist Zeile 4
  await expect(dialog.getByLabel("Kopfzeile")).toHaveValue("2");
  expect(await axeVerstoesse(page)).toEqual([]);

  // Vorgewählt ist das eben angelegte, gewählte Konto (#1951); ohne Konto meldet das Feld den Fehler und bekommt den Fokus
  await expect(dialog.getByLabel("Konto", { exact: true }).locator("option:checked")).toHaveText("Konto ohne Format");
  await dialog.getByLabel("Konto", { exact: true }).selectOption("");
  await dialog.getByRole("button", { name: "4 Umsätze importieren" }).click();
  await expect(dialog.getByLabel("Konto", { exact: true })).toBeFocused();
  await expect(dialog.getByText("Wähle das Konto, zu dem die Datei gehört.")).toBeVisible();
  await dialog.getByLabel("Konto", { exact: true }).selectOption({ label: "Konto ohne Format" });
  // Betrag statt Soll und Haben: die Spalte „Betrag“ ist leer, die Vorschau sagt es
  await dialog.getByLabel("Soll (Ausgänge)").selectOption("");
  await expect(dialog.getByRole("alert")).toHaveText("Ordne den Betrag zu oder Soll und Haben.");
  await dialog.getByLabel("Soll (Ausgänge)").selectOption("15");
  await expect(dialog.getByRole("status")).toContainText("4 Umsätze");
  await dialog.getByRole("button", { name: "4 Umsätze importieren" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("umsaetze.csv: 4 neue Umsätze für Konto ohne Format. Spaltenzuordnung für Konto ohne Format gespeichert.")).toBeVisible();
  await expect(page.getByText(/Zeile 9 nicht übernommen: Buchungstag „Kontostand“ ist kein Datum/)).toBeVisible();

  // Der nächste Export mit derselben Kopfzeile, über „Datei importieren“ des gewählten Kontos: ohne Dialog, ohne Dubletten.
  // Die Datei nennt keine IBAN; erst das Konto bringt die gespeicherte Zuordnung mit (#1951)
  const [auswahl] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("region", { name: "Umsätze" }).getByRole("button", { name: "Datei importieren" }).click(),
  ]);
  await auswahl.setFiles([{ name: "umsaetze-november.csv", mimeType: "text/csv", buffer: datei }]);
  await expect(page.getByText("umsaetze-november.csv: 0 neue Umsätze für Konto ohne Format, 4 schon vorhanden.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Spalten zuordnen" })).toHaveCount(0);

  // Zuordnung ändern: der Dialog beginnt mit der gespeicherten und warnt, wenn eine Änderung die Dubletten berührt
  await page.getByRole("button", { name: "Zuordnung ändern" }).click();
  await expect(dialog.getByText("Zuordnung vom letzten Import in dieses Konto.")).toBeVisible();
  await expect(dialog.getByLabel("Konto", { exact: true })).toHaveValue(/.+/);
  await dialog.getByLabel("Verwendungszweck").selectOption("");
  await expect(dialog.getByText(/Umsätze, die schon importiert sind, erkennt Haben dann nicht mehr als Dubletten/)).toBeVisible();
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toBeHidden();

  await go("/bank?filter=alle");
  await page.getByRole("link", { name: /^Konto ohne Format/ }).click();
  await page.getByLabel("Umsätze durchsuchen").fill("Hafen Immobilien");
  // Die Umsatzliste schreibt das Minus typografisch (U+2212)
  await expect(page.locator(".tx-row", { hasText: "Miete Büro Oktober" })).toContainText("\u22121.190,00 €");
});

test("Seiten mit den Daten dieses Abschnitts ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, ["/anlagen", "/darlehen", "/bank", "/ueberweisungen", ibanBeleg]);
});

test("Wiederzuordnung: je Teil die aufgehobene Zuordnung wählen (#1454)", async () => {
  const buchungstag = dkb(day(-18));
  const aufhebungen = [day(-8), day(-5)];
  const zweck = "Zahlung mit zwei aufgehobenen Teilzuordnungen";
  const csv = [
    '"Girokonto";"DE45 1203 0000 1234 5678 90"',
    '""',
    '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
    [buchungstag, buchungstag, "Gebucht", "Firma Musterkonto", "Mustermann IT", zweck, "Eingang", "", "238,00", "", "", ""]
      .map((wert) => `"${wert}"`)
      .join(";"),
  ].join("\n");
  await go("/bank");
  await page.getByLabel("Kontoauszugsdateien").setInputFiles({ name: "wiederzuordnung.csv", mimeType: "text/csv", buffer: Buffer.from(`\ufeff${csv}`) });
  await expect(page.getByText(/wiederzuordnung\.csv: 1 neue Umsätze/)).toBeVisible();
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    const umsaetze = await sql<{ id: string; bank_account_id: string }[]>`
      select id, bank_account_id from bank_transactions where purpose = ${zweck}`;
    expect(umsaetze).toHaveLength(1);
    const { id, bank_account_id } = umsaetze[0]!;
    await go(`/bank?${new URLSearchParams({ filter: "alle", konto: bank_account_id, umsatz: id, suche: zweck })}`);
    const panel = page.getByRole("complementary", { name: "Zuordnung" });
    for (const anzahl of [1, 2]) {
      const direkt = panel.getByRole("button", { name: "Direkt buchen", exact: true });
      if (await direkt.isVisible()) await direkt.click();
      await panel.getByLabel("Buchen als").selectOption("zinsertrag");
      await panel.getByLabel("Betrag", { exact: true }).fill("119,00");
      await panel.getByRole("button", { name: "Buchen", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Aufheben", exact: true })).toHaveCount(anzahl);
    }
    for (const [i, datum] of aufhebungen.entries()) {
      await panel.getByRole("button", { name: "Aufheben", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Zuordnung aufheben?" });
      await dialog.getByLabel("Tag der Aufhebung").fill(datum);
      await dialog.getByRole("button", { name: "Zuordnung aufheben" }).click();
      await expect(panel.getByText("aufgehoben", { exact: true })).toHaveCount(i + 1);
    }

    await panel.getByRole("button", { name: "Aufteilen", exact: true }).click();
    const form = panel.getByRole("form", { name: "Umsatz aufteilen" });
    for (const teil of [1, 2]) {
      const zeile = form.locator(".split-row").nth(teil - 1);
      await zeile.getByLabel(`Teil ${teil}`, { exact: true }).selectOption("zinsertrag");
      await zeile.getByLabel("Betrag", { exact: true }).fill("119,00");
    }
    const bezuege = form.getByRole("combobox", { name: "Aufgehobene Zuordnung" });
    await expect(bezuege).toHaveCount(2);
    await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
    await expect(bezuege.first()).toBeFocused();
    await expect(bezuege.first()).toHaveAccessibleDescription("Wähle die aufgehobene Zuordnung, zu der der Betrag gehört.");
    for (const [i, datum] of aufhebungen.entries()) {
      const aufgehobenAm = datum.split("-").reverse().join(".");
      const auswahl = bezuege.nth(i);
      const option = auswahl.getByRole("option", { name: new RegExp(aufgehobenAm.replaceAll(".", "\\.")) });
      await expect(option).toHaveText(`Zinserträge · ${aufgehobenAm} · 119,00 €`);
      await auswahl.selectOption((await option.getAttribute("value")) ?? "");
    }
    await form.getByRole("button", { name: "Aufteilen und buchen" }).click();
    await expect(panel.getByRole("button", { name: "Aufteilung aufheben", exact: true })).toBeVisible();
    const zeilen = await sql`select a.date::text as wirksam, r.date::text as aufhebung, j.date::text as journal
      from allocations a join allocations r on r.reverses_id = a.reassigns_id
      join journal_entries j on j.source_id = a.id and j.source_type = 'allocation'
      where a.transaction_id = ${id} order by a.date`;
    expect(zeilen).toEqual(aufhebungen.map((datum) => ({ wirksam: datum, aufhebung: datum, journal: datum })));
  } finally {
    await sql.end();
  }
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
