import { type FintsTestbank, type FintsTestbankUmsatz, startFintsTestbank } from "@haben/import/fints-testbank";
import { expect, type Locator, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, FINTS_BANK_PORT, FINTS_PRODUKT_E2E } from "./durchlaeufe.ts";
import { axeVerstoesse, bankVerbinden, bestaetigen, durchlaufSeite, einrichten, gehe, kontoVerbinden } from "./einrichtung.ts";

/**
 * Kontoabruf über FinTS (#654) in eigener, leerer Datenbank (Projekt „fints-abruf“, e2e/durchlaeufe.ts). Der Server
 * des Durchlaufs hat als einziger FINTS_PRODUKT_ID (playwright.config.ts); die Bank baut @haben/import/fints-testbank
 * nach: FinTS 3.0 mit PIN/TAN, chipTAN und pushTAN, zwei Konten, Umsätze als MT940. Verbunden wird über „Konto
 * verbinden › Bank hinzufügen › FinTS“. Die Verbindungen stehen auf der Seite Verbindungen je Konto in einer Zeile mit
 * „Jetzt abrufen“ und `⋯` (Zugang ändern, Trennen); Formular, Schritte der Bank und Meldungen im Bereich „Automatischer
 * Abruf“ darüber (#1951).
 */

test.describe.configure({ mode: "serial" });

/** Tag vor heute, nie vor dem 1. Januar: Der erste Abruf beginnt am Jahresanfang */
function tag(offset: number): string {
  const heute = new Date();
  const datum = Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate() + offset);
  return new Date(Math.max(datum, Date.UTC(heute.getFullYear(), 0, 1))).toISOString().slice(0, 10);
}

const GIRO = "DE02120300000000202051";
const TAGESGELD = "DE12500105170648489890";
/** Zweite Bank für zwei Verbindungen über FinTS nebeneinander (#1662) */
const ZWEIT_BLZ = "50010517";
const ZWEIT_GIRO = "DE39500105175407324924";
/** Zweite Verbindung zu einer Bank, die ebenfalls „Testbank“ heißt, mit eigenem Girokonto (#1677) */
const DRITT_BLZ = "37040044";
const DRITT_GIRO = "DE62370400440532013001";

let page: Page;
let pageErrors: string[] = [];
let bank: FintsTestbank;
let zweit: FintsTestbank | undefined;
let dritt: FintsTestbank | undefined;
const umsaetze: Record<string, FintsTestbankUmsatz[]> = {
  [GIRO]: [
    { tag: tag(-20), betrag: "1190,00", name: "Muster GmbH", iban: "DE89370400440532013000", zweck: "Rechnung RE-2026-0042", ref: "G1" },
    { tag: tag(-5), betrag: "-49,99", name: "Telekom Deutschland GmbH", zweck: "Mobilfunk", ref: "G2" },
  ],
  [TAGESGELD]: [],
};

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  bank = await startFintsTestbank({
    produktId: FINTS_PRODUKT_E2E,
    bankname: "Testbank",
    port: FINTS_BANK_PORT,
    konten: [
      { iban: GIRO, nummer: "0000202051", name: "Girokonto" },
      { iban: TAGESGELD, nummer: "0648489890", name: "Tagesgeld" },
    ],
    umsaetze,
  });
});

test.afterAll(async () => {
  await page.context().close();
  await bank?.schliessen();
  await zweit?.schliessen();
  await dritt?.schliessen();
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const abruf = () => page.getByRole("region", { name: "Automatischer Abruf" });
const freigabe = () => page.getByRole("form", { name: "Freigabe bei der Bank" });
const kontenwahl = () => page.getByRole("form", { name: "Konten wählen" });
/** „Konto verbinden › Bank hinzufügen › FinTS (PIN/TAN)“ öffnet das Formular „Über FinTS verbinden“ */
const fintsVerbinden = () => bankVerbinden(page, "FinTS (PIN/TAN)");
const FINTS_HINWEIS = "Vor allem für Sparkassen, Volks- und Raiffeisenbanken: Haben meldet sich mit Anmeldename und PIN an.";

/** Der Weg FinTS im Dialog „Wie verbinden?“: mit grund gesperrt und der Grund zu sehen, ohne frei; der Dialog schließt wieder */
async function fintsWahl(grund: string | null) {
  await kontoVerbinden(page, "Bank hinzufügen");
  const dialog = page.getByRole("dialog", { name: "Wie verbinden?" });
  const wahl = dialog.getByRole("radio", { name: "FinTS (PIN/TAN)" });
  if (grund) {
    await expect(wahl).toBeDisabled();
    await expect(dialog.getByText(grund)).toBeVisible();
    await expect(wahl).toHaveAccessibleDescription(`${FINTS_HINWEIS} ${grund}`);
  } else {
    await expect(wahl).toBeEnabled();
    await expect(wahl).toHaveAccessibleDescription(FINTS_HINWEIS);
  }
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);
}

const banken = () => page.getByRole("region", { name: "Banken", exact: true });
/** Zeilen der Konten, die eine Verbindung über FinTS abruft */
const fintsZeilen = () => banken().locator("tbody tr").filter({ hasText: "(FinTS)" });
/** Erste Zeile eines Kontos der Verbindung zu bankName */
const zeile = (bankName: string) =>
  fintsZeilen()
    .filter({ hasText: `${bankName} (FinTS)` })
    .first();
/** Zeile einer Verbindung an der Endung der IBAN ihres Girokontos; zwei Verbindungen heißen „Testbank“ (#1677) */
const zeileMitKonto = (endung: string) => fintsZeilen().filter({ hasText: `Girokonto …${endung}` });
/** „Jetzt abrufen“ als Symbol am Ende der Zeile */
const abrufKnopf = (z: Locator) => z.getByRole("button", { name: / jetzt abrufen$/ });
/** Öffnet `⋯` der Zeile und gibt den Punkt zurück; danach schließt zu() das Menü */
async function punkt(z: Locator, name: string): Promise<Locator> {
  await z.getByRole("button", { name: /^Weitere Aktionen für / }).click();
  return page.getByRole("menuitem", { name, exact: true });
}
const zu = () => page.keyboard.press("Escape");
const zuletzt = (z: Locator) => z.locator(".spalte-abruf");

/** Ob die Knöpfe der Zeile gesperrt sind und welchen Grund sie nennen ("" ohne) */
async function knoepfeStand(z: Locator, gesperrt: boolean, grund: string, knoepfe = ["Trennen", "Zugang ändern", "Jetzt abrufen"]) {
  for (const knopf of knoepfe) {
    const ziel = knopf === "Jetzt abrufen" ? abrufKnopf(z) : await punkt(z, knopf);
    if (gesperrt) await expect(ziel).toBeDisabled();
    else await expect(ziel).toBeEnabled();
    await expect(ziel).toHaveAccessibleDescription(grund);
    if (knopf !== "Jetzt abrufen") await zu();
  }
}

async function zugangEingeben(pin = "12345", ziel = bank, blz = "12030000") {
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await form.getByLabel("Bankleitzahl").fill(blz);
  await form.getByLabel("FinTS-Adresse der Bank").fill(ziel.url);
  await form.getByLabel("Anmeldename").fill("max");
  await form.getByLabel("PIN").fill(pin);
  await form.getByRole("button", { name: "Verbinden" }).click();
}

async function verbindungsIds(): Promise<string[]> {
  const sql = postgres(databaseUrlFuer("fints-abruf"), { max: 1, onnotice: () => {} });
  try {
    return (await sql<{ id: string }[]>`select id from fints_connections`).map((r) => r.id);
  } finally {
    await sql.end();
  }
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Einstellungen › Bank zeigt, dass FinTS eingerichtet ist, ohne die Nummer", async () => {
  await gehe(page, "/einstellungen?bereich=bank");
  const karte = page.getByRole("region", { name: "Kontoabruf über FinTS" });
  await expect(karte.getByRole("status")).toHaveText("Eingerichtet. Unter Bank verbindest du deine Bank mit „Konto verbinden › Bank hinzufügen“.");
  await expect(page.getByText(FINTS_PRODUKT_E2E)).toHaveCount(0);
});

test("prüft den Zugang im Formular, bevor Haben die Bank fragt", async () => {
  await gehe(page, "/bank/verbindungen");
  // Ohne Konto und ohne Verbindung erscheint das Formular trotzdem im Bereich „Automatischer Abruf“
  await fintsVerbinden();
  const form = abruf().getByRole("form", { name: "Über FinTS verbinden" });
  await form.getByLabel("Bankleitzahl").fill("1203");
  await form.getByLabel("FinTS-Adresse der Bank").fill("http://bank.example/fints");
  await form.getByRole("button", { name: "Verbinden" }).click();
  await expect(form.getByText("Die Bankleitzahl hat acht Ziffern.")).toBeVisible();
  await expect(form.getByText("Die FinTS-Adresse beginnt mit https://.")).toBeVisible();
  await expect(form.getByText("Der Anmeldename fehlt.")).toBeVisible();
  await expect(form.getByText("Die PIN fehlt.")).toBeVisible();
  await expect(form.getByLabel("Bankleitzahl")).toBeFocused();
  expect(bank.zustand.anfragen).toHaveLength(0);
  await form.getByRole("button", { name: "Abbrechen" }).click();
});

test("verbindet mit TAN-Verfahren und TAN und holt nur die Umsätze des gewählten Kontos", async () => {
  bank.zustand.scaBeiAnmeldung = true;
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(freigabe().getByText("Bitte geben Sie die TAN ein.")).toBeVisible();
  // Ohne TAN fragt das Formular, statt die Bank anzufragen
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(freigabe().getByText("Bitte die TAN eingeben.")).toBeVisible();
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();

  // Erst nach der Anmeldung nennt die Bank die Konten; vorgewählt sind alle
  const giro = kontenwahl().getByRole("checkbox", { name: "Girokonto …2051" });
  const tagesgeld = kontenwahl().getByRole("checkbox", { name: "Tagesgeld …9890" });
  await expect(giro).toBeChecked();
  await expect(tagesgeld).toBeChecked();
  // Ohne Konto fragt das Formular, statt weiterzugehen
  await giro.uncheck();
  await tagesgeld.uncheck();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(kontenwahl().getByText("Wähle mindestens ein Konto.")).toBeVisible();
  await expect(giro).toBeFocused();
  expect(await axeVerstoesse(page)).toEqual([]);
  await giro.check();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();

  await expect(abruf().getByText("Testbank verbunden, 2 neue Umsätze.")).toBeVisible();
  await expect(abruf().getByText(/^Neu angelegt: Testbank Girokonto …2051\. /)).toBeVisible();
  await expect(fintsZeilen()).toHaveCount(1);
  await expect(zeile("Testbank")).toContainText("Testbank Girokonto …2051");
  await expect(zeile("Testbank").locator(".spalte-status")).toHaveText("Aktiv");
  await expect(await punkt(zeile("Testbank"), "Zugang ändern")).toBeEnabled();
  await zu();
  expect(await axeVerstoesse(page), "Seite Verbindungen mit FinTS").toEqual([]);
  await gehe(page, "/bank");
  const konten = page.getByRole("navigation", { name: "Konten" });
  await expect(konten.getByRole("link", { name: /Tagesgeld/ })).toHaveCount(0);
  await expect(konten.getByRole("link", { name: /Testbank Girokonto …2051/ })).toContainText("FinTS · heute");
  await expect(konten.getByRole("link", { name: /Testbank Girokonto …2051/ })).toContainText("1.140,01 €");
  await expect(page.getByText("Mobilfunk").first()).toBeVisible();
});

test("„Jetzt abrufen“ über der Liste fragt die TAN ab, wenn die Bank sie verlangt", async () => {
  umsaetze[GIRO]!.push({ tag: tag(-1), betrag: "250,00", name: "Kunde AG", zweck: "RE-2026-0050", ref: "G3" });
  bank.zustand.scaBeiUmsaetzen = true;
  await page.getByRole("region", { name: "Umsätze" }).getByRole("button", { name: "Jetzt abrufen" }).click();
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText("Testbank, 1 neue Umsätze.")).toBeVisible();
  await expect(page.getByText("RE-2026-0050").first()).toBeVisible();
});

// Bis #1951 klappte der Knopf „Über FinTS verbinden“ oben das Formular auch zu; das tut jetzt „Abbrechen“ im Formular
test("„Bank hinzufügen › FinTS“ öffnet nach abgebrochenem „Zugang ändern“ ein leeres Formular", async () => {
  await gehe(page, "/bank/verbindungen");
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await (await punkt(zeile("Testbank"), "Zugang ändern")).click();
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
  await form.getByRole("button", { name: "Abbrechen" }).click();
  await expect(form).toHaveCount(0);
  await fintsVerbinden();
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("");
  await expect(form.getByLabel("FinTS-Adresse der Bank")).toHaveValue("");
  await expect(form.getByLabel("Anmeldename")).toHaveValue("");
  await form.getByRole("button", { name: "Abbrechen" }).click();

  // „Zugang ändern“ füllt das Formular weiter mit den Angaben der Verbindung, nur die PIN fehlt
  await (await punkt(zeile("Testbank"), "Zugang ändern")).click();
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
  await expect(form.getByLabel("FinTS-Adresse der Bank")).toHaveValue(bank.url);
  await expect(form.getByLabel("Anmeldename")).toHaveValue("max");
  await expect(form.getByLabel("PIN")).toHaveValue("");
  await form.getByRole("button", { name: "Abbrechen" }).click();
  await expect(form).toHaveCount(0);
});

test("„Bank hinzufügen › FinTS“ bei offenem „Zugang ändern“ öffnet ein leeres Formular für eine neue Bank (Review #1951)", async () => {
  // Bis #1951 klappte „Über FinTS verbinden“ das Formular von „Zugang ändern“ zu; das Menü darf nicht die Angaben der
  // bestehenden Verbindung als neue Bank anbieten
  await gehe(page, "/bank/verbindungen");
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await (await punkt(zeile("Testbank"), "Zugang ändern")).click();
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
  await fintsVerbinden();
  await expect(form).toHaveCount(1);
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("");
  await expect(form.getByLabel("FinTS-Adresse der Bank")).toHaveValue("");
  await expect(form.getByLabel("Anmeldename")).toHaveValue("");
  await form.getByRole("button", { name: "Abbrechen" }).click();
  await expect(form).toHaveCount(0);
});

test("nach einer abgelehnten PIN den Zugang ändern und dabei ein Konto dazunehmen", async () => {
  // Wie nach einer neuen PIN bei der Bank: der Abruf im Hintergrund hat aufgehört, die Verbindung steht auf „Fehler“
  const sql = postgres(databaseUrlFuer("fints-abruf"), { max: 1, onnotice: () => {} });
  try {
    await sql`update fints_connections set status = 'fehler', last_error = 'Abruf fehlgeschlagen: PIN ungültig. (9942)'`;
  } finally {
    await sql.end();
  }
  await gehe(page, "/bank/verbindungen");
  // Der Fehler steht als Auskunft unter „Fehlgeschlagen“, „Zugang ändern“ am Ende der Zeile löst ihn
  await expect(zeile("Testbank").locator(".spalte-status")).toHaveText(/Fehlgeschlagen\s*Abruf fehlgeschlagen: PIN ungültig\. \(9942\)/);
  await zeile("Testbank").getByRole("button", { name: "Zugang ändern" }).click();
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
  await expect(form.getByLabel("FinTS-Adresse der Bank")).toHaveValue(bank.url);
  await expect(form.getByLabel("Anmeldename")).toHaveValue("max");
  await expect(form.getByLabel("PIN")).toHaveValue("");
  await form.getByLabel("PIN").fill("12345");
  await form.getByRole("button", { name: "Verbinden" }).click();
  // pushTAN: diesmal ohne TAN, die Bank verlangt bei der Anmeldung keine mehr
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "pushTAN 2.0" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  // Vorgewählt ist, was die Verbindung bisher abruft
  await expect(kontenwahl().getByRole("checkbox", { name: "Girokonto …2051" })).toBeChecked();
  await expect(kontenwahl().getByRole("checkbox", { name: "Tagesgeld …9890" })).not.toBeChecked();
  await kontenwahl().getByRole("checkbox", { name: "Tagesgeld …9890" }).check();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText("Testbank verbunden, 0 neue Umsätze.")).toBeVisible();
  await expect(abruf().getByText(/^Neu angelegt: Testbank Tagesgeld …9890\. /)).toBeVisible();
  await expect(fintsZeilen()).toHaveCount(2);
  await expect(fintsZeilen().filter({ hasText: "Testbank Tagesgeld …9890" })).toHaveCount(1);
  await expect(zeile("Testbank").locator(".spalte-status")).toHaveText("Aktiv");
  await expect(page.getByText("Abruf fehlgeschlagen: PIN ungültig. (9942)")).toHaveCount(0);
  await expect(await punkt(zeile("Testbank"), "Zugang ändern")).toBeEnabled();
  await zu();
  // Das Formular schließt wie beim ersten Verbinden, mit der PIN darin bleibt nichts stehen
  await expect(page.getByRole("form", { name: "Über FinTS verbinden" })).toHaveCount(0);
});

test("pushTAN: wartet auf die Freigabe in der App", async () => {
  bank.zustand.scaBeiUmsaetzen = true;
  await abrufKnopf(zeile("Testbank")).click();
  await expect(freigabe().getByText("Bitte bestätigen Sie den Zugriff in Ihrer Banking-App.")).toBeVisible();
  await expect(freigabe().getByLabel("TAN", { exact: true })).toHaveCount(0);
  await freigabe().getByRole("button", { name: "Freigegeben, weiter" }).click();
  await expect(freigabe().getByRole("status")).toHaveText("Noch nicht freigegeben. Bitte in der App der Bank bestätigen und dann weiter.");
  bank.zustand.freigegeben = true;
  await freigabe().getByRole("button", { name: "Freigegeben, weiter" }).click();
  await expect(abruf().getByText("Testbank, 0 neue Umsätze.")).toBeVisible();
});

test("pushTAN: fragt die TAN ab, wenn die Bank bei der Anmeldung eine aus der App verlangt (wie die Consorsbank)", async () => {
  Object.assign(bank.zustand, { scaBeiAnmeldung: true, appTanEintippen: true });
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "pushTAN 2.0" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(freigabe().getByText("Bitte generieren Sie eine TAN mit Ihrer Banking App oder Ihrem TAN Generator und geben diese hier ein.")).toBeVisible();
  await expect(freigabe().getByRole("button", { name: "Freigegeben, weiter" })).toHaveCount(0);
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  // Auch wenn die Seite langsam neu lädt, kommt die Meldung erst mit dem neu geladenen Stand (#1606)
  const neuLaden = (url: URL) => url.pathname.startsWith("/_serverFn/");
  await page.route(neuLaden, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((fertig) => setTimeout(fertig, 1500));
    await route.continue();
  });
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText("Testbank verbunden, 0 neue Umsätze.")).toBeVisible();
  await expect(zeile("Testbank").locator(".spalte-status")).toHaveText("Aktiv");
  // „wait“ lässt verzögerte Anfragen noch fertig laufen
  await page.unrouteAll({ behavior: "wait" });
  bank.zustand.appTanEintippen = false;
});

test("erneut verbinden, bei der TAN für die Umsätze abgebrochen: die bisherige Verbindung bleibt und ruft ab", async () => {
  const ids = await verbindungsIds();
  const vorher = (await zuletzt(zeile("Testbank")).textContent())!;
  bank.zustand.scaBeiUmsaetzen = true;
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(freigabe().getByLabel("TAN", { exact: true })).toBeVisible();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);

  // Gleiche ID, Stand des letzten Abrufs wie vorher, auch nach dem Neuladen (#1617)
  expect(await verbindungsIds()).toEqual(ids);
  await gehe(page, "/bank/verbindungen");
  await expect(zuletzt(zeile("Testbank"))).toHaveText(vorher);
  await abrufKnopf(zeile("Testbank")).click();
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText("Testbank, 0 neue Umsätze.")).toBeVisible();
});

test("Trennen löscht die Verbindung, die Umsätze bleiben", async () => {
  await (await punkt(zeile("Testbank"), "Trennen")).click();
  await bestaetigen(page, "Trennen");
  // Die Konten bleiben, ohne Verbindung; der Bereich ist leer und unsichtbar
  await expect(fintsZeilen()).toHaveCount(0);
  await expect(abruf()).toBeHidden();
  await gehe(page, "/bank?konto=alle&filter=alle");
  await expect(page.getByText("RE-2026-0050").first()).toBeVisible();
  await gehe(page, "/bank/verbindungen");
});

test("erneut verbinden, bei der Wahl des TAN-Verfahrens abgebrochen: die bisherige Verbindung bleibt, wie sie ist", async () => {
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();
  const ids = await verbindungsIds();
  const vorher = (await zuletzt(zeile("Testbank")).textContent())!;

  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Über FinTS verbinden" })).toHaveCount(0);
  await expect(zuletzt(zeile("Testbank"))).toHaveText(vorher);
  expect(await verbindungsIds()).toEqual(ids);
});

test("erneut verbinden, bei der TAN für die Umsätze abgebrochen: „Trennen“ an der Zeile trennt die Verbindung", async () => {
  bank.zustand.scaBeiUmsaetzen = true;
  const ids = await verbindungsIds();
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  // Verbinden hat den neuen Zugang schon gespeichert, die ID bleibt (#1617); erst der Abruf der Umsätze fragt die TAN
  // (#1614)
  await expect(freigabe().getByLabel("TAN", { exact: true })).toBeVisible();
  expect(await verbindungsIds()).toEqual(ids);
  await expect(await punkt(zeile("Testbank"), "Trennen")).toBeDisabled();
  await zu();
  // Das Formular schließt erst nach dem Neuladen, auch wenn die Seite langsam lädt; „Trennen“ danach findet die Verbindung
  const neuLaden = (url: URL) => url.pathname.startsWith("/_serverFn/");
  await page.route(neuLaden, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((fertig) => setTimeout(fertig, 1500));
    await route.continue();
  });
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(await punkt(zeile("Testbank"), "Trennen")).toBeDisabled();
  await zu();
  await expect(freigabe()).toHaveCount(0);
  await (await punkt(zeile("Testbank"), "Trennen")).click();
  await bestaetigen(page, "Trennen");
  // Ohne Verbindung bleibt der Bereich leer und unsichtbar
  await expect(fintsZeilen()).toHaveCount(0);
  await expect(abruf()).toBeHidden();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByText("Verbindung nicht gefunden.")).toHaveCount(0);
  bank.zustand.scaBeiUmsaetzen = false;
});

// Bis #1951 klappte der Knopf „Über FinTS verbinden“ oben das Formular samt offenem Schritt zu, wie „Abbrechen“; das Zuklappen
// gibt es nicht mehr, der Test prüft dieselben Stände mit „Abbrechen“ im Schritt der Bank
test("erneut verbinden, während die Bank wartet, mit „Abbrechen“ im Schritt: die Zeile bleibt, „Trennen“ trennt auch bei langsamem Neuladen", async () => {
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();
  const ids = await verbindungsIds();

  // Vor dem Speichern des Zugangs, bei der Wahl des TAN-Verfahrens: Die Zeile bleibt, wie sie ist, und ihre Knöpfe gehen
  // wieder
  await fintsVerbinden();
  await zugangEingeben();
  await expect(freigabe().getByLabel("TAN-Verfahren")).toBeVisible();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await expect(await punkt(zeile("Testbank"), "Trennen")).toBeEnabled();
  await zu();
  expect(await verbindungsIds()).toEqual(ids);

  // Nach dem Speichern des Zugangs, bei der TAN für die Umsätze: Die ID bleibt (#1617), und „Trennen“ trennt die Verbindung,
  // auch wenn die Seite langsam neu lädt
  bank.zustand.scaBeiUmsaetzen = true;
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(freigabe().getByLabel("TAN", { exact: true })).toBeVisible();
  expect(await verbindungsIds()).toEqual(ids);
  await page.route(
    (url) => url.pathname.startsWith("/_serverFn/"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await new Promise((fertig) => setTimeout(fertig, 1500));
      await route.continue();
    },
  );
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await (await punkt(zeile("Testbank"), "Trennen")).click();
  await bestaetigen(page, "Trennen");
  // Ohne Verbindung bleibt der Bereich leer und unsichtbar
  await expect(fintsZeilen()).toHaveCount(0);
  await expect(abruf()).toBeHidden();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByText("Verbindung nicht gefunden.")).toHaveCount(0);
  bank.zustand.scaBeiUmsaetzen = false;
});

test("FinTS im Dialog „Wie verbinden?“ ist gesperrt, solange an einer Zeile ein Schritt der Bank offen ist", async () => {
  const grund = "„Über FinTS verbinden“ geht wieder, sobald die Freigabe für Testbank gesendet oder abgebrochen ist.";
  const tan = freigabe().getByLabel("TAN", { exact: true });
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();

  // Sonst ersetzte der Schritt beim Verbinden den an der Zeile, ohne dass Haben den Vorgang bei der Bank verwirft
  bank.zustand.scaBeiUmsaetzen = true;
  await abrufKnopf(zeile("Testbank")).click();
  await expect(tan).toBeVisible();
  await fintsWahl(grund);
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await fintsWahl(null);

  await abrufKnopf(zeile("Testbank")).click();
  await expect(tan).toBeVisible();
  await fintsWahl(grund);
  await tan.fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText(/^Testbank, \d+ neue Umsätze\.$/)).toBeVisible();
  await fintsWahl(null);

  // Danach verbindet FinTS wie bisher
  await fintsVerbinden();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();
});

test("„Jetzt abrufen“ und „Zugang ändern“ sind gesperrt, solange oben „Über FinTS verbinden“ offen ist", async () => {
  // Sonst stünde der Schritt an der Zeile neben dem Formular oben, und dessen Schritt ersetzte ihn, ohne dass Haben den
  // Vorgang bei der Bank verwirft (#1660)
  const sql = postgres(databaseUrlFuer("fints-abruf"), { max: 1, onnotice: () => {} });
  const status = async (s: "aktiv" | "fehler") => {
    await sql`update fints_connections set status = ${s}, last_error = ${s === "fehler" ? "Abruf fehlgeschlagen: PIN ungültig. (9942)" : null}`;
  };
  const z = zeile("Testbank");
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  const sobald = "gehen wieder, sobald das Verbinden über FinTS oben fertig oder abgebrochen ist.";
  const grund = `„Zugang ändern“ und „Jetzt abrufen“ ${sobald}`;
  try {
    await status("fehler");
    await gehe(page, "/bank/verbindungen");
    await fintsVerbinden();
    await expect(form).toBeVisible();
    await knoepfeStand(z, true, grund, ["Zugang ändern", "Jetzt abrufen"]);
    // Auch der Knopf zum Status („Fehlgeschlagen“) am Ende der Zeile
    await expect(z.getByRole("button", { name: "Zugang ändern" })).toBeDisabled();
    await expect(z.getByRole("button", { name: "Zugang ändern" })).toHaveAccessibleDescription(grund);
    await expect(await punkt(z, "Trennen")).toBeEnabled();
    await zu();
    await expect(z.getByText(grund)).toBeVisible();
    await form.getByRole("button", { name: "Abbrechen" }).click();
    await knoepfeStand(z, false, "", ["Zugang ändern", "Jetzt abrufen"]);
    await expect(page.getByText(grund)).toHaveCount(0);

    // Auch das Formular aus „Zugang ändern“ und der Schritt der Bank beim Verbinden; dort ist auch „Trennen“ gesperrt
    await z.getByRole("button", { name: "Zugang ändern" }).click();
    await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
    await expect(abrufKnopf(z)).toBeDisabled();
    await expect(abrufKnopf(z)).toHaveAccessibleDescription(grund);
    await form.getByLabel("PIN").fill("12345");
    await form.getByRole("button", { name: "Verbinden" }).click();
    await expect(freigabe().getByLabel("TAN-Verfahren")).toBeVisible();
    const alle = `„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ ${sobald}`;
    await knoepfeStand(z, true, alle, ["Trennen", "Jetzt abrufen"]);
    await freigabe().getByRole("button", { name: "Abbrechen" }).click();
    await expect(freigabe()).toHaveCount(0);
    await expect(abrufKnopf(z)).toBeEnabled();
    await expect(page.getByText(alle)).toHaveCount(0);
  } finally {
    await status("aktiv");
    await sql.end();
  }
});

test("FinTS im Dialog „Wie verbinden?“ ist gesperrt, solange eine Zeile „Rufe ab …“ zeigt", async () => {
  // Sonst ersetzte ein Schritt beim Verbinden den, mit dem die Bank auf den Abruf antwortet (#1660)
  await gehe(page, "/bank/verbindungen");
  const grund = "„Über FinTS verbinden“ geht wieder, sobald der Abruf für Testbank fertig ist.";
  let loslassen!: () => void;
  const gehalten = new Promise<void>((fertig) => {
    loslassen = fertig;
  });
  await page.route(
    (url) => url.pathname.startsWith("/_serverFn/"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await gehalten;
      await route.continue();
    },
  );
  try {
    await abrufKnopf(zeile("Testbank")).click();
    await expect(abrufKnopf(zeile("Testbank"))).toBeDisabled();
    await expect(abrufKnopf(zeile("Testbank"))).toHaveAttribute("title", "Rufe ab …");
    await fintsWahl(grund);
  } finally {
    loslassen();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(abruf().getByText(/^Testbank, \d+ neue Umsätze\.$/)).toBeVisible();
  await fintsWahl(null);
});

test("zweite Verbindung über FinTS zu einer anderen Bank", async () => {
  zweit = await startFintsTestbank({
    produktId: FINTS_PRODUKT_E2E,
    bankname: "Zweitbank",
    blz: ZWEIT_BLZ,
    konten: [{ iban: ZWEIT_GIRO, nummer: "5407324924", name: "Geschäftskonto" }],
    umsaetze: { [ZWEIT_GIRO]: [] },
  });
  await gehe(page, "/bank/verbindungen");
  await fintsVerbinden();
  await zugangEingeben("12345", zweit, ZWEIT_BLZ);
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Zweitbank verbunden/)).toBeVisible();
  // Beide Verbindungen stehen in der Tabelle, jede an ihren Konten
  await expect(zeile("Testbank")).toBeVisible();
  await expect(zeile("Zweitbank")).toBeVisible();
});

test("Formular oben offen bei zwei Verbindungen: jede Zeile nennt den Grund einmal", async () => {
  const grund = "„Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald das Verbinden über FinTS oben fertig oder abgebrochen ist.";
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await fintsVerbinden();
  await expect(form).toBeVisible();
  const zeilen = await fintsZeilen().count();
  expect(zeilen).toBeGreaterThan(1);
  for (let i = 0; i < zeilen; i++) {
    const z = fintsZeilen().nth(i);
    await expect(z.getByText(/wieder, sobald/)).toHaveText(grund);
    await knoepfeStand(z, true, grund, ["Zugang ändern", "Jetzt abrufen"]);
  }
  // Die IDs der Gründe sind je Zeile eigen, auch bei zwei Konten derselben Verbindung
  expect(await axeVerstoesse(page), "Gründe an mehreren Zeilen").toEqual([]);
  await form.getByRole("button", { name: "Abbrechen" }).click();
  await expect(banken().getByText(/wieder, sobald/)).toHaveCount(0);
});

test("Ist an einer Zeile ein Schritt der Bank offen, nennen die übrigen den Grund ihrer gesperrten Knöpfe", async () => {
  // Ein zweiter Schritt ersetzte den offenen, ohne dass Haben den Vorgang bei der Bank verwirft (#1662). Der Schritt steht
  // im Bereich über der Tabelle und nennt seine Bank
  const oben = zeile("Zweitbank");
  const unten = zeile("Testbank");
  const grund = "„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald die Freigabe für Testbank gesendet oder abgebrochen ist.";
  const tan = freigabe().getByLabel("TAN", { exact: true });
  const gesperrtMitGrund = async () => {
    await expect(oben.getByText(grund)).toBeVisible();
    await knoepfeStand(oben, true, grund);
    // Die Zeile mit dem Schritt nennt keinen Grund; ihr Schritt steht im Bereich
    await expect(unten.getByText(/wieder, sobald/)).toHaveCount(0);
    await expect(await punkt(unten, "Trennen")).toHaveAccessibleDescription("");
    await zu();
    await expect(abruf().getByRole("region", { name: "FinTS: Testbank" })).toBeVisible();
  };
  const freiOhneGrund = async () => {
    await expect(banken().getByText(grund)).toHaveCount(0);
    await knoepfeStand(oben, false, "");
  };

  bank.zustand.scaBeiUmsaetzen = true;
  await abrufKnopf(unten).click();
  await expect(tan).toBeVisible();
  await gesperrtMitGrund();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await freiOhneGrund();

  await abrufKnopf(unten).click();
  await expect(tan).toBeVisible();
  await gesperrtMitGrund();
  await tan.fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText(/^Testbank, \d+ neue Umsätze\.$/)).toBeVisible();
  await freiOhneGrund();
});

test("Zeigt eine Zeile „Rufe ab …“, nennen die übrigen den Grund ihrer gesperrten Knöpfe", async () => {
  // Die Bank kann auf den Abruf mit einem Schritt antworten, der sonst einen anderen ersetzte (#1662); mit „Zugang ändern“
  // an einer Verbindung mit Fehler
  const sql = postgres(databaseUrlFuer("fints-abruf"), { max: 1, onnotice: () => {} });
  const oben = zeile("Zweitbank");
  const unten = zeile("Testbank");
  const grund = "„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald der Abruf für Testbank fertig ist.";
  let loslassen!: () => void;
  const gehalten = new Promise<void>((fertig) => {
    loslassen = fertig;
  });
  try {
    await sql`update fints_connections set status = 'fehler', last_error = 'Abruf fehlgeschlagen: PIN ungültig. (9942)' where bank_name = 'Zweitbank'`;
    await gehe(page, "/bank/verbindungen");
    await expect(await punkt(oben, "Zugang ändern")).toBeEnabled();
    await zu();
    await page.route(
      (url) => url.pathname.startsWith("/_serverFn/"),
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await gehalten;
        await route.continue();
      },
    );
    try {
      await abrufKnopf(unten).click();
      await expect(abrufKnopf(unten)).toBeDisabled();
      await expect(abrufKnopf(unten)).toHaveAttribute("title", "Rufe ab …");
      await expect(oben.getByText(grund)).toBeVisible();
      await knoepfeStand(oben, true, grund);
      await expect(unten.getByText(/wieder, sobald/)).toHaveCount(0);
    } finally {
      loslassen();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(abruf().getByText(/^Testbank, \d+ neue Umsätze\.$/)).toBeVisible();
    await expect(banken().getByText(grund)).toHaveCount(0);
    await knoepfeStand(oben, false, "");
  } finally {
    await sql`update fints_connections set status = 'aktiv', last_error = null where bank_name = 'Zweitbank'`;
    await sql.end();
  }
});

test("zweite Verbindung zu einer Bank mit demselben Namen", async () => {
  dritt = await startFintsTestbank({
    produktId: FINTS_PRODUKT_E2E,
    bankname: "Testbank",
    blz: DRITT_BLZ,
    konten: [{ iban: DRITT_GIRO, nummer: "0532013001", name: "Girokonto" }],
    umsaetze: { [DRITT_GIRO]: [] },
  });
  await gehe(page, "/bank/verbindungen");
  await fintsVerbinden();
  await zugangEingeben("12345", dritt, DRITT_BLZ);
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();
  await expect(zeileMitKonto("2051")).toContainText("Testbank (FinTS)");
  await expect(zeileMitKonto("3001")).toContainText("Testbank (FinTS)");
});

test("Heißen zwei Verbindungen gleich, nennt der Grund die wartende mit der Endung ihrer IBAN", async () => {
  const wartend = zeileMitKonto("2051");
  const sobald = "sobald die Freigabe für Testbank …2051 gesendet oder abgebrochen ist.";
  const grund = `„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, ${sobald}`;
  bank.zustand.scaBeiUmsaetzen = true;
  await abrufKnopf(wartend).click();
  await expect(freigabe().getByLabel("TAN", { exact: true })).toBeVisible();
  for (const z of [zeileMitKonto("3001"), zeile("Zweitbank")]) {
    await expect(z.getByText(/wieder, sobald/)).toHaveText(grund);
    await knoepfeStand(z, true, grund, ["Zugang ändern", "Jetzt abrufen"]);
  }
  await fintsWahl(`„Über FinTS verbinden“ geht wieder, ${sobald}`);
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await expect(banken().getByText(/wieder, sobald/)).toHaveCount(0);
  bank.zustand.scaBeiUmsaetzen = false;
});

test("Läuft „Trennen“ an einer Zeile, nennen die übrigen den Grund ihrer gesperrten Knöpfe", async () => {
  const trennt = zeileMitKonto("3001");
  const uebrige = [zeile("Zweitbank"), zeileMitKonto("2051")];
  const grund = "„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald die Verbindung zu Testbank …3001 getrennt ist.";
  let loslassen!: () => void;
  const gehalten = new Promise<void>((fertig) => {
    loslassen = fertig;
  });
  await page.route(
    (url) => url.pathname.startsWith("/_serverFn/"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await gehalten;
      await route.continue();
    },
  );
  try {
    await (await punkt(trennt, "Trennen")).click();
    await bestaetigen(page, "Trennen");
    // Die Zeile selbst zeigt, was läuft, wie „Rufe ab …“ beim Abruf
    await expect(await punkt(trennt, "Trenne …")).toBeDisabled();
    await zu();
    await expect(trennt.getByText(/wieder, sobald/)).toHaveCount(0);
    for (const z of uebrige) {
      await expect(z.getByText(/wieder, sobald/)).toHaveText(grund);
      await knoepfeStand(z, true, grund);
    }
    // Neu verbinden stört das Trennen nicht und bleibt frei
    await fintsWahl(null);
  } finally {
    loslassen();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(trennt).toHaveCount(0);
  await expect(banken().getByText(/wieder, sobald/)).toHaveCount(0);
  for (const z of uebrige) await knoepfeStand(z, false, "");
});

test("Eine Verbindung über Enable Banking ohne Konto bleibt sichtbar und lässt sich trennen (Review #1951)", async () => {
  // Bestätigt die Bank die Freigabe nicht oder gibt kein Euro-Konto mit IBAN frei, steht die Verbindung ohne Konto auf
  // „Fehler“ (bank-sync.ts). Ohne Konto in der Leiste steht sie trotzdem mit Fehler und „Trennen“ in der Tabelle
  const sql = postgres(databaseUrlFuer("fints-abruf"), { max: 1, onnotice: () => {} });
  const fehler = "Die Bank hat kein Konto mit IBAN freigegeben.";
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e', true)`;
      await tx`insert into bank_connections (aspsp_name, aspsp_country, psu_type, status, accounts, last_error)
        values ('Leerbank', 'DE', 'business', 'fehler', '[]', ${fehler})`;
    });
  } finally {
    await sql.end();
  }
  await gehe(page, "/bank/verbindungen");
  const leer = banken().locator("tbody tr").filter({ hasText: "Leerbank" });
  await expect(leer).toBeVisible();
  await expect(leer).toContainText("Abruf · kein Konto in Haben");
  await expect(leer.getByText(fehler)).toBeVisible();
  await (await punkt(leer, "Trennen")).click();
  await bestaetigen(page, "Trennen");
  await expect(leer).toHaveCount(0);
});
