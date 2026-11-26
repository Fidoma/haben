import { type FintsTestbank, type FintsTestbankUmsatz, startFintsTestbank } from "@haben/import/fints-testbank";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, FINTS_BANK_PORT, FINTS_PRODUKT_E2E } from "./durchlaeufe.ts";
import { axeVerstoesse, bestaetigen, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Kontoabruf über FinTS (#654) in eigener, leerer Datenbank (Projekt „fints-abruf“, e2e/durchlaeufe.ts). Der Server
 * des Durchlaufs hat als einziger FINTS_PRODUKT_ID (playwright.config.ts); die Bank baut @haben/import/fints-testbank
 * nach: FinTS 3.0 mit PIN/TAN, chipTAN und pushTAN, zwei Konten, Umsätze als MT940.
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
  await expect(karte.getByRole("status")).toHaveText("Eingerichtet. Unter Bank verbindest du deine Bank mit „Über FinTS verbinden“.");
  await expect(page.getByText(FINTS_PRODUKT_E2E)).toHaveCount(0);
});

test("prüft den Zugang im Formular, bevor Haben die Bank fragt", async () => {
  await gehe(page, "/bank");
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
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
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
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
  await expect(abruf().getByText("Testbank Girokonto …2051", { exact: true })).toBeVisible();
  await expect(abruf().getByText("Aktiv")).toBeVisible();
  await expect(abruf().getByRole("button", { name: "Zugang ändern" })).toBeVisible();
  const konten = page.getByRole("navigation", { name: "Konten" });
  await expect(konten.getByRole("link", { name: /Tagesgeld/ })).toHaveCount(0);
  await expect(konten.getByRole("link", { name: /Testbank Girokonto …2051/ })).toContainText("Abruf");
  await expect(konten.getByRole("link", { name: /Testbank Girokonto …2051/ })).toContainText("1.140,01 €");
  await expect(page.getByText("Mobilfunk").first()).toBeVisible();
});

test("„Jetzt abrufen“ fragt die TAN ab, wenn die Bank sie verlangt", async () => {
  umsaetze[GIRO]!.push({ tag: tag(-1), betrag: "250,00", name: "Kunde AG", zweck: "RE-2026-0050", ref: "G3" });
  bank.zustand.scaBeiUmsaetzen = true;
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText("Testbank, 1 neue Umsätze.")).toBeVisible();
  await expect(page.getByText("RE-2026-0050").first()).toBeVisible();
});

test("„Über FinTS verbinden“ öffnet nach zugeklapptem „Zugang ändern“ ein leeres Formular", async () => {
  await gehe(page, "/bank");
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  const oeffnen = () => abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await abruf().getByRole("button", { name: "Zugang ändern" }).click();
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
  await oeffnen();
  await expect(form).toHaveCount(0);
  await oeffnen();
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("");
  await expect(form.getByLabel("FinTS-Adresse der Bank")).toHaveValue("");
  await expect(form.getByLabel("Anmeldename")).toHaveValue("");
  await form.getByRole("button", { name: "Abbrechen" }).click();

  // „Zugang ändern“ füllt das Formular weiter mit den Angaben der Verbindung, nur die PIN fehlt
  await abruf().getByRole("button", { name: "Zugang ändern" }).click();
  await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
  await expect(form.getByLabel("FinTS-Adresse der Bank")).toHaveValue(bank.url);
  await expect(form.getByLabel("Anmeldename")).toHaveValue("max");
  await expect(form.getByLabel("PIN")).toHaveValue("");
  await oeffnen();
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
  await gehe(page, "/bank");
  await expect(abruf().getByText("Abruf fehlgeschlagen: PIN ungültig. (9942)")).toBeVisible();
  await abruf().getByRole("button", { name: "Zugang ändern" }).click();
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
  await expect(abruf().getByText("Testbank Girokonto …2051 · Testbank Tagesgeld …9890")).toBeVisible();
  await expect(abruf().getByText("Aktiv")).toBeVisible();
  await expect(abruf().getByText("Abruf fehlgeschlagen: PIN ungültig. (9942)")).toHaveCount(0);
  await expect(abruf().getByRole("button", { name: "Zugang ändern" })).toBeVisible();
  // Das Formular schließt wie beim ersten Verbinden, mit der PIN darin bleibt nichts stehen
  await expect(page.getByRole("form", { name: "Über FinTS verbinden" })).toHaveCount(0);
});

test("pushTAN: wartet auf die Freigabe in der App", async () => {
  bank.zustand.scaBeiUmsaetzen = true;
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
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
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
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
  await expect(abruf().getByText("Aktiv")).toBeVisible();
  // „wait“ lässt verzögerte Anfragen noch fertig laufen
  await page.unrouteAll({ behavior: "wait" });
  bank.zustand.appTanEintippen = false;
});

test("erneut verbinden, bei der TAN für die Umsätze abgebrochen: die bisherige Verbindung bleibt und ruft ab", async () => {
  const ids = await verbindungsIds();
  const zuletzt = abruf().getByText(/^Zuletzt abgerufen/);
  const vorher = (await zuletzt.textContent())!;
  bank.zustand.scaBeiUmsaetzen = true;
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(freigabe().getByLabel("TAN", { exact: true })).toBeVisible();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);

  // Gleiche ID, „Zuletzt abgerufen“ wie vorher, auch nach dem Neuladen (#1617)
  expect(await verbindungsIds()).toEqual(ids);
  await gehe(page, "/bank");
  await expect(zuletzt).toHaveText(vorher);
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await freigabe().getByLabel("TAN", { exact: true }).fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText("Testbank, 0 neue Umsätze.")).toBeVisible();
});

test("Trennen löscht die Verbindung, die Umsätze bleiben", async () => {
  await abruf().getByRole("button", { name: "Trennen" }).click();
  await bestaetigen(page, "Trennen");
  await expect(abruf().getByText("Testbank", { exact: true })).toHaveCount(0);
  await expect(abruf().getByText(/Noch keine Bank verbunden/)).toBeVisible();
  await expect(page.getByText("RE-2026-0050").first()).toBeVisible();
});

test("erneut verbinden, bei der Wahl des TAN-Verfahrens abgebrochen: die bisherige Verbindung bleibt, wie sie ist", async () => {
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();
  const ids = await verbindungsIds();
  const zuletzt = abruf().getByText(/^Zuletzt abgerufen/);
  const vorher = (await zuletzt.textContent())!;

  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Über FinTS verbinden" })).toHaveCount(0);
  await expect(zuletzt).toHaveText(vorher);
  expect(await verbindungsIds()).toEqual(ids);
});

test("erneut verbinden, bei der TAN für die Umsätze abgebrochen: „Trennen“ an der Zeile trennt die Verbindung", async () => {
  bank.zustand.scaBeiUmsaetzen = true;
  const ids = await verbindungsIds();
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  // Verbinden hat den neuen Zugang schon gespeichert, die ID bleibt (#1617); erst der Abruf der Umsätze fragt die TAN
  // (#1614)
  await expect(freigabe().getByLabel("TAN", { exact: true })).toBeVisible();
  expect(await verbindungsIds()).toEqual(ids);
  await expect(abruf().getByRole("button", { name: "Trennen" })).toBeDisabled();
  // Das Formular schließt erst nach dem Neuladen, auch wenn die Seite langsam lädt; „Trennen“ danach findet die Verbindung
  const neuLaden = (url: URL) => url.pathname.startsWith("/_serverFn/");
  await page.route(neuLaden, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await new Promise((fertig) => setTimeout(fertig, 1500));
    await route.continue();
  });
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(abruf().getByRole("button", { name: "Trennen" })).toBeDisabled();
  await expect(freigabe()).toHaveCount(0);
  await abruf().getByRole("button", { name: "Trennen" }).click();
  await bestaetigen(page, "Trennen");
  await expect(abruf().getByText(/Noch keine Bank verbunden/)).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  await expect(abruf().getByText("Verbindung nicht gefunden.")).toHaveCount(0);
  bank.zustand.scaBeiUmsaetzen = false;
});

test("erneut verbinden, das Formular oben mit „Über FinTS verbinden“ zugeklappt, während die Bank wartet: wie „Abbrechen“", async () => {
  const oeffnen = () => abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await oeffnen();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();
  const ids = await verbindungsIds();

  // Vor dem Speichern des Zugangs, bei der Wahl des TAN-Verfahrens: Die Zeile bleibt, wie sie ist, und ihre Knöpfe gehen
  // wieder
  await oeffnen();
  await zugangEingeben();
  await expect(freigabe().getByLabel("TAN-Verfahren")).toBeVisible();
  await oeffnen();
  await expect(freigabe()).toHaveCount(0);
  await expect(abruf().getByRole("button", { name: "Trennen" })).toBeEnabled();
  expect(await verbindungsIds()).toEqual(ids);

  // Nach dem Speichern des Zugangs, bei der TAN für die Umsätze: Die ID bleibt (#1617), und „Trennen“ trennt die Verbindung,
  // auch wenn die Seite langsam neu lädt
  bank.zustand.scaBeiUmsaetzen = true;
  await oeffnen();
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
  await oeffnen();
  await expect(freigabe()).toHaveCount(0);
  await abruf().getByRole("button", { name: "Trennen" }).click();
  await bestaetigen(page, "Trennen");
  await expect(abruf().getByText(/Noch keine Bank verbunden/)).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  await expect(abruf().getByText("Verbindung nicht gefunden.")).toHaveCount(0);
  bank.zustand.scaBeiUmsaetzen = false;
});

test("„Über FinTS verbinden“ ist gesperrt, solange an einer Zeile ein Schritt der Bank offen ist", async () => {
  const verbinden = abruf().getByRole("button", { name: "Über FinTS verbinden" });
  const grund = "„Über FinTS verbinden“ geht wieder, sobald die Freigabe für Testbank gesendet oder abgebrochen ist.";
  const tan = freigabe().getByLabel("TAN", { exact: true });
  await verbinden.click();
  await zugangEingeben();
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await kontenwahl().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();

  // Sonst ersetzte der Schritt beim Verbinden den an der Zeile, ohne dass Haben den Vorgang bei der Bank verwirft
  bank.zustand.scaBeiUmsaetzen = true;
  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(tan).toBeVisible();
  await expect(verbinden).toBeDisabled();
  await expect(abruf().getByText(grund)).toBeVisible();
  await expect(verbinden).toHaveAccessibleDescription(grund);
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await expect(verbinden).toBeEnabled();
  await expect(abruf().getByText(grund)).toHaveCount(0);

  await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(tan).toBeVisible();
  await expect(verbinden).toBeDisabled();
  await tan.fill("123456");
  await freigabe().getByRole("button", { name: "TAN senden" }).click();
  await expect(abruf().getByText(/^Testbank, \d+ neue Umsätze\.$/)).toBeVisible();
  await expect(verbinden).toBeEnabled();

  // Danach verbindet der Knopf wie bisher
  await verbinden.click();
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
  const jetzt = abruf().getByRole("button", { name: "Jetzt abrufen" });
  const zugang = abruf().getByRole("button", { name: "Zugang ändern" });
  const trennen = abruf().getByRole("button", { name: "Trennen" });
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  const sobald = "gehen wieder, sobald das Verbinden über FinTS oben fertig oder abgebrochen ist.";
  const grund = `„Zugang ändern“ und „Jetzt abrufen“ ${sobald}`;
  try {
    await status("fehler");
    await gehe(page, "/bank");
    await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
    await expect(form).toBeVisible();
    await expect(jetzt).toBeDisabled();
    await expect(zugang).toBeDisabled();
    await expect(trennen).toBeEnabled();
    await expect(abruf().getByText(grund)).toBeVisible();
    await expect(jetzt).toHaveAccessibleDescription(grund);
    await expect(zugang).toHaveAccessibleDescription(grund);
    await form.getByRole("button", { name: "Abbrechen" }).click();
    await expect(jetzt).toBeEnabled();
    await expect(zugang).toBeEnabled();
    await expect(abruf().getByText(grund)).toHaveCount(0);

    // Auch das Formular aus „Zugang ändern“ und der Schritt der Bank beim Verbinden; dort ist auch „Trennen“ gesperrt
    await zugang.click();
    await expect(form.getByLabel("Bankleitzahl")).toHaveValue("12030000");
    await expect(jetzt).toBeDisabled();
    await expect(jetzt).toHaveAccessibleDescription(grund);
    await form.getByLabel("PIN").fill("12345");
    await form.getByRole("button", { name: "Verbinden" }).click();
    await expect(freigabe().getByLabel("TAN-Verfahren")).toBeVisible();
    const alle = `„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ ${sobald}`;
    await expect(trennen).toBeDisabled();
    await expect(trennen).toHaveAccessibleDescription(alle);
    await expect(jetzt).toHaveAccessibleDescription(alle);
    await freigabe().getByRole("button", { name: "Abbrechen" }).click();
    await expect(freigabe()).toHaveCount(0);
    await expect(jetzt).toBeEnabled();
    await expect(abruf().getByText(alle)).toHaveCount(0);
  } finally {
    await status("aktiv");
    await sql.end();
  }
});

test("„Über FinTS verbinden“ ist gesperrt, solange eine Zeile „Rufe ab …“ zeigt", async () => {
  // Sonst ersetzte ein Schritt beim Verbinden den, mit dem die Bank auf den Abruf antwortet (#1660)
  await gehe(page, "/bank");
  const verbinden = abruf().getByRole("button", { name: "Über FinTS verbinden" });
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
    await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
    await expect(abruf().getByRole("button", { name: "Rufe ab …" })).toBeDisabled();
    await expect(verbinden).toBeDisabled();
    await expect(abruf().getByText(grund)).toBeVisible();
    await expect(verbinden).toHaveAccessibleDescription(grund);
  } finally {
    loslassen();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(abruf().getByText(/^Testbank, \d+ neue Umsätze\.$/)).toBeVisible();
  await expect(verbinden).toBeEnabled();
  await expect(abruf().getByText(grund)).toHaveCount(0);
});

test("Zugeklapptes Verbinden, das noch auf die Bank wartet, ersetzt keinen Schritt an der Zeile", async () => {
  // Wie #1660 in der anderen Reihenfolge: Klappt „Über FinTS verbinden“ oben das Formular bei „Verbinde …“ zu, sind die
  // Knöpfe an den Zeilen frei; die späte Antwort auf das Verbinden darf den Schritt an der Zeile nicht ersetzen
  await gehe(page, "/bank");
  const verbinden = abruf().getByRole("button", { name: "Über FinTS verbinden" });
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  const tan = freigabe().getByLabel("TAN", { exact: true });
  let loslassen!: () => void;
  const gehalten = new Promise<void>((fertig) => {
    loslassen = fertig;
  });
  let anfrage: import("@playwright/test").Request | undefined;
  await page.route(
    (url) => url.pathname.startsWith("/_serverFn/"),
    async (route) => {
      if (route.request().method() !== "POST" || anfrage) return route.fallback();
      anfrage = route.request();
      await gehalten;
      await route.continue();
    },
  );
  bank.zustand.scaBeiAnmeldung = true;
  let verworfen!: Promise<unknown>;
  try {
    await verbinden.click();
    await zugangEingeben();
    await expect(form.getByRole("button", { name: "Verbinde …" })).toBeVisible();
    await verbinden.click();
    await expect(form).toHaveCount(0);
    bank.zustand.scaBeiUmsaetzen = true;
    await abruf().getByRole("button", { name: "Jetzt abrufen" }).click();
    await expect(tan).toBeVisible();
    verworfen = page.waitForResponse((r) => r.request() !== anfrage && r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/_serverFn/"));
  } finally {
    loslassen();
    await page.unrouteAll({ behavior: "wait" });
  }
  // Die späte Antwort verwirft den offenen Schritt bei der Bank (cancelFints) statt ihn an der Zeile einzusetzen
  await verworfen;
  await expect(tan).toBeVisible();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  // Das verworfene Verbinden hat die Anmeldung mit TAN nie abgeschlossen, die Testbank setzt scaBeiAnmeldung also nicht selbst zurück
  Object.assign(bank.zustand, { scaBeiAnmeldung: false, scaBeiUmsaetzen: false });
});

/** Zeile einer Verbindung im Bereich „Automatischer Abruf“, am Namen der Bank */
const zeile = (bankName: string) =>
  abruf()
    .locator(".history-row")
    .filter({ has: page.getByText(bankName, { exact: true }) });

test("zweite Verbindung über FinTS zu einer anderen Bank", async () => {
  zweit = await startFintsTestbank({
    produktId: FINTS_PRODUKT_E2E,
    bankname: "Zweitbank",
    blz: ZWEIT_BLZ,
    konten: [{ iban: ZWEIT_GIRO, nummer: "5407324924", name: "Geschäftskonto" }],
    umsaetze: { [ZWEIT_GIRO]: [] },
  });
  await gehe(page, "/bank");
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben("12345", zweit, ZWEIT_BLZ);
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Zweitbank verbunden/)).toBeVisible();
  // Die neuere Verbindung steht oben
  await expect(abruf().locator(".history-row").first()).toContainText("Zweitbank");
  await expect(zeile("Testbank")).toBeVisible();
});

test("Formular oben offen bei zwei Verbindungen: jede Zeile nennt den Grund einmal", async () => {
  const grund = "„Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald das Verbinden über FinTS oben fertig oder abgebrochen ist.";
  const form = page.getByRole("form", { name: "Über FinTS verbinden" });
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await expect(form).toBeVisible();
  for (const name of ["Zweitbank", "Testbank"]) {
    await expect(zeile(name).getByText(/wieder, sobald/)).toHaveText(grund);
    await expect(zeile(name).getByRole("button", { name: "Zugang ändern" })).toHaveAccessibleDescription(grund);
    await expect(zeile(name).getByRole("button", { name: "Jetzt abrufen" })).toHaveAccessibleDescription(grund);
  }
  await form.getByRole("button", { name: "Abbrechen" }).click();
  await expect(abruf().getByText(/wieder, sobald/)).toHaveCount(0);
});

test("Ist an einer Zeile ein Schritt der Bank offen, nennen die übrigen den Grund ihrer gesperrten Knöpfe", async () => {
  // Ein zweiter Schritt ersetzte den offenen, ohne dass Haben den Vorgang bei der Bank verwirft (#1662)
  const oben = zeile("Zweitbank");
  const unten = zeile("Testbank");
  const grund = "„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald die Freigabe für Testbank gesendet oder abgebrochen ist.";
  const tan = unten.getByLabel("TAN", { exact: true });
  const gesperrtMitGrund = async () => {
    await expect(oben.getByText(grund)).toBeVisible();
    for (const knopf of ["Trennen", "Zugang ändern", "Jetzt abrufen"]) {
      await expect(oben.getByRole("button", { name: knopf })).toBeDisabled();
      await expect(oben.getByRole("button", { name: knopf })).toHaveAccessibleDescription(grund);
    }
    // Die Zeile mit dem Schritt hat das Formular direkt unter sich
    await expect(unten.getByText(/wieder, sobald/)).toHaveCount(0);
    await expect(unten.getByRole("button", { name: "Trennen" })).toHaveAccessibleDescription("");
  };
  const freiOhneGrund = async () => {
    await expect(abruf().getByText(grund)).toHaveCount(0);
    for (const knopf of ["Trennen", "Zugang ändern", "Jetzt abrufen"]) {
      await expect(oben.getByRole("button", { name: knopf })).toBeEnabled();
      await expect(oben.getByRole("button", { name: knopf })).toHaveAccessibleDescription("");
    }
  };

  bank.zustand.scaBeiUmsaetzen = true;
  await unten.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(tan).toBeVisible();
  await gesperrtMitGrund();
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await freiOhneGrund();

  await unten.getByRole("button", { name: "Jetzt abrufen" }).click();
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
  const knoepfe = ["Trennen", "Zugang ändern", "Jetzt abrufen"];
  const grund = "„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, sobald der Abruf für Testbank fertig ist.";
  let loslassen!: () => void;
  const gehalten = new Promise<void>((fertig) => {
    loslassen = fertig;
  });
  try {
    await sql`update fints_connections set status = 'fehler', last_error = 'Abruf fehlgeschlagen: PIN ungültig. (9942)' where bank_name = 'Zweitbank'`;
    await gehe(page, "/bank");
    await expect(oben.getByRole("button", { name: "Zugang ändern" })).toBeEnabled();
    await page.route(
      (url) => url.pathname.startsWith("/_serverFn/"),
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await gehalten;
        await route.continue();
      },
    );
    try {
      await unten.getByRole("button", { name: "Jetzt abrufen" }).click();
      await expect(unten.getByRole("button", { name: "Rufe ab …" })).toBeDisabled();
      await expect(oben.getByText(grund)).toBeVisible();
      for (const knopf of knoepfe) {
        await expect(oben.getByRole("button", { name: knopf })).toBeDisabled();
        await expect(oben.getByRole("button", { name: knopf })).toHaveAccessibleDescription(grund);
      }
      await expect(unten.getByText(/wieder, sobald/)).toHaveCount(0);
    } finally {
      loslassen();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(abruf().getByText(/^Testbank, \d+ neue Umsätze\.$/)).toBeVisible();
    await expect(abruf().getByText(grund)).toHaveCount(0);
    for (const knopf of knoepfe) {
      await expect(oben.getByRole("button", { name: knopf })).toBeEnabled();
      await expect(oben.getByRole("button", { name: knopf })).toHaveAccessibleDescription("");
    }
  } finally {
    await sql`update fints_connections set status = 'aktiv', last_error = null where bank_name = 'Zweitbank'`;
    await sql.end();
  }
});

/** Zeile einer Verbindung, an der Endung der IBAN ihres ersten Kontos; zwei Verbindungen heißen „Testbank“ (#1677) */
const zeileMitKonto = (endung: string) =>
  abruf()
    .locator(".history-row")
    .filter({ has: page.getByText(`Girokonto …${endung}`) });

test("zweite Verbindung zu einer Bank mit demselben Namen", async () => {
  dritt = await startFintsTestbank({
    produktId: FINTS_PRODUKT_E2E,
    bankname: "Testbank",
    blz: DRITT_BLZ,
    konten: [{ iban: DRITT_GIRO, nummer: "0532013001", name: "Girokonto" }],
    umsaetze: { [DRITT_GIRO]: [] },
  });
  await gehe(page, "/bank");
  await abruf().getByRole("button", { name: "Über FinTS verbinden" }).click();
  await zugangEingeben("12345", dritt, DRITT_BLZ);
  await freigabe().getByLabel("TAN-Verfahren").selectOption({ label: "chipTAN manuell" });
  await freigabe().getByRole("button", { name: "Weiter" }).click();
  await expect(abruf().getByText(/^Testbank verbunden/)).toBeVisible();
  await expect(abruf().locator(".history-row")).toHaveCount(3);
  await expect(zeileMitKonto("3001")).toContainText("Testbank");
  await expect(zeileMitKonto("2051")).toContainText("Testbank");
});

test("Heißen zwei Verbindungen gleich, nennt der Grund die wartende mit der Endung ihrer IBAN", async () => {
  const wartend = zeileMitKonto("2051");
  const sobald = "sobald die Freigabe für Testbank …2051 gesendet oder abgebrochen ist.";
  const grund = `„Trennen“, „Zugang ändern“ und „Jetzt abrufen“ gehen wieder, ${sobald}`;
  const verbinden = abruf().getByRole("button", { name: "Über FinTS verbinden" });
  bank.zustand.scaBeiUmsaetzen = true;
  await wartend.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(wartend.getByLabel("TAN", { exact: true })).toBeVisible();
  for (const z of [zeileMitKonto("3001"), zeile("Zweitbank")]) {
    await expect(z.getByText(/wieder, sobald/)).toHaveText(grund);
    await expect(z.getByRole("button", { name: "Zugang ändern" })).toHaveAccessibleDescription(grund);
    await expect(z.getByRole("button", { name: "Jetzt abrufen" })).toHaveAccessibleDescription(grund);
  }
  await expect(verbinden).toBeDisabled();
  await expect(verbinden).toHaveAccessibleDescription(`„Über FinTS verbinden“ geht wieder, ${sobald}`);
  await freigabe().getByRole("button", { name: "Abbrechen" }).click();
  await expect(freigabe()).toHaveCount(0);
  await expect(abruf().getByText(/wieder, sobald/)).toHaveCount(0);
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
    await trennt.getByRole("button", { name: "Trennen" }).click();
    await bestaetigen(page, "Trennen");
    // Die Zeile selbst zeigt, was läuft, wie „Rufe ab …“ beim Abruf
    await expect(trennt.getByRole("button", { name: "Trenne …" })).toBeDisabled();
    await expect(trennt.getByText(/wieder, sobald/)).toHaveCount(0);
    for (const z of uebrige) {
      await expect(z.getByText(/wieder, sobald/)).toHaveText(grund);
      for (const knopf of ["Trennen", "Zugang ändern", "Jetzt abrufen"]) {
        await expect(z.getByRole("button", { name: knopf })).toBeDisabled();
        await expect(z.getByRole("button", { name: knopf })).toHaveAccessibleDescription(grund);
      }
    }
    // Neu verbinden stört das Trennen nicht und bleibt frei
    await expect(abruf().getByRole("button", { name: "Über FinTS verbinden" })).toBeEnabled();
  } finally {
    loslassen();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(abruf().locator(".history-row")).toHaveCount(2);
  await expect(abruf().getByText(/wieder, sobald/)).toHaveCount(0);
  for (const z of uebrige) {
    for (const knopf of ["Trennen", "Zugang ändern", "Jetzt abrufen"]) {
      await expect(z.getByRole("button", { name: knopf })).toBeEnabled();
      await expect(z.getByRole("button", { name: knopf })).toHaveAccessibleDescription("");
    }
  }
});
