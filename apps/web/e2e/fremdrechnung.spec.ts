import { expect, type Page, test } from "@playwright/test";
import { buildEInvoice } from "@haben/einvoice";
import { sampleDocument } from "../../../packages/einvoice/src/samples.ts";
import { day } from "./daten.ts";
import { axeVerstoesse, CUSTOMERS, durchlaufSeite, einrichten, gehe, INVOICES, kontaktAnlegen, kundeWaehlen, rechnungFestschreiben } from "./einrichtung.ts";
import { datei, formularOeffnen, fremdesPdf } from "./fremdrechnung-formular.ts";

/**
 * Eigener Durchlauf zu #660: Ausgangsrechnungen, die ein anderes Programm geschrieben hat, als PDF hochladen und
 * übernehmen. Fremde Nummer und Original bleiben, die Rechnung ist festgeschrieben und gebucht. Geprüft wird, was
 * der Nutzer sieht: PDF ohne E-Rechnung von Hand ausfüllen, Kunden im Formular neu anlegen, eine schon vorhandene
 * Nummer ablehnen und die Angaben aus einer E-Rechnung (ZUGFeRD aus Haben selbst) vorbelegen. Buchung, Zahlung und
 * die Steuerfälle (SKR03/SKR04 × Ist/Soll) prüft fremdrechnung.test.ts.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
let pageErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
});

test.afterAll(async () => {
  await page.context().close();
});

const KUNDE = `${CUSTOMERS[0]!.name} · ${CUSTOMERS[0]!.city}`;

async function angabenEintragen(nummer: string): Promise<void> {
  await page.getByLabel("Rechnungsnummer").fill(nummer);
  await page.getByLabel("Rechnungsdatum").fill(day(-20));
  await page.getByLabel("Fällig am").fill(day(-6));
  await page.getByLabel("Netto 1 (€)").fill("4.000,00");
  await page.getByLabel("Steuer 1 (€)").fill("760,00");
}

test("Einrichtung mit einem Kunden", async () => {
  await einrichten(page);
  await kontaktAnlegen(page, CUSTOMERS[0]!);
});

test("PDF ohne E-Rechnung: Angaben von Hand eintragen, übernehmen, die Rechnung ist festgeschrieben", async () => {
  await formularOeffnen(page);
  await datei(page, "FS-1001.pdf", await fremdesPdf(page, "FS-1001"));
  await expect(page.getByRole("status").filter({ hasText: "keine E-Rechnung" })).toBeVisible();
  expect(await axeVerstoesse(page)).toEqual([]);

  // Ohne Kunden geht es nicht weiter: Der Browser hält das Formular an und setzt den Fokus auf das Feld
  await angabenEintragen("FS-1001");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/rechnungen$/);

  await kundeWaehlen(page, KUNDE);
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Rechnung FS-1001" })).toBeVisible();
  await expect(page.getByText("4.760,00 €").first()).toBeVisible();

  // Die Rechnung steht unter der fremden Nummer in der Liste und läuft als offener Posten weiter
  await gehe(page, "/rechnungen");
  await expect(page.getByRole("link", { name: /FS-1001/ })).toBeVisible();
});

test("Dieselbe Nummer ein zweites Mal wird abgelehnt, es entsteht keine zweite Rechnung", async () => {
  await formularOeffnen(page);
  await datei(page, "FS-1001-nochmal.pdf", await fremdesPdf(page, "FS-1001"));
  await angabenEintragen("FS-1001");
  await kundeWaehlen(page, KUNDE);
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByRole("alert")).toContainText("gibt es in Haben schon");
  await expect(page).toHaveURL(/\/rechnungen$/);
});

test("Fehlt der Kunde, legt man ihn im Formular an und er ist gleich gewählt", async () => {
  await formularOeffnen(page);
  await datei(page, "FS-1002.pdf", await fremdesPdf(page, "FS-1002"));
  await angabenEintragen("FS-1002");
  await page.getByRole("button", { name: "Neuen Kunden anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Neuen Kunden anlegen" });
  await dialog.getByLabel("Name oder Firma").fill("Schreinerei Huber");
  await dialog.getByLabel("Ort").fill("München");
  await dialog.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(dialog).toBeHidden();
  // Das Formular hinter dem Dialog ist unberührt und hat den neuen Kunden
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue(/Schreinerei Huber/);
  await expect(page.getByLabel("Rechnungsnummer")).toHaveValue("FS-1002");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Rechnung FS-1002" })).toBeVisible();
});

test("E-Rechnung im PDF: Nummer, Datum, Betrag und Kunde kommen aus der Datei", async () => {
  // Eine eigene Rechnung hat ein ZUGFeRD-PDF; hochgeladen als „fremde“ ist sie die Vorlage für die Vorbelegung
  await rechnungFestschreiben(page, INVOICES[0]!);
  const nummer = ((await page.getByRole("heading", { level: 1 }).textContent()) ?? "").replace(/^Rechnung\s+/, "").trim();
  const href = await page.getByRole("link", { name: "PDF herunterladen" }).getAttribute("href");
  const antwort = await page.request.get(href ?? "");
  expect(antwort.ok()).toBe(true);
  const pdf = await antwort.body();

  await formularOeffnen(page);
  await datei(page, "eigene-zugferd.pdf", pdf);
  await expect(page.getByLabel("Rechnungsnummer")).toHaveValue(nummer);
  await expect(page.getByLabel("Rechnungsdatum")).toHaveValue(INVOICES[0]!.date);
  await expect(page.getByLabel("Steuer 1 (€)")).not.toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Kunde", exact: true })).toHaveValue(KUNDE);
  await expect(page.getByRole("status")).toHaveCount(0);

  // Es ist die eigene Rechnung: die Nummer gibt es schon
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByRole("alert")).toContainText("gibt es in Haben schon");
});

test("Steuerbehandlung: nur, was die Übernahme annimmt; die Befreiungsvorschrift ist nur bei „steuerfrei“ Pflicht", async () => {
  await formularOeffnen(page);
  await datei(page, "FS-1003.pdf", await fremdesPdf(page, "FS-1003"));
  const behandlung = page.getByLabel("Steuerbehandlung");
  const vorschrift = page.getByLabel("Befreiungsvorschrift");
  // Nicht angeboten: Kleinunternehmer ohne eingeschaltete Einstellung
  await expect(behandlung.locator("option[value=kleinunternehmer]")).toHaveCount(0);
  await expect(behandlung.locator("option[value=steuerfrei]")).toHaveCount(1);
  await expect(vorschrift).toHaveCount(0);
  // Regulär zwei Sätze; beim Wechsel ohne deutsche Umsatzsteuer rechnet Haben die Nettobeträge zusammen (#1880)
  await page.getByLabel("Netto 1 (€)").fill("1.000,00");
  await page.getByLabel("Steuer 1 (€)").fill("190,00");
  await page.getByRole("button", { name: "Weiteren Steuersatz" }).click();
  await page.getByLabel("Steuersatz 2").selectOption("700");
  await page.getByLabel("Netto 2 (€)").fill("500,00");
  await page.getByLabel("Steuer 2 (€)").fill("35,00");
  await behandlung.selectOption("steuerfrei");
  await expect(vorschrift).toHaveJSProperty("required", true);
  // Die Vorschrift steht im Hinweis unter der Auswahl, nicht im Namen
  await expect(behandlung).toHaveAccessibleDescription(/Steuerbefreiung nach § 4 UStG/);
  // Ohne deutsche Umsatzsteuer gilt 0 %: nur der Nettobetrag, zusammengefasst aus den Zeilen (#1880)
  await expect(page.getByLabel("Steuersatz 1")).toHaveCount(0);
  await expect(page.getByLabel("Steuer 1 (€)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Weiteren Steuersatz" })).toHaveCount(0);
  await expect(page.getByLabel("Netto (€)")).toHaveValue("1.500,00");
  await behandlung.selectOption("ig_lieferung");
  await expect(behandlung).toHaveAccessibleDescription(/§ 4 Nr\. 1 Buchst\. b, § 6a UStG/);
  await expect(page.getByLabel("Netto (€)")).toHaveValue("1.500,00");
  // Zurück auf regulär: eine Zeile zu 0 % ohne Steuer, wie im Rechnungseditor
  await behandlung.selectOption("regulaer");
  await expect(page.getByLabel("Steuersatz 1")).toHaveValue("0");
  await expect(page.getByLabel("Netto 1 (€)")).toHaveValue("1.500,00");
  await expect(page.getByLabel("Steuer 1 (€)")).toHaveValue("0,00");
  await expect(page.getByLabel("Steuersatz 2")).toHaveCount(0);
});

test("Auslandsleistung: Leistungsort wie im Rechnungseditor, bei der sonstigen EU-Leistung Pflicht, nie aus der Kundenanschrift vorbelegt (#1392)", async () => {
  await formularOeffnen(page);
  await datei(page, "FS-1005.pdf", await fremdesPdf(page, "FS-1005"));
  const behandlung = page.getByLabel("Steuerbehandlung");
  const land = page.getByLabel("Land des tatsächlichen Leistungsorts");
  const auslandsSteuer = page.getByLabel("Ausländische Umsatzsteuer");
  await expect(land).toHaveCount(0);
  await behandlung.selectOption("drittland");
  await expect(land).toHaveValue("");
  await expect(land).toHaveJSProperty("required", false);
  await expect(page.getByText("Gesamtumsatz: Leistungsort ungeklärt.")).toBeVisible();
  await land.fill("ch");
  await expect(land).toHaveValue("CH");
  await auslandsSteuer.selectOption("bestaetigt");
  await expect(page.getByText("Gesamtumsatz: Leistungsort ungeklärt.")).toHaveCount(0);
  // Eine andere Behandlung verlangt eine neue Bestätigung
  await behandlung.selectOption("eu_sonstige");
  await expect(land).toHaveValue("");
  await expect(land).toHaveJSProperty("required", true);
  await expect(auslandsSteuer).toHaveJSProperty("required", true);
  await behandlung.selectOption("regulaer");
  await expect(land).toHaveCount(0);
});

test("Ein negativer Betrag wird schon im Formular abgefangen", async () => {
  await formularOeffnen(page);
  await datei(page, "FS-1004.pdf", await fremdesPdf(page, "FS-1004"));
  await angabenEintragen("FS-1004");
  await page.getByLabel("Netto 1 (€)").fill("-100,00");
  await kundeWaehlen(page, KUNDE);
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByRole("alert")).toContainText("Trag Netto und Steuer als Betrag ab 0 ein, etwa 1.000,00.");
  await expect(page).toHaveURL(/\/rechnungen$/);
});

test("Storno aus dem Fremdsystem: E-Rechnung mit Bezug (BT-25) auf eine übernommene Rechnung (#1900)", async () => {
  // Rechnung und Storno als ZUGFeRD aus einem anderen Programm; das Storno nennt die Rechnung als vorausgegangene
  const leistung = { issueDate: day(-20), dueDate: day(-6), serviceFrom: day(-20), serviceTo: day(-20) };
  const rechnung = { ...sampleDocument({ number: "SHOP-R1" }), ...leistung };
  const storno = {
    ...sampleDocument({ kind: "storno", number: "SHOP-S1" }),
    ...leistung,
    issueDate: day(-5),
    corrects: { number: "SHOP-R1", issueDate: day(-20) },
  };
  const rechnungPdf = Buffer.from((await buildEInvoice(rechnung)).pdf);
  const stornoPdf = Buffer.from((await buildEInvoice(storno)).pdf);

  await formularOeffnen(page);
  await datei(page, "SHOP-R1.pdf", rechnungPdf);
  await kundeWaehlen(page, KUNDE);
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);

  await formularOeffnen(page);
  await page.locator("input[type=file]").setInputFiles({ name: "SHOP-S1.pdf", mimeType: "application/pdf", buffer: stornoPdf });
  const form = page.getByRole("form", { name: "Storno aus dem Fremdsystem" });
  await expect(form.getByRole("status").filter({ hasText: "Die Datei storniert" })).toContainText("Die Datei storniert die Rechnung SHOP-R1");
  await expect(form).toContainText("SHOP-S1");
  // Kein Rechnungsformular mit negativen Beträgen
  await expect(page.getByRole("form", { name: "Angaben zur Rechnung" })).toHaveCount(0);
  expect(await axeVerstoesse(page), "Storno aus dem Fremdsystem").toEqual([]);
  await form.getByRole("button", { name: "Storno übernehmen" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Stornorechnung\s+SHOP-S1/);
});

test("Keine Seitenfehler im ganzen Durchlauf", () => {
  expect(pageErrors).toEqual([]);
});
