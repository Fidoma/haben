import { waehleKategorie } from "./kategorie.ts";
import { filePickerPruefen } from "./dateiauswahl.ts";
import AxeBuilder from "@axe-core/playwright";
import { periodKey, periodLabel } from "@haben/core";
import { naechsterTermin } from "@haben/elster/vorauszahlung-zeitraum";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { currentDay, day, YEAR } from "./daten.ts";
import { type Durchlauf, databaseUrlFuer } from "./durchlaeufe.ts";
import {
  bestaetigen,
  faktenZeigen,
  dkb,
  durchlaufSeite,
  fristenOeffnen,
  gehe,
  kundeWaehlen,
  neuenLieferantenOeffnen,
  weitereAngabenOeffnen,
  ohneAxeVerstoesse,
} from "./einrichtung.ts";
import { abzugEinspielen } from "./abzug.ts";
import { receiptJpeg } from "./belegbild.ts";
import { ustIdBestaetigungPruefen, zmBestaetigungPruefen } from "./ustid-bestaetigung.ts";
import { abgearbeitet } from "./warten.ts";
import { eingabeNachAktion, fokusNachFehlschlag, gesperrtBisNeuGeladen, kurzNacheinanderSpeichern } from "./felder-sperre.ts";

/**
 * Abschnitt von belege-steuern (#1742) mit eigenem Server und eigener Datenbank, parallel zu den anderen Abschnitten:
 * Kontakte mit gleicher USt-IdNr., Bestätigung beim BZSt, Umsatzsteuer: Voranmeldung, Dauerfristverlängerung,
 * Zusammenfassende Meldung, innergemeinschaftliche Lieferung und Erwerb, Skonto und eine außerhalb von Haben abgegebene
 * Voranmeldung. Beginnt mit dem Abzug nach Einrichtung und Steuerdaten in belege-steuern.spec.ts (e2e/abzug.ts).
 */

const DURCHLAUF = "belege-steuern-erklaerungen" satisfies Durchlauf;

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

test("Dialog „Neuen Lieferanten anlegen“: Der wählbare Lieferant wird angeboten, auch wenn ein Kunde mit derselben USt-IdNr. davor steht", async () => {
  // Sechs Kunden (Niederlassungen) vor dem Lieferanten: Der Server liefert nur fünf Treffer, der Lieferant fehlt also, wenn
  // die gewünschte Rolle nicht bis dorthin gelangt
  const KUNDEN = ["AAA", "AAB", "AAC", "AAD", "AAE", "AAF"].map((k) => `${k} Wahl Kunde GmbH`);
  for (const [name, kunde, lieferant] of [...KUNDEN.map((n) => [n, true, false] as const), ["ZZZ Wahl Lieferant GmbH", false, true] as const]) {
    await go("/kontakte/neu");
    await page.getByLabel("Name oder Firma").fill(name);
    if (!kunde) await page.getByLabel("Kunde", { exact: true }).uncheck();
    if (lieferant) await page.getByLabel("Lieferant", { exact: true }).check();
    await page.getByLabel("USt-IdNr.").fill("DE100000020");
    await page.getByRole("button", { name: "Kontakt anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  }

  await go("/dauerbelege/neu");
  await neuenLieferantenOeffnen(page, "Probe Neu");
  const dialog = page.getByRole("dialog", { name: "Neuen Lieferanten anlegen" });
  await dialog.getByLabel("USt-IdNr.").fill("DE100000020");
  // Der Server nennt beide; der Hinweis nimmt den, den man als Lieferanten wählen kann, nicht den Kunden davor
  await expect(dialog.getByRole("status")).toContainText("gibt es schon „ZZZ Wahl Lieferant GmbH“ (Lieferant)");
  await expect(dialog.getByRole("button", { name: "„ZZZ Wahl Lieferant GmbH“ wählen" })).toBeVisible();

  // Nicht speichern; beide archivieren, damit die folgenden Tests unverändert rechnen
  for (const name of [...KUNDEN, "ZZZ Wahl Lieferant GmbH"]) {
    await go("/kontakte");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Archivieren" }).click();
    await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  }
});

test("Kontaktformular: Gleiche USt-IdNr. wird gemeldet, auch beim archivierten Kontakt; der eigene Kontakt meldet sich nicht", async () => {
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Altbestand USt GmbH");
  await page.getByLabel("USt-IdNr.").fill("DE555555555");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();

  // Ein Kontakt mit beiden Rollen: Im normalen Formular fehlt ihm keine Rolle, der Hinweis sagt das nicht
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Beides USt GmbH");
  await page.getByLabel("Lieferant", { exact: true }).check();
  await page.getByLabel("USt-IdNr.").fill("DE777777777");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Dritter USt GmbH");
  await page.getByLabel("USt-IdNr.").fill("DE777777777");
  const beides = page.getByRole("status").filter({ hasText: "gibt es schon" });
  await expect(beides).toContainText("gibt es schon „Beides USt GmbH“ (Kunde, Lieferant)");
  await expect(beides).not.toContainText("Ergänze dort die Rolle");
  await expect(beides.getByRole("link", { name: "„Beides USt GmbH“ öffnen" })).toBeVisible();

  // Im normalen Formular, nicht nur im Dialog: Der archivierte Kontakt kann man nicht wählen, nur wiederherstellen
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Neubestand USt GmbH");
  await page.getByLabel("USt-IdNr.").fill("DE555555555");
  const hinweis = page.getByRole("status").filter({ hasText: "gibt es schon" });
  await expect(hinweis).toContainText("gibt es schon „Altbestand USt GmbH“ (Kunde, archiviert)");
  await expect(hinweis).toContainText("Stelle ihn unter Kontakte wieder her");
  await expect(hinweis).not.toContainText("Ergänze dort die Rolle");
  await expect(hinweis.getByRole("link", { name: "„Altbestand USt GmbH“ öffnen" })).toBeVisible();
  await page.getByLabel("USt-IdNr.").fill("DE666666666");
  await expect(hinweis).toHaveCount(0);
  // Die Abfrage, die das Formular beim Bearbeiten nach dem Anlegen stellt: mit excludeId, also nicht schon die beim Anlegen
  const eigeneAbfrage = page.waitForResponse((antwort) => {
    const url = new URL(antwort.url());
    return url.pathname.startsWith("/_serverFn/") && url.search.includes("DE666666666") && url.search.includes("excludeId");
  });
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Beim Bearbeiten nennt der Server den eigenen Kontakt nicht (excludeId), wohl aber einen fremden mit derselben USt-IdNr.
  await (await eigeneAbfrage).finished();
  await abgearbeitet(page);
  await expect(hinweis).toHaveCount(0);
  await page.getByLabel("USt-IdNr.").fill("DE555555555");
  await expect(hinweis).toContainText("gibt es schon „Altbestand USt GmbH“");
  await page.getByLabel("USt-IdNr.").fill("DE666666666");
  await expect(hinweis).toHaveCount(0);

  // Nicht speichern; den neuen Kontakt und den mit beiden Rollen archivieren, damit die folgenden Tests unverändert rechnen
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
  await go("/kontakte");
  await page.getByRole("link", { name: /Beides USt GmbH/ }).click();
  await page.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByRole("button", { name: "Wiederherstellen" })).toBeVisible();
});

ustIdBestaetigungPruefen(() => page, DURCHLAUF);

test("Auswertungen, Umsatzsteuer und Jahreserklärung laden", async () => {
  await go("/auswertungen");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Beträge rechtsbündig, Monate mittig: TanStack Redact 0.3.1 setzt das SVG-Attribut textAnchor nicht um,
  // deshalb steht es im Stil, und dieser Test prüft, was der Browser daraus macht
  const anchors = await page.locator(".chart .tick").evaluateAll((ticks) => ticks.map((tick) => getComputedStyle(tick).textAnchor));
  expect(anchors).toContain("end");
  expect(anchors).toContain("middle");
  await go("/umsatzsteuer");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await go(`/jahreserklaerung/${YEAR - 1}`);
  await expect(page.getByRole("heading", { name: /Steuerjahr/ })).toBeVisible();
  // Mit Cent gehen Kapitalertragsteuern und Nr. 3 bis 7 der Lohnsteuerbescheinigungen (LStB_1_5_Einz: GeldBetragMitCent),
  // die Summe des Bruttoarbeitslohns (E0200201) ohne Cent; die Sozialversicherung laut Nr. 22 bis 27 geht in die Anlage
  // Vorsorgeaufwand, ebenfalls ohne Cent (E2000401, E2000801: GeldBetragOhneCent); Jahresdokumentation E10 2025, ERiC 45.1.5.0
  const centHinweis = page.getByRole("form", { name: "Angaben zur Einkommensteuer" }).getByText(/ELSTER bekommt volle Euro/);
  await expect(centHinweis).toContainText("mit Cent nur die Steuern auf Kapitalerträge und Nr. 3 bis 7 der Lohnsteuerbescheinigungen");
  await expect(centHinweis).toContainText("die Summe des Bruttoarbeitslohns ohne Cent");
  // Ohne eigene Hersteller-ID: Werte für die Erweiterung, die Mein ELSTER ausfüllt
  await expect(
    page.getByRole("region", { name: /^Anlage EÜR \d{4} in Mein ELSTER$/ }).getByRole("button", { name: "Werte für Mein ELSTER kopieren" }),
  ).toBeVisible();
  await go("/finanzamt");
  await expect(page.getByRole("heading", { name: "Finanzamt", level: 1 })).toBeVisible();
  // Nicht lesbare Vorauszahlung: die Meldung steht sofort am Feld, es gibt keinen eigenen Knopf (#1270)
  const vorauszahlung = page.getByRole("region", { name: /^Einkommensteuer-Vorauszahlungen \d{4}$/ });
  const bisher = vorauszahlung.getByLabel("Bisherige Vorauszahlung je Quartal (€)");
  const antrag = page.getByRole("region", { name: "Herabsetzung der Vorauszahlungen" }).getByLabel("Begründung", { exact: true });
  await bisher.fill("12€50");
  await expect(vorauszahlung.getByText("Trag die Vorauszahlung je Quartal ein, etwa 1.500,00, oder lass das Feld leer.")).toBeVisible();
  await expect(bisher).toHaveAttribute("aria-invalid", "true");
  // Der Antrag nennt den Betrag erst, wenn er lesbar ist; ein negativer Betrag stand bisher darin
  await expect(antrag).not.toHaveValue(/bisher festgesetzten Vorauszahlungen/);
  await bisher.fill("-100");
  await expect(vorauszahlung.getByText("Trag die Vorauszahlung je Quartal ein, etwa 1.500,00, oder lass das Feld leer.")).toBeVisible();
  await expect(antrag).not.toHaveValue(/bisher festgesetzten Vorauszahlungen/);
  await bisher.fill("1.500,00");
  await expect(vorauszahlung.getByText("Trag die Vorauszahlung je Quartal ein")).toHaveCount(0);
  await expect(antrag).toHaveValue(/bisher festgesetzten Vorauszahlungen von 1\.500,00\s€ je Quartal/);
});

test("Finanzamt: Antrag mit Quartal und Jahr als ELSTER-Datenart AnpassungVorauszahlung (#1329)", async () => {
  const jahr = Number(currentDay().slice(0, 4));
  await go("/finanzamt");
  const karte = page.getByRole("region", { name: "Herabsetzung der Vorauszahlungen" });
  const begruendung = karte.getByLabel("Begründung", { exact: true });
  await expect(karte.getByRole("textbox", { name: "Betreff" })).toHaveCount(0);
  // Vorschlag: Quartal des nächsten Fälligkeitstermins, nach dem 10.12. das 1. Quartal des Folgejahres
  const vorschlag = naechsterTermin(currentDay());
  await expect(karte.getByLabel("Jahr")).toHaveValue(String(vorschlag.jahr));
  await expect(begruendung).toHaveValue(
    new RegExp(`die Vorauszahlungen zur Einkommensteuer für ${vorschlag.jahr} ab dem ${vorschlag.quartal.slice(1)}\\. Quartal`),
  );
  // ELSTER nimmt das laufende Jahr, das nächste und die drei davor (Regel eEing_144)
  await expect(karte.getByLabel("Jahr").locator("option")).toHaveText([jahr + 1, jahr, jahr - 1, jahr - 2, jahr - 3].map(String));
  await karte.getByLabel("Ab Quartal").selectOption({ label: "Nachträgliche Vorauszahlung" });
  await karte.getByLabel("Jahr").selectOption(String(jahr - 1));
  await expect(begruendung).toHaveValue(new RegExp(`die nachträgliche Vorauszahlung zur Einkommensteuer für ${jahr - 1} herabzusetzen`));

  await page.getByRole("form", { name: "Über ELSTER senden" }).getByRole("button", { name: "Nur prüfen" }).click();
  await expect(page.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    const [zeile] = await sql<{ topic: string; betreff: string; request_xml: string }[]>`
      select topic, betreff, request_xml from elster_messages order by created_at desc limit 1`;
    expect(zeile!.topic).toBe("vorauszahlung");
    expect(zeile!.betreff).toBe(`Anpassung der Einkommensteuer-Vorauszahlungen ${jahr - 1}, nachträgliche Vorauszahlung`);
    expect(zeile!.request_xml).toContain("<DatenArt>AnpassungVorauszahlung</DatenArt>");
    expect(zeile!.request_xml).toMatch(new RegExp(`<Steuerart>0030</Steuerart>\\s*<Quartal>nVz</Quartal>\\s*<Jahr>${jahr - 1}</Jahr>`));
    // Der Zeitraum im Brief steht mit Bindestrich: den Gedankenstrich kennt der Zeichensatz von ELSTER nicht
    expect(zeile!.request_xml).toMatch(/für \d{2}\.\d{2}\.\d{4}-\d{2}\.\d{2}\.\d{4}/);
  } finally {
    await sql.end();
  }
});

test("Umsatzsteuer öffnet ohne Abgabe in Haben den zuletzt abgelaufenen Zeitraum, nie den laufenden (#1102)", async () => {
  // Bis hier ist in diesem Durchlauf nichts gesendet oder vermerkt und kein Zeitraum eingestellt: also der Vormonat
  const [jahr, monat] = currentDay().split("-").map(Number) as [number, number];
  const vormonat = monat === 1 ? { year: jahr - 1, month: 12 } : { year: jahr, month: monat - 1 };
  await go("/umsatzsteuer");
  await expect(page).toHaveURL(new RegExp(`/umsatzsteuer/${periodKey(vormonat)}$`));
  await expect(page.getByRole("heading", { level: 1, name: periodLabel(vormonat) })).toBeVisible();
});

test("Voranmeldung als XML für den Import in Mein ELSTER herunterladen", async () => {
  await go("/umsatzsteuer");
  const save = page.getByRole("button", { name: "Entwurf speichern" });
  if (await save.isEnabled()) {
    await save.click();
    await expect(save).toBeDisabled();
  }
  const link = page.getByRole("link", { name: "XML für Mein ELSTER" });
  await expect(link).toBeVisible();
  // Zweiter Weg ohne Hersteller-ID: Werte für die Erweiterung
  await expect(page.getByRole("button", { name: "Werte für Mein ELSTER kopieren" })).toBeEnabled();
  const response = await page.request.get((await link.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/xml; charset=ISO-8859-15");
  expect(response.headers()["content-disposition"]).toMatch(/filename="UStVA_\d{4}-\d{2}\.xml"/);
  const xml = new TextDecoder("iso-8859-15").decode(await response.body());
  expect(xml).toMatch(
    /^<\?xml version="1.0" encoding="ISO-8859-15" standalone="no"\?>\n<Anmeldungssteuern xmlns="http:\/\/finkonsens.de\/elster\/elsteranmeldung\/ustva\/v\d{4}"/,
  );
  expect(xml).not.toContain("<TransferHeader");
});

test("Voranmeldung vierteljährlich: Zeitraum einstellen, Quartal prüfen und testweise senden", async () => {
  // Im Folgejahr, damit die übrigen Seiten und Bilder beim monatlichen Zeitraum bleiben
  const next = YEAR + 1;
  await go(`/umsatzsteuer/${next}-01`);
  await fristenOeffnen(page);
  const card = page.getByRole("form", { name: `Voranmeldungszeitraum ${next}` });
  await expect(card).toContainText("monatlich");
  await card.getByRole("combobox", { name: "Zeitraum" }).selectOption("vierteljaehrlich");
  await card.getByLabel("Gilt ab").selectOption("1");
  await card.getByRole("button", { name: "Zeitraum speichern" }).click();
  await expect(card.getByRole("status")).toContainText(`Voranmeldungszeitraum ${next} gespeichert.`);
  // Der Januar passt nicht mehr dazu
  await expect(page.getByText(`Für Januar ${next} passt die Voranmeldung nicht zum eingestellten Zeitraum (vierteljährlich).`)).toBeVisible();

  await go(`/umsatzsteuer/${next}-Q1`);
  await expect(page.getByRole("heading", { level: 1, name: `1. Quartal ${next}` })).toBeVisible();
  // 10. April oder der nächste Werktag danach (§ 108 Abs. 3 AO)
  await expect(page.getByText("Fällig am", { exact: false })).toContainText(`April ${next}`);
  // axe prüft das Quartal und den Bereich Voranmeldungszeitraum in barrierefreiheit.spec.ts

  // Die Voranmeldung, nicht der Antrag auf Dauerfristverlängerung daneben. Nach Prüfen und Senden lädt die Seite neu und
  // baut das Formular auf (Schlüssel aus dem Stand des Entwurfs), PIN und Auswahl sind danach leer; die Meldung kommt
  // erst mit den neuen Daten (#1824). Erst weiter, wenn der Verlauf den neuen Eintrag zeigt
  const elster = page.getByRole("form", { name: "An ELSTER übermitteln" });
  const history = page.getByRole("region", { name: `Verlauf 1. Quartal ${next}` });
  await elster.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(page.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await expect(history).toContainText(/Prüfung\s*OK/);
  const testSend = elster.getByRole("button", { name: "Prüfen und testweise senden" });
  await elster.getByLabel("Zertifikats-PIN").fill("123456");
  await testSend.click();
  await expect(page.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(history).toContainText(/Testübermittlung\s*OK/);

  // Zurück auf monatlich: Der Entwurf des Quartals bleibt mit seinem Verlauf, lässt sich aber nicht mehr senden
  await fristenOeffnen(page);
  const frequency = page.getByRole("form", { name: `Voranmeldungszeitraum ${next}` });
  await frequency.getByRole("combobox", { name: "Zeitraum" }).selectOption("monatlich");
  await frequency.getByRole("button", { name: "Zeitraum speichern" }).click();
  await expect(frequency.getByRole("status")).toContainText(`Voranmeldungszeitraum ${next} gespeichert.`);
  await expect(frequency).toContainText("Eingestellt: monatlich");
  await expect(page.getByText(`Für 1. Quartal ${next} passt die Voranmeldung nicht zum eingestellten Zeitraum (monatlich).`)).toBeVisible();
});

test("Dauerfristverlängerung: Sondervorauszahlung prüfen und testweise senden, Kz 39 im Dezember", async () => {
  // Im Folgejahr, damit die übrigen Seiten und Bilder ohne Dauerfristverlängerung bleiben
  const next = YEAR + 1;
  await go(`/umsatzsteuer/${next}-01`);
  await fristenOeffnen(page);
  const card = page.getByRole("region", { name: `Dauerfristverlängerung ${next}` });
  await expect(card).toContainText("Nicht eingetragen");
  const amount = card.getByRole("textbox", { name: "Sondervorauszahlung (Kz 38, volle Euro)" });
  await amount.fill("1.234,56");
  await expect(card.getByText("Trag die Sondervorauszahlung in vollen Euro ein, etwa 4.000,00.")).toBeVisible();
  await amount.fill("1.234");
  const submit = card.getByRole("form", { name: "Sondervorauszahlung an ELSTER" });
  await submit.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(submit.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await submit.getByLabel("Zertifikats-PIN").fill("123456");
  await submit.getByRole("button", { name: "Prüfen und testweise senden" }).click();
  await expect(submit.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(card.getByRole("list", { name: `Verlauf Dauerfristverlängerung ${next}` })).toContainText("Testübermittlung OK");

  // Außerhalb von Haben beantragt: von Hand eintragen, dann zieht der Dezember die Sondervorauszahlung ab
  const manual = card.getByRole("form", { name: "Außerhalb von Haben" });
  await manual.getByRole("checkbox", { name: `Dauerfristverlängerung besteht für ${next}` }).check();
  await manual.getByRole("button", { name: "Stand speichern" }).click();
  await expect(manual.getByRole("status")).toContainText(`Dauerfristverlängerung für ${next} eingetragen.`);
  await expect(card).toContainText("Voranmeldungen sind einen Monat später fällig");

  await go(`/umsatzsteuer/${next}-12`);
  await expect(page.getByText("Abzug der festgesetzten Sondervorauszahlung")).toBeVisible();
  await expect(page.locator("#kz-39")).toHaveText(/1\.234,00/);
  // Dezember mit Dauerfristverlängerung: fällig im Februar
  await expect(page.getByText("Fällig am", { exact: false })).toContainText(`Februar ${next + 1}`);

  // Wieder beenden, damit Fristen und Bilder ohne Verlängerung bleiben
  await go(`/umsatzsteuer/${next}-01`);
  await fristenOeffnen(page);
  const again = page.getByRole("region", { name: `Dauerfristverlängerung ${next}` }).getByRole("form", { name: "Außerhalb von Haben" });
  await again.getByRole("checkbox", { name: `Dauerfristverlängerung besteht für ${next}` }).uncheck();
  await again.getByRole("button", { name: "Stand speichern" }).click();
  await expect(again.getByRole("status")).toContainText(`Dauerfristverlängerung ab ${next} beendet.`);
});

test("Zusammenfassende Meldung: Leistung ins EU-Ausland, Quartal prüfen und testweise senden", async () => {
  // Im Folgejahr wie die Dauerfristverlängerung, damit die Zahlen des laufenden Jahres und die Bilder gleich bleiben
  const next = YEAR + 1;
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByLabel("USt-IdNr.").fill("DE136695976");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Donaublick GmbH");
  await page.getByLabel("Straße und Hausnummer").fill("Praterstraße 3");
  await page.getByLabel("PLZ").fill("1020");
  await page.getByLabel("Ort").fill("Wien");
  await page.getByLabel("Land (z. B. DE)").fill("AT");
  await page.getByLabel("USt-IdNr.").fill("ATU12345678");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Donaublick GmbH · Wien");
  await page.getByLabel("Rechnungsdatum").fill(`${next}-02-10`);
  await page.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("reverse_charge");
  // Der Paragraf steht im Hinweis unter der Auswahl, nicht im Namen der Auswahl
  await expect(page.getByRole("combobox", { name: "Umsatzsteuer", exact: true })).toHaveAccessibleDescription(/sonstige Leistungen, § 3 Abs\. 9 UStG/);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung Cloud-Architektur");
  await page.getByLabel("Menge Position 1").fill("2");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1.200,50");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  // Die Voranmeldung des Monats verweist auf die Meldung des Quartals
  await go(`/umsatzsteuer/${next}-02`);
  await page.getByRole("link", { name: "Zur Zusammenfassenden Meldung" }).click();
  await expect(page).toHaveURL(new RegExp(`/umsatzsteuer/zm/${next}-Q1$`));
  await expect(page.getByRole("heading", { name: `1. Quartal ${next}` })).toBeVisible();
  const zeilen = page.getByRole("table", { name: `Meldezeilen 1. Quartal ${next}` });
  await expect(zeilen).toContainText("ATU12345678");
  await expect(zeilen).toContainText("Sonstige Leistung");
  await expect(zeilen).toContainText("2.401 €");

  const submit = page.getByRole("form", { name: "Meldung an das BZSt" });
  await submit.getByRole("button", { name: "Nur prüfen" }).click();
  await expect(submit.getByText("ERiC hat die Daten geprüft, keine Fehler.")).toBeVisible();
  await submit.getByLabel("Zertifikats-PIN").fill("123456");
  await submit.getByRole("button", { name: "Prüfen und testweise senden" }).click();
  await expect(submit.getByText(/Testübermittlung erfolgreich/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText("Testübermittlung OK");
  // Eine Testübermittlung zählt nicht als gemeldet: weiter als Erstmeldung
  await expect(page.getByRole("form", { name: "Meldung an das BZSt" })).toBeVisible();
});

zmBestaetigungPruefen(() => page);

test("Innergemeinschaftliche Lieferung: Kz 41 in der Voranmeldung und Umsatzart L in der Zusammenfassenden Meldung", async () => {
  // Nach der Zusammenfassenden Meldung oben: USt-IdNr. in den Firmendaten und der Kunde in Wien sind angelegt
  const next = YEAR + 1;
  await go("/rechnungen/neu");
  await kundeWaehlen(page, "Donaublick GmbH · Wien");
  await page.getByLabel("Rechnungsdatum").fill(`${next}-05-12`);
  await page.getByRole("combobox", { name: "Umsatzsteuer", exact: true }).selectOption("ig_lieferung");
  await expect(page.getByText(/Gelangensnachweis \(§ 17a UStDV\)/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Umsatzsteuer", exact: true })).toHaveAccessibleDescription(/§ 4 Nr\. 1 Buchst\. b, § 6a UStG/);
  await page.getByLabel("Beschreibung Position 1").fill("Industrierechner");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("3.000,00");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });

  await go(`/umsatzsteuer/${next}-05`);
  await expect(page.getByText("Steuerfreie innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.")).toBeVisible();
  await expect(page.locator("#kz-41")).toHaveText(/3\.000,00/);
  await page.getByRole("link", { name: "Zur Zusammenfassenden Meldung" }).click();
  await expect(page).toHaveURL(new RegExp(`/umsatzsteuer/zm/${next}-Q2$`));
  const zeilen = page.getByRole("table", { name: `Meldezeilen 2. Quartal ${next}` });
  await expect(zeilen).toContainText("ATU12345678");
  await expect(zeilen).toContainText("Innergemeinschaftliche Lieferung");
  await expect(zeilen).toContainText("3.000 €");
  await expect(page.getByText(/Gelangensnachweis \(§ 17a UStDV\)/)).toBeVisible();
});

test("Beleg mit innergemeinschaftlichem Erwerb: 500 € netto, 95 € Erwerbsteuer, gezahlt wird netto", async ({ browser }) => {
  await go("/belege");
  await page
    .locator("input[type=file][multiple]")
    .setInputFiles([{ name: "hardware-nl.jpg", mimeType: "image/jpeg", buffer: await receiptJpeg(browser, "Hollandse Hardware B.V.") }]);
  await expect(page.getByText("hardware-nl.jpg: abgelegt.")).toBeVisible();
  await page
    .getByRole("link", { name: /hardware-nl\.jpg/ })
    .first()
    .click();
  await page.waitForURL(/belege\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await weitereAngabenOeffnen(page);
  await page.getByLabel(/^USt-IdNr\. des Lieferanten/).fill("NL123456789B01");
  await waehleKategorie(page.getByLabel("Kategorie"), "wareneinkauf");
  await page.getByLabel("Netto", { exact: true }).fill("500");
  await page.getByLabel("Vorsteuer", { exact: true }).fill("0");
  await expect(page.getByText(/bei Ware ein innergemeinschaftlicher Erwerb/)).toBeVisible();
  await page.getByRole("combobox", { name: /^Wer schuldet die Umsatzsteuer/ }).selectOption("ig_erwerb");
  const tax = page.getByLabel(/^Erwerbsteuer/);
  await expect(tax).toHaveValue("95,00");
  await expect(tax).toHaveAttribute("readonly", "");
  await expect(page.getByText("Erwerbsteuer (automatisch)", { exact: true })).toBeVisible();
  await page.getByLabel("Netto", { exact: true }).fill("600");
  await expect(tax).toHaveValue("114,00");
  await page.getByRole("combobox", { name: /^Satz/ }).selectOption("700");
  await expect(tax).toHaveValue("42,00");
  await page.getByText("Details zur Voranmeldung", { exact: true }).click();
  await expect(page.getByText(/Netto in Kz 89 \(19 %\) bzw\. Kz 93 \(7 %\), Vorsteuer in Kz 61/)).toBeVisible();
  await expect(page.getByText("Zu zahlen (netto)")).toBeVisible();
  // Nicht buchen: der Beleg würde die folgenden Auswertungen und Bilder verändern
  await page.getByRole("button", { name: "Löschen" }).click();
  await bestaetigen(page, "Beleg löschen");
  await page.waitForURL(/\/belege$/);
});

test("Skonto: Vorgabe und Kunde, Rechnung mit Skonto, Zahlung mit Skonto abgleichen", async ({ browser }) => {
  // Vorgabe in den Firmendaten: 2 % in 10 Tagen
  await go("/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  await firma.getByRole("button", { name: "Skontostufe hinzufügen" }).click();
  await firma.getByLabel("Stufe 1: Skonto in %").fill("2");
  await firma.getByLabel("Stufe 1: Frist in Tagen").fill("10");
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");

  // Ein Kunde mit eigenem Skonto: 3 % in 7 Tagen
  await go("/kontakte/neu");
  await page.getByLabel("Name oder Firma").fill("Kontor Lindner KG");
  await page.getByLabel("Straße und Hausnummer").fill("Speicherstadt 4");
  await page.getByLabel("PLZ").fill("20457");
  await page.getByLabel("Ort").fill("Hamburg");
  await weitereAngabenOeffnen(page);
  await page.getByRole("combobox", { name: /^Skonto/ }).selectOption("eigen");
  await page.getByRole("button", { name: "Skontostufe hinzufügen" }).click();
  await page.getByLabel("Stufe 1: Skonto in %").fill("3");
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("7");
  await page.getByRole("button", { name: "Kontakt anlegen" }).click();
  await expect(page.getByRole("heading", { name: "Versionen" })).toBeVisible();

  // Neue Rechnung: erst die Vorgabe der Firma, mit dem Kunden dessen Skonto; Datum und Betrag stehen daneben
  const issueDate = day(-2);
  await go("/rechnungen/neu");
  await expect(page.getByLabel("Stufe 1: Skonto in %")).toHaveValue("2");
  await kundeWaehlen(page, "Kontor Lindner KG · Hamburg");
  await expect(page.getByLabel("Stufe 1: Skonto in %")).toHaveValue("3");
  await expect(page.getByLabel("Stufe 1: Frist in Tagen")).toHaveValue("7");
  await page.getByLabel("Rechnungsdatum").fill(issueDate);
  await page.getByLabel("Beschreibung Position 1").fill("Beratung Lagerlogistik");
  await page.getByLabel("Menge Position 1").fill("1");
  await page.getByLabel(/Einzelpreis Position 1/).fill("1.000,00");
  const until = new Date(`${issueDate}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 7);
  const untilText = until.toISOString().slice(0, 10).split("-").reverse().join(".");
  // 3 % von 1.190,00 € = 35,70 €
  await expect(page.getByText(`bis ${untilText}: 35,70 € Skonto, zu zahlen 1.154,30 €`)).toBeVisible();
  await expect(page.getByLabel("Vorschau der Rechnung")).toContainText(`Bei Zahlung bis zum ${untilText} gewähren wir 3 % Skonto (35,70 €)`);
  // Eine Frist über das Zahlungsziel hinaus lässt sich nicht speichern
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("30");
  await expect(page.getByText("Die Skontofrist von 30 Tagen ist länger als das Zahlungsziel von 14 Tagen.")).toBeVisible();
  await page.getByLabel("Stufe 1: Frist in Tagen").fill("7");

  // Editor mit Skontostufe für axe, am Desktop und am Handy (WCAG 2.2 AA wie barrierefreiheit.spec.ts)
  async function axe(path: string, ready: (p: Page) => Promise<void>) {
    const context = await browser.newContext({ storageState: await page.context().storageState() });
    const axePage = await context.newPage();
    for (const width of [1440, 390]) {
      await axePage.setViewportSize({ width, height: 900 });
      await axePage.goto(new URL(path, page.url()).toString());
      await axePage.waitForLoadState("networkidle");
      await ready(axePage);
      const { violations } = await new AxeBuilder({ page: axePage })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `${path} bei ${width} px`,
      ).toEqual([]);
    }
    await context.close();
  }

  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await page.waitForURL(/rechnungen\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const invoicePath = new URL(page.url()).pathname;
  await axe(invoicePath, (p) => expect(p.getByLabel("Stufe 1: Skonto in %")).toHaveValue("3"));
  await page.getByRole("button", { name: "Festschreiben" }).click();
  await bestaetigen(page, "Festschreiben");
  await expect(page.getByText(/Festgeschrieben/).first()).toBeVisible({ timeout: 30_000 });
  const number = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/\d{4}-\d{3}/)?.[0] ?? "";
  expect(number).not.toBe("");

  // Zahlung in der Frist mit 3 % Skonto
  const csv =
    "﻿" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"1.154,30 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      dkb(day(0)),
      dkb(day(0)),
      "Gebucht",
      "Kontor Lindner KG",
      "Max Mustermann",
      `RE ${number} abzgl. 3 % Skonto`,
      "Eingang",
      "DE75512108001245126199",
      "1.154,30",
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
    .setInputFiles([{ name: "skonto.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Kontor Lindner KG/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Kontor Lindner KG" })).toBeVisible();
  await expect(panel.getByText("Betrag stimmt mit 3 % Skonto (35,70 €), in der Frist")).toBeVisible();
  await axe(new URL(page.url()).pathname + new URL(page.url()).search, (p) =>
    expect(p.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" })).toBeVisible(),
  );
  await panel.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" }).click();
  // Ohne weiteren offenen Umsatz bleibt der Umsatz offen im Blick, nur ohne die Zuordnung
  await expect(panel.getByRole("button", { name: "Zuordnen, Rest 35,70 € als Skonto" })).toBeHidden();
  await page.waitForLoadState("networkidle");

  // Die Rechnung ist bezahlt, das Skonto ausgebucht
  await go(invoicePath);
  await expect(page.getByText("Bezahlt").first()).toBeVisible();
  await expect(page.getByText("Skonto gewährt").first()).toBeVisible();

  // Vorgabe wieder entfernen, damit die übrigen Tests ohne Skonto rechnen
  await go("/einstellungen");
  await firma.getByRole("button", { name: "Skontostufe 1 entfernen" }).click();
  await firma.getByRole("button", { name: "Speichern" }).click();
  await expect(firma.getByRole("status")).toContainText("Firmendaten gespeichert.");
});

test("Voranmeldung außerhalb von Haben abgegeben: Abgabe vermerken, Zahllast im Bankabgleich zuordnen", async () => {
  // Ein Monat vor dem Vorjahr ohne Buchungen, damit die übrigen Seiten, Bilder und die Sondervorauszahlung unverändert bleiben
  const year = YEAR - 2;
  const yy = String(year).slice(2);
  await go(`/umsatzsteuer/${year}-06`);
  await page.getByRole("button", { name: /^Werte von Hand ändern/ }).click();
  await page.getByLabel("Steuerpflichtige Umsätze 19 %").fill("1.000,00");
  await page.getByLabel("Begründung der Abweichung (Pflicht)").fill("Rechnung aus der alten Buchhaltung, dort nicht gemeldet");
  await page.getByRole("button", { name: "Entwurf speichern" }).click();
  await expect(page.getByText("Entwurf gespeichert.")).toBeVisible();

  // Das Ergebnis steht über den Kennzahlen, der Ablauf steht beim Abgeben (#1253)
  // Juni vor zwei Jahren: die Frist ist längst vorbei, also „war fällig“ statt „bis“
  await expect(page.getByText(/Die Zahllast von 190,00\s€ war am \d{2}\.\d{2}\.\d{4} fällig\./)).toBeVisible();
  await expect(page.getByRole("region", { name: "Ablauf der Voranmeldung" }).locator('[aria-current="step"]')).toContainText("Abgeben");
  // Ohne Hersteller-ID ist Mein ELSTER der Hauptweg: „Schon anders abgegeben?“ steht offen, lässt sich zu- und wieder aufklappen
  const vermerk = page.getByRole("form", { name: "Außerhalb von Haben abgegeben" });
  const abschnitt = page.locator('section[aria-labelledby="ust-vermerk"] > details');
  await expect(abschnitt).toHaveJSProperty("open", true);
  await abschnitt.locator("summary").click();
  await expect(abschnitt).toHaveJSProperty("open", false);
  await expect(vermerk).toBeHidden();
  await abschnitt.locator("summary").click();
  await expect(vermerk.getByLabel("Tag der Abgabe")).toBeVisible();
  // Ein geleertes Datum ist eine unfertige Eingabe, die Seite bleibt stehen (Codex-Review #443); der Knopf sagt am Feld, was fehlt
  await vermerk.getByLabel("Tag der Abgabe").fill("");
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  await expect(vermerk.getByLabel("Tag der Abgabe")).toBeFocused();
  await expect(vermerk.getByLabel("Tag der Abgabe")).toHaveAccessibleDescription("Wähle den Tag der Abgabe.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await vermerk.getByLabel("Tag der Abgabe").fill(`${year}-07-09`);
  await vermerk.getByLabel("Transferticket").fill("et7f3k9m2q8w4x1z");
  const protokollFeld = vermerk.locator(".field", { has: page.getByText("Übermittlungsprotokoll (PDF)", { exact: true }) });
  const protokollDialog = await filePickerPruefen(page, protokollFeld, "Übermittlungsprotokoll");
  await protokollDialog.setFiles({
    name: "Uebermittlungsprotokoll.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% Übermittlungsprotokoll Juni\n%%EOF\n"),
  });
  await expect(protokollFeld.locator(".file-picker-name")).toHaveText("Uebermittlungsprotokoll.pdf");
  // Kz 83 laut Protokoll weicht ab: Haben lehnt ab
  await vermerk.getByLabel("Kz 83 laut Protokoll").fill("200,00");
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  await bestaetigen(page, "Abgabe vermerken");
  await expect(vermerk.getByRole("alert")).toContainText("weicht von der Voranmeldung");
  await vermerk.getByLabel("Kz 83 laut Protokoll").fill("190,00");
  // Festschreiben ist endgültig; die Rückfrage zeigt, was gleich gilt, und Abbrechen lässt alles offen
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  const vermerkRueckfrage = page.getByRole("dialog", { name: "Voranmeldung als abgegeben vermerken?" });
  await faktenZeigen(page, "Tag der Abgabe", "Transferticket", "Kz 83");
  await expect(vermerkRueckfrage).toContainText(`09.07.${year}`);
  await expect(vermerkRueckfrage).toContainText("et7f3k9m2q8w4x1z");
  await expect(vermerkRueckfrage).toContainText("190,00");
  await vermerkRueckfrage.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(page.getByText(`Abgegeben 09.07.${year} (vermerkt)`)).toHaveCount(0);
  await vermerk.getByRole("button", { name: "Abgabe vermerken" }).click();
  await bestaetigen(page, "Abgabe vermerken");
  await expect(page.getByText(`Abgegeben 09.07.${year} (vermerkt)`)).toBeVisible();
  await expect(page.getByRole("region", { name: `Verlauf Juni ${year}` })).toContainText("Abgabe vermerkt");
  const zahlung = page.getByRole("region", { name: "Zahlung an das Finanzamt" });
  await expect(zahlung).toContainText("Offen 190,00");
  const protokoll = await page.request.get((await page.getByRole("link", { name: "Protokoll" }).first().getAttribute("href"))!);
  expect(protokoll.headers()["content-type"]).toContain("application/pdf");

  // Lastschrift des Finanzamts: Haben schlägt die Voranmeldung vor, gebucht wird Umsatzsteuer an Bank mit Bezug
  const csv =
    "\ufeff" +
    `"Girokonto";"DE45 1203 0000 1234 5678 90"\n""\n"Kontostand vom ${dkb(day(0))}:";"16.067,10 €"\n""\n` +
    `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
    [
      `10.07.${yy}`,
      `10.07.${yy}`,
      "Gebucht",
      "Max Mustermann",
      "Finanzamt Regensburg",
      `USt 06/${yy} StNr 198/113/10010`,
      "Ausgang",
      "DE76750000000075001007",
      "-190,00",
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
    .setInputFiles([{ name: "finanzamt.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }]);
  await expect(page.getByText(/1 neue Umsätze/)).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("link", { name: /Finanzamt Regensburg/ })
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("complementary", { name: "Zuordnung" });
  await expect(panel.getByRole("heading", { name: "Finanzamt Regensburg" })).toBeVisible();
  await expect(panel.getByText(`Voranmeldung USt 06/${year}`)).toBeVisible();
  await expect(panel.getByText("Zeitraum im Verwendungszweck")).toBeVisible();
  await panel.getByRole("button", { name: "Zuordnen", exact: true }).click();
  // Ohne weiteren offenen Umsatz bleibt der Umsatz im Blick, nur ohne die Zuordnung
  await expect(panel.getByRole("button", { name: "Zuordnen", exact: true })).toBeHidden();
  await page.waitForLoadState("networkidle");

  await go(`/umsatzsteuer/${year}-06`);
  await expect(page.getByRole("region", { name: "Zahlung an das Finanzamt" })).toContainText("Ausgeglichen");
  await expect(page.getByRole("region", { name: "Zahlung an das Finanzamt" })).toContainText("Lastschrift 190,00");
});

test("Voranmeldung von Hand: alle angebotenen Kennzahlen eintragen, ein ungültiger Betrag meldet sich beim Speichern am Feld", async () => {
  // Mai vor dem Vorjahr: ohne Buchungen und ohne Anmeldung. Der Entwurf wird am Ende gelöscht, damit spätere Tests den
  // Monat leer vorfinden
  const year = YEAR - 2;
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    await go(`/umsatzsteuer/${year}-05`);
    const formular = page.getByRole("form", { name: "Kennzahlen" });
    await formular.getByRole("button", { name: /^Werte von Hand ändern/ }).click();
    const werte: [string, string][] = [
      ["Steuerpflichtige Umsätze 19 %", "1.000,00"],
      ["Steuerpflichtige Umsätze 7 %", "200,00"],
      ["Nicht steuerbare sonstige Leistungen im EU-Ausland (Reverse Charge)", "300,00"],
      ["Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)", "50,00"],
      ["Steuerfreie Umsätze ohne Vorsteuerabzug", "40,00"],
      ["Steuerfreie innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.", "500,00"],
      ["Weitere steuerfreie Umsätze mit Vorsteuerabzug (Ausfuhrlieferungen)", "60,00"],
      ["Steuerpflichtige innergemeinschaftliche Erwerbe 19 %", "100,00"],
      ["Steuerpflichtige innergemeinschaftliche Erwerbe 7 %", "10,00"],
      ["Vorsteuer aus Rechnungen anderer Unternehmer", "30,00"],
      ["Sonstige Leistungen eines Unternehmers aus dem EU-Ausland (§ 13b Abs. 1 UStG)", "400,00"],
      ["Steuer zu Kz 46 (Kz 47)", "76,00"],
      ["Andere Leistungen, für die du die Steuer schuldest (§ 13b Abs. 2 UStG)", "20,00"],
      ["Steuer zu Kz 84 (Kz 85)", "3,80"],
      ["Vorsteuer aus Leistungen nach § 13b UStG", "79,80"],
      ["Vorsteuer aus dem innergemeinschaftlichen Erwerb von Gegenständen", "19,70"],
    ];
    for (const [label, wert] of werte) await formular.getByLabel(label, { exact: true }).fill(wert);
    // Steuer zu 81, 86, 89 und 93 sowie Kz 47 und 85, abzüglich der Vorsteuer in Kz 66, 67 und 61
    await expect(formular.locator(".kz-row.total .kz-amount")).toHaveText(/^174,00/);
    // Speichern prüft beim Absenden statt gesperrt zu sein (#1270): ohne Begründung die Meldung am Feld, Fokus dort
    const speichern = formular.getByRole("button", { name: "Entwurf speichern" });
    const begruendung = formular.getByLabel("Begründung der Abweichung (Pflicht)");
    // Höchstens 1.000 Zeichen wie im Schema von saveVatDraft
    await expect(begruendung).toHaveAttribute("maxlength", "1000");
    await speichern.click();
    await expect(formular.getByText("Begründe die Abweichung mit mindestens 10 Zeichen", { exact: false })).toBeVisible();
    await expect(begruendung).toBeFocused();
    await begruendung.fill("Werte aus der alten Buchhaltung übernommen");
    const kz66 = formular.getByLabel("Vorsteuer aus Rechnungen anderer Unternehmer", { exact: true });
    await kz66.fill("dreißig");
    // „Nur prüfen“ im ELSTER-Kasten ist nicht gesperrt, sondern prüft dieselben Felder: Meldung und Fokus am Feld, kein Aufruf
    await page.getByRole("form", { name: "An ELSTER übermitteln" }).getByRole("button", { name: "Nur prüfen" }).click();
    await expect(formular.getByText("Trag den Betrag der Kennzahl ein, etwa 1.234,56.")).toBeVisible();
    await expect(kz66).toBeFocused();
    await expect(page.getByText("ERiC hat die Daten geprüft", { exact: false })).toHaveCount(0);
    await speichern.click();
    await expect(formular.getByText("Trag den Betrag der Kennzahl ein, etwa 1.234,56.")).toBeVisible();
    await expect(kz66).toBeFocused();
    await expect(kz66).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Entwurf gespeichert.")).toHaveCount(0);
    await kz66.fill("30,00");
    await speichern.click();
    await expect(page.getByText("Entwurf gespeichert.")).toBeVisible();

    await page.reload();
    await expect(formular.getByRole("button", { name: "Zurück zu den berechneten Werten" })).toBeVisible();
    for (const [label, wert] of werte) await expect(formular.getByLabel(label, { exact: true })).toHaveValue(wert);
    await expect(formular.getByLabel("Begründung der Abweichung (Pflicht)")).toHaveValue("Werte aus der alten Buchhaltung übernommen");
    // Zurück zu den Buchungen: der leere Monat, ohne Begründung
    await formular.getByRole("button", { name: "Zurück zu den berechneten Werten" }).click();
    await expect(page.locator("#kz-81")).toHaveText(/^0,00/);
    await expect(formular.getByLabel("Begründung der Abweichung (Pflicht)")).toHaveCount(0);
    await expect(formular.locator(".kz-row.total .kz-amount")).toHaveText(/^0,00/);
  } finally {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e-test', true)`;
      await tx`delete from vat_returns where year = ${year} and month = 5`;
    });
    await sql.end();
  }
});

// Die vier Tests zu #1824 teilen sich einen Entwurf von Hand im April vor dem Vorjahr, ohne Buchungen. Er bleibt stehen:
// „Nur prüfen“ legt einen Eintrag im Verlauf an, der auf ihn verweist
const sperreMonat = `${YEAR - 2}-04`;
const kennzahlen = () => page.getByRole("form", { name: "Kennzahlen" });
const begruendung = () => kennzahlen().getByLabel("Begründung der Abweichung (Pflicht)");

test("Voranmeldung von Hand: Eingaben direkt nach dem Speichern bleiben erhalten (#1824)", async () => {
  await go(`/umsatzsteuer/${sperreMonat}`);
  await kennzahlen()
    .getByRole("button", { name: /^Werte von Hand ändern/ })
    .click();
  await kennzahlen().getByLabel("Steuerpflichtige Umsätze 19 %", { exact: true }).fill("1.000,00");
  await begruendung().fill("Rechnung aus der alten Buchhaltung");
  await eingabeNachAktion(page, {
    aktion: kennzahlen().getByRole("button", { name: "Entwurf speichern" }),
    feld: begruendung(),
    text: "Gleich nach dem Speichern getippt",
    // Die Meldung setzt die Seite erst, wenn die neuen Daten geladen sind
    neuGeladen: page.getByText("Entwurf gespeichert."),
  });
});

test("Voranmeldung von Hand: Kurz nacheinander gespeichert, baut sich das Formular jedes Mal neu auf (#1824)", async () => {
  // Der Entwurf aus dem Test davor
  await kurzNacheinanderSpeichern({
    feld: begruendung(),
    speichern: kennzahlen().getByRole("button", { name: "Entwurf speichern" }),
    texte: ["Erste Begründung von Hand", "Zweite Begründung von Hand", "Dritte Begründung von Hand"],
  });
});

test("Voranmeldung von Hand: Speichern schlägt fehl, der Fokus steht danach wieder im Feld (#1824)", async () => {
  // Der Entwurf aus den Tests davor; Enter speichert nur mit Änderungen, sonst ist „Entwurf speichern“ gesperrt
  const kz81 = kennzahlen().getByLabel("Steuerpflichtige Umsätze 19 %", { exact: true });
  await kz81.fill("1.100,00");
  await fokusNachFehlschlag(page, kz81);
});

test("Voranmeldung von Hand: Nach „Nur prüfen“ werden die Felder bis zum Neuaufbau nicht frei (#1824)", async () => {
  // Der Entwurf aus den Tests davor, noch mit der Änderung aus dem Test davor: „Nur prüfen“ speichert sie zuerst, danach
  // baut sich das Formular mit dem neuen Stand neu auf
  await gesperrtBisNeuGeladen(page, {
    aktion: page.getByRole("form", { name: "An ELSTER übermitteln" }).getByRole("button", { name: "Nur prüfen" }),
    feld: begruendung(),
    neuGeladen: page.getByText("ERiC hat die Daten geprüft, keine Fehler."),
  });
  await expect(kennzahlen().getByLabel("Steuerpflichtige Umsätze 19 %", { exact: true })).toHaveValue("1.100,00");
});

test("Seiten mit den Daten dieses Abschnitts ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, ["/auswertungen", "/umsatzsteuer", `/umsatzsteuer/zm/${YEAR + 1}-Q1`]);
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
