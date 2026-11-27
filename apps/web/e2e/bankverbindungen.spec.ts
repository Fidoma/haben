import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";
import { gehe, kundeWaehlen, weitereAngabenOeffnen } from "./einrichtung.ts";

/*
 * Weitere Zahlungskonten (#1887, docs/rechnungen-zahlung.md): unter Einstellungen › Firma anlegen, am Kontakt als
 * bevorzugtes Zahlungskonto wählen; der Rechnungseditor schlägt es für diesen Kunden vor, für einen anderen den Standard.
 * Am Ende gelöscht, damit die übrigen Tests von „mit-daten“ den Stand nach „ablauf“ sehen; der Kontakt nimmt dabei
 * wieder den Standard. Was auf dem Beleg und in der E-Rechnung steht, prüft rechnungen/bankverbindung.test.ts.
 */

test.use({ storageState: SESSION });
test.describe.configure({ mode: "serial" });

const BEZEICHNUNG = "Objekt Nord";
const AUSWAHL = `${BEZEICHNUNG} · DE02 1203 0000 0000 2020 51`;

const karte = (page: Page) => page.getByRole("region", { name: "Weitere Zahlungskonten" });

async function kontaktOeffnen(page: Page) {
  await gehe(page, "/kontakte");
  await page
    .getByRole("link", { name: /Nordwerk Software GmbH/ })
    .first()
    .click();
  await expect(page.getByRole("form", { name: "Kontakt" })).toBeVisible();
  await weitereAngabenOeffnen(page);
}

/** Löscht das Zahlungskonto über die Karte, mit Rückfrage */
async function loeschen(page: Page) {
  await gehe(page, "/einstellungen?bereich=firma");
  await karte(page)
    .getByRole("button", { name: `${BEZEICHNUNG} löschen` })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByText(`Zahlungskonto „${BEZEICHNUNG}“ gelöscht.`)).toBeVisible();
}

test("Zahlungskonto anlegen, am Kontakt bevorzugen, im Rechnungsentwurf wählen und löschen", async ({ page }) => {
  await gehe(page, "/rechnungen/neu");
  // Ohne weitere Zahlungskonten bleibt der Editor, wie er war
  await expect(page.getByLabel("Zahlungskonto")).toHaveCount(0);

  await gehe(page, "/einstellungen?bereich=firma");
  await karte(page).getByRole("button", { name: "+ Zahlungskonto" }).click();
  await karte(page).getByRole("button", { name: "Zahlungskonto anlegen" }).click();
  await expect(karte(page).getByLabel("IBAN")).toHaveAccessibleDescription(/Gib die IBAN ein/);
  await karte(page).getByLabel("Bezeichnung").fill(BEZEICHNUNG);
  await karte(page).getByLabel("IBAN").fill("de02 1203 0000 0000 2020 51");
  await karte(page).getByLabel("Bank", { exact: true }).fill("Deutsche Kreditbank");
  await karte(page).getByRole("button", { name: "Zahlungskonto anlegen" }).click();
  await expect(page.getByText(`Zahlungskonto „${BEZEICHNUNG}“ angelegt.`)).toBeVisible();
  await expect(karte(page).getByRole("cell", { name: "DE02 1203 0000 0000 2020 51" })).toBeVisible();

  await kontaktOeffnen(page);
  await page.getByLabel("Bevorzugtes Zahlungskonto").selectOption({ label: AUSWAHL });
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/Gespeichert/)).toBeVisible();

  await gehe(page, "/rechnungen/neu");
  const auswahl = page.getByLabel("Zahlungskonto", { exact: true });
  await expect(auswahl).toHaveValue("");
  await kundeWaehlen(page, "Nordwerk Software GmbH · Hamburg");
  await expect(auswahl.locator("option:checked")).toHaveText(AUSWAHL);
  await kundeWaehlen(page, "Rheinpixel GmbH · Köln");
  await expect(auswahl.locator("option:checked")).toHaveText(/^Standard · DE89 3704/);
  // Bei Lastschrift gilt das Gläubigerkonto aus den Firmendaten: keine Auswahl
  await page.getByLabel("Zahlungsart").selectOption("lastschrift");
  await expect(auswahl).toHaveCount(0);

  // Gelöscht: der Kontakt nimmt wieder den Standard, und ohne weitere Konten steht kein Feld mehr da
  await loeschen(page);
  await kontaktOeffnen(page);
  await expect(page.getByLabel("Bevorzugtes Zahlungskonto")).toHaveCount(0);
});

test.afterAll(async ({ browser }) => {
  // Falls der Test vor dem Löschen abbrach
  const page = await browser.newPage({ storageState: SESSION });
  await gehe(page, "/einstellungen?bereich=firma");
  if (
    await karte(page)
      .getByRole("button", { name: `${BEZEICHNUNG} löschen` })
      .count()
  )
    await loeschen(page);
  await page.close();
});
