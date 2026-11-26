import { filePickerPruefen } from "./dateiauswahl.ts";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { currentYear, YEAR } from "./daten.ts";
import { appDatabaseUrlFuer, type Durchlauf, databaseUrlFuer, ENABLE_BANKING_PORT } from "./durchlaeufe.ts";
import {
  axeVerstoesse,
  bankVerbinden,
  bestaetigen,
  faktenZeigen,
  kontoVerbinden,
  durchlaufSeite,
  gehe,
  kontrasteInThemes,
  neuenLieferantenOeffnen,
  ohneAxeVerstoesse,
  randImDialog,
} from "./einrichtung.ts";
import { LAPTOP } from "./kopfzeile.ts";
import { abzugEinspielen } from "./abzug.ts";

/**
 * Abschnitt von belege-steuern (#1742) mit eigenem Server und eigener Datenbank, parallel zu den anderen Abschnitten:
 * Einkommensteuer und Finanzamt, Einstellungen ohne eigene Daten (Cache-Header, Änderungsprotokoll, Versionen,
 * Postfach, Kontoabruf), Fristen, Pauschalen, Monatsauswahl und Jahreserklärung. Beginnt mit dem Abzug nach Einrichtung
 * und Steuerdaten in belege-steuern.spec.ts (e2e/abzug.ts).
 */

const DURCHLAUF = "belege-steuern-einstellungen" satisfies Durchlauf;

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

/**
 * Nachgebaute Enable-Banking-API mit drei Banken; der Server des Durchlaufs fragt sie über ENABLE_BANKING_API_URL
 * (playwright.config.ts). N26 bietet Privat- und Geschäftskonto an, damit die Kontoart erscheint.
 */
async function enableBankingAttrappe(): Promise<Server> {
  const aspsps = [
    { name: "N26", country: "DE", psu_types: ["personal", "business"], maximum_consent_validity: 180 * 86_400 },
    { name: "Fyrst", country: "DE", psu_types: ["business"], maximum_consent_validity: 90 * 86_400 },
    { name: "DKB", country: "DE", psu_types: ["personal"], maximum_consent_validity: 180 * 86_400 },
  ];
  const server = createServer((request, response) => {
    const found = new URL(request.url ?? "/", "http://localhost").pathname === "/aspsps";
    response.writeHead(found ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(found ? { aspsps } : { message: "nicht nachgebaut" }));
  });
  await new Promise<void>((resolve) => server.listen(ENABLE_BANKING_PORT, "127.0.0.1", resolve));
  return server;
}

test("Anlage N: Arbeitslohn des Ehegatten in der Einkommensteuer", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
  const n = form.getByRole("group", { name: "Anlage N · Erika" });
  // Die Anlage N steht in zugeklappten est-Blöcken (#869): vor dem Ausfüllen aufklappen
  const aufklappen = async () => {
    await n.first().waitFor({ state: "attached" });
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((d) => {
        d.open = true;
      });
    });
  };
  await aufklappen();
  await n.getByLabel("Erika hatte Arbeitslohn aus einer Anstellung").check();
  await aufklappen();
  const lstb = n.getByRole("group", { name: "Lohnsteuerbescheinigung 1 · Erika" });
  await lstb.getByLabel("Steuerklasse").selectOption("4");
  await lstb.getByLabel("Nr. 3 Bruttoarbeitslohn", { exact: true }).fill("42.000,00");
  await lstb.getByLabel("Nr. 4 Lohnsteuer", { exact: true }).fill("6.123,40");
  await lstb.getByLabel("Nr. 23a Rentenversicherung Arbeitnehmer", { exact: true }).fill("3.906,00");
  await lstb.getByLabel("Nr. 22a Rentenversicherung Arbeitgeber", { exact: true }).fill("3.906,00");
  await lstb.getByLabel("Nr. 25 Krankenversicherung", { exact: true }).fill("3.412,00");
  const wk = n.getByRole("group", { name: "Werbungskosten · Erika" });
  await wk.getByLabel("Erste Tätigkeitsstätte (PLZ, Ort, Straße)").fill("77815 Bühl, Industriestraße 4");
  await wk.getByLabel("Tage dort").fill("200");
  await wk.getByLabel("Einfache Entfernung in km").fill("25");
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
  await expect(form.getByText(/N \(Erika\)/)).toBeVisible();
  await expect(form.getByText("Bereits einbehalten (Lohnsteuer, Soli, KiSt)")).toBeVisible();
  await expect(form.getByText("6.123,40\u00a0€").first()).toBeVisible();
});

test("Anlage N: zugeklappte Werbungskosten nennen auch die Wege zur Arbeit", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const n = page.getByRole("form", { name: "Angaben zur Einkommensteuer" }).getByRole("group", { name: "Anlage N · Erika" });
  await n.locator("summary").first().click();
  // Gespeichert sind aus dem Test davor nur Tätigkeitsstätte, Tage und Entfernung
  await expect(n.locator("summary").filter({ hasText: "Werbungskosten" })).not.toContainText("nichts eingetragen");
});

test("Anlage N: Pflichtfeld im zugeklappten Block wird beim Speichern sichtbar", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
  const n = form.getByRole("group", { name: "Anlage N · Erika" });
  await n.locator("summary").first().click();
  await n.getByRole("button", { name: "Weitere Lohnsteuerbescheinigung" }).click();
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  // Die neue Bescheinigung steht zugeklappt; ohne Aufklappen kann der Browser das leere Pflichtfeld nicht zeigen,
  // und das Speichern bleibt ohne jede Rückmeldung stehen
  const brutto = n.getByRole("group", { name: "Lohnsteuerbescheinigung 2 · Erika" }).getByLabel("Nr. 3 Bruttoarbeitslohn", { exact: true });
  await expect(brutto).toBeFocused();
  // Die Meldung steht am Feld (#1277)
  await expect(brutto).toHaveAccessibleDescription("Trag den Bruttoarbeitslohn ein, etwa 42.000,00.");
});

test("Vorsorgeaufwand: Rürup, Wahlleistungen und Zuschüsse überstehen das Speichern (#943)", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
  // Über den Blocktitel, nicht über den Text: der Anlage-N-Block nennt die Vorsorgeaufwand-Zeilen ebenfalls.
  const block = () => form.locator("details.est-block").filter({ has: page.locator(".est-block-title", { hasText: /^Vorsorgeaufwand$/ }) });
  // Bei Zusammenveranlagung stehen die Felder beider Personen im Block; die der steuerpflichtigen Person trägt „a-“.
  const feld = (name: string) => block().locator(`input[name="a-${name}"]`);
  if ((await block().getAttribute("open")) === null) await block().locator("summary").click();
  await expect(feld("basisrente")).toHaveAccessibleName("Zertifizierte Basisrente (Rürup)");
  await feld("basisrente").fill("3.000,00");
  await feld("pkvWahlleistungen").fill("1.200,00");
  await feld("agZuschussKv").fill("3.000,00");
  await feld("agZuschussPv").fill("200,00");
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
  await expect(block().locator("summary")).toContainText(/4\.200,00\s€/);
  await page.reload();
  await page.waitForLoadState("networkidle");
  // Nach dem Neuladen trägt der Blocktitel die Summe; die Blöcke starten zugeklappt, also aufklappen.
  await expect(block().locator("summary")).toContainText(/4\.200,00\s€/);
  if ((await block().getAttribute("open")) === null) await block().locator("summary").click();
  await expect(feld("basisrente")).toHaveValue("3.000,00");
  await expect(feld("pkvWahlleistungen")).toHaveValue("1.200,00");
  await expect(feld("agZuschussKv")).toHaveValue("3.000,00");
  await expect(feld("agZuschussPv")).toHaveValue("200,00");
});

test("Vorsorgeaufwand: Zuschüsse zur gesetzlichen KV (Nr. 24 a) und zur Pflegeversicherung (Nr. 24 c) speichern (#1009)", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
  const block = () => form.locator("details.est-block").filter({ has: page.locator(".est-block-title", { hasText: /^Vorsorgeaufwand$/ }) });
  const feld = (name: string) => block().locator(`input[name="a-${name}"]`);
  if ((await block().getAttribute("open")) === null) await block().locator("summary").click();
  await expect(feld("agZuschussGkv")).toHaveAccessibleName("Arbeitgeberzuschuss zur gesetzlichen KV");
  // Nr. 24 c gilt auch für freiwillig gesetzlich Versicherte (E2003907: „Gesetzliche Pflegeversicherung laut Nr. 24 c“)
  await expect(feld("agZuschussPv")).toHaveAccessibleName("Arbeitgeberzuschuss zur Pflegeversicherung");
  await feld("agZuschussGkv").fill("840,00");
  await feld("agZuschussPv").fill("120,00");
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");
  if ((await block().getAttribute("open")) === null) await block().locator("summary").click();
  await expect(feld("agZuschussGkv")).toHaveValue("840,00");
  await expect(feld("agZuschussPv")).toHaveValue("120,00");
});

test("Einkommensersatzleistungen: eintragen, speichern, nach dem Neuladen wieder da (#941)", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
  const block = () =>
    form.locator("details.est-block").filter({ has: page.locator(".est-block-title", { hasText: /^Einkommensersatzleistungen \(Progressionsvorbehalt\)$/ }) });
  // Bei Zusammenveranlagung stehen die Felder beider Personen im Block; die der steuerpflichtigen Person trägt „a-“.
  const feld = (art: string) => block().locator(`input[name="erst-a-${art}"]`);
  // Ohne gespeicherte Leistungen bleibt der Block zu; die Felder sind erst nach dem Aufklappen sichtbar.
  if ((await block().getAttribute("open")) === null) await block().locator("summary").click();
  await expect(feld("Elterngeld")).toHaveAccessibleName("Elterngeld");
  await feld("Elterngeld").fill("1.200,40");
  await feld("Krankengeld").fill("480");
  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
  await expect(block().locator("summary")).toContainText(/1\.680,40\s€/);
  await page.reload();
  await page.waitForLoadState("networkidle");
  // Nach dem Neuladen trägt der Blocktitel die Summe; der Block startet trotzdem zugeklappt wie die anderen (#1086)
  await expect(block().locator("summary")).toContainText(/1\.680,40\s€/);
  await expect(block()).not.toHaveAttribute("open");
  await block().locator("summary").click();
  await expect(feld("Elterngeld")).toHaveValue("1.200,40");
  await expect(feld("Krankengeld")).toHaveValue("480,00");
  await expect(feld("Arbeitslosengeld")).toHaveValue("");
});

test("Einkommensteuer: Kinder, Angaben des Ehegatten und ungültige Beträge beim Speichern", async () => {
  // Spätere Tests öffnen dasselbe Jahr; damit sie es vorfinden wie ohne diesen Test, kommen die gespeicherten Angaben am Ende unverändert zurück
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  const vorher = await sql`select * from income_tax_inputs where year = ${YEAR - 1}`;
  try {
    await go(`/jahreserklaerung/${YEAR - 1}`);
    const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });
    const feld = (name: string) => form.locator(`input[name="${name}"]`);
    const kinder = form.locator("details.est-block").filter({ has: page.locator(".est-block-title", { hasText: /^Kinder$/ }) });
    const kind = form.getByRole("group", { name: "Kind 1" });
    const aufklappen = () =>
      form.evaluate((f) => {
        for (const block of f.querySelectorAll("details")) block.open = true;
      });
    const neuLaden = async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await aufklappen();
    };
    await aufklappen();
    await expect(kinder.locator("summary")).toContainText("keine");
    await form.getByRole("button", { name: "+ Kind hinzufügen" }).click();
    await kind.getByLabel("Vorname").fill("Lena");
    await kind.getByLabel("Geburtsdatum").fill(`${YEAR - 10}-04-12`);
    await kind.getByLabel("Familienkasse").fill("Familienkasse Baden-Württemberg West");
    await kind.getByLabel("Kinderbetreuungskosten (€)").fill("viel");
    // Bei Zusammenveranlagung tragen die Felder des Ehegatten „b-“
    await feld("b-rv").fill("2.400,00");
    await feld("erst-b-Elterngeld").fill("900");
    await feld("kapMit").fill("350,00");
    await form.getByLabel("Günstigerprüfung beantragen").check();
    await feld("handwerker").fill("800");
    await feld("spenden").fill("12€50");
    // Zugeklappt: Ein Fehler darin klappt den Block beim Speichern wieder auf (#1277)
    const sonderausgaben = form.locator("details.est-block").filter({ has: page.locator(".est-block-title", { hasText: /^Sonderausgaben und Belastungen$/ }) });
    await sonderausgaben.locator("summary").click();
    await expect(feld("spenden")).toBeHidden();
    await form.getByRole("button", { name: "Angaben speichern" }).click();
    // Je Feld die Meldung, der Fokus im ersten Feld mit Fehler, gespeichert ist nichts (#1277)
    const meldung = "Trag den Betrag ein, etwa 1.234,56, oder lass das Feld leer.";
    await expect(feld("spenden")).toBeFocused();
    await expect(feld("spenden")).toHaveAccessibleDescription(`an steuerbegünstigte Empfänger im Inland ${meldung}`);
    await expect(kind.getByLabel("Kinderbetreuungskosten (€)")).toHaveAccessibleDescription(meldung);
    await expect(feld("handwerker")).not.toHaveAttribute("aria-invalid");
    await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toHaveCount(0);
    expect(await sql`select data from income_tax_inputs where year = ${YEAR - 1}`).toEqual(vorher.map(({ data }) => ({ data })));
    await feld("spenden").fill("12,00");
    await kind.getByLabel("Kinderbetreuungskosten (€)").fill("1.500,00");
    await form.getByRole("button", { name: "Angaben speichern" }).click();
    await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();

    await neuLaden();
    await expect(kinder.locator("summary")).toContainText("1 Kind");
    await expect(kind.getByLabel("Vorname")).toHaveValue("Lena");
    await expect(kind.getByLabel("Geburtsdatum")).toHaveValue(`${YEAR - 10}-04-12`);
    await expect(kind.getByLabel("Familienkasse")).toHaveValue("Familienkasse Baden-Württemberg West");
    await expect(kind.getByLabel("Kinderbetreuungskosten (€)")).toHaveValue("1.500,00");
    await expect(feld("b-rv")).toHaveValue("2.400,00");
    await expect(feld("erst-b-Elterngeld")).toHaveValue("900,00");
    await expect(feld("kapMit")).toHaveValue("350,00");
    await expect(form.getByLabel("Günstigerprüfung beantragen")).toBeChecked();
    await expect(feld("handwerker")).toHaveValue("800,00");
    await expect(feld("spenden")).toHaveValue("12,00");

    await kind.getByRole("button", { name: "Kind entfernen" }).click();
    await form.getByRole("button", { name: "Angaben speichern" }).click();
    await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
    await neuLaden();
    await expect(kinder.locator("summary")).toContainText("keine");
    await expect(kind).toHaveCount(0);
  } finally {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e-test', true)`;
      await tx`delete from income_tax_inputs where year = ${YEAR - 1}`;
      for (const row of vorher) {
        await tx`insert into income_tax_inputs (year, data, updated_at) values (${row.year}, ${JSON.stringify(row.data)}::jsonb, ${row.updated_at})`;
      }
    });
    await sql.end();
  }
});

test("Finanzamt: Hinweis nur auf weggelassene Vorjahresleistungen (#1008)", async () => {
  const jahr = currentYear();
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  const vorher = await sql`select * from income_tax_inputs where year in (${jahr - 1}, ${jahr})`;
  const hinweis = `Einkommensersatzleistungen aus ${jahr - 1} sind in dieser Schätzung für ${jahr} nicht enthalten.`;
  const basis = page.getByRole("region", { name: `Einkommensteuer-Vorauszahlungen ${jahr}` });
  const angaben = { vorsorge: { a: {} }, sonderausgaben: {}, haushaltsnah: {}, kinder: [] };
  const speichern = async (year: number, ersatzleistungen: Record<string, { art: string; betrag: number }[]>) => {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e-test', true)`;
      await tx`insert into income_tax_inputs (year, data) values (${year}, ${JSON.stringify({ ...angaben, ersatzleistungen })}::jsonb)
        on conflict (year) do update set data = excluded.data`;
    });
    await go("/finanzamt");
    await expect(basis).toBeVisible();
  };
  try {
    await sql`delete from income_tax_inputs where year in (${jahr - 1}, ${jahr})`;
    await speichern(jahr - 1, { b: [{ art: "Krankengeld", betrag: 600_000 }] });
    await expect(basis).toContainText(hinweis);
    await expect(basis.getByRole("link", { name: "Angaben bearbeiten" })).toHaveAttribute("href", `/jahreserklaerung/${jahr}`);
    for (const leistungen of [{}, { a: [], b: [] }, { a: [{ art: "Elterngeld", betrag: 0 }] }]) {
      await speichern(jahr - 1, leistungen);
      await expect(basis).not.toContainText(hinweis);
    }
    await speichern(jahr - 1, { a: [{ art: "Elterngeld", betrag: 1_000_000 }] });
    await expect(basis).toContainText(hinweis);
    await speichern(jahr, { a: [{ art: "Elterngeld", betrag: 1_000_000 }] });
    await expect(basis).not.toContainText(hinweis);
  } finally {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'e2e-test', true)`;
      await tx`delete from income_tax_inputs where year in (${jahr - 1}, ${jahr})`;
      for (const row of vorher) {
        await tx`insert into income_tax_inputs (year, data, updated_at) values (${row.year}, ${JSON.stringify(row.data)}::jsonb, ${row.updated_at})`;
      }
    });
    await sql.end();
  }
});

test("Seiten nur von derselben Origin einbettbar", async () => {
  // Clickjacking-Schutz kommt von der App selbst, damit der Proxy SAMEORIGIN statt DENY setzen kann
  const html = await page.request.get("/rechnungen");
  expect(html.headers()["content-type"]).toContain("text/html");
  expect(html.headers()["content-security-policy"]).toBe("frame-ancestors 'self'");
  expect(html.headers()["x-frame-options"]).toBeUndefined();
});

test("Cache-Header: Seiten und Server-Funktionen nie in geteilte Caches, Dateien aus public/ neu validieren", async () => {
  const html = await page.request.get("/rechnungen");
  expect(html.headers()["cache-control"]).toBe("private, no-store");
  const serverFn = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/_serverFn/") && r.request().method() === "GET");
  await go("/rechnungen");
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Belege", exact: true }).click();
  expect((await serverFn).headers()["cache-control"]).toBe("private, no-store");
  // Nur der gebaute Server: Im Entwicklungsserver liefert Vite public/ und die Assets aus, ohne die routeRules von Nitro
  if (!process.env.E2E_SERVER_COMMAND) return;
  for (const datei of ["/sw.js", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/fastbill-belege.js"]) {
    expect((await page.request.get(datei)).headers()["cache-control"], datei).toBe("no-cache");
  }
  const skript = new URL(
    await page
      .locator('script[src^="/assets/"], link[href^="/assets/"]')
      .first()
      .evaluate((e) => (e as HTMLScriptElement).src || (e as HTMLLinkElement).href),
  );
  expect((await page.request.get(skript.pathname)).headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
});

test("Änderungsprotokoll: Kette prüfen, Prüfwert vergleichen", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("region", { name: "Änderungsprotokoll prüfen" });
  const pruefwert = (await card.locator("code").textContent())!;
  expect(pruefwert).toMatch(/^Nr\. \d+ · [0-9a-f]{64}$/);
  await card.getByRole("button", { name: "Kette prüfen" }).click();
  await expect(card.getByRole("status")).toContainText("Kette, Siegel und Sperren sind unverändert");
  const field = card.getByLabel("Prüfwert aus Mail oder Jahresarchiv");
  await field.fill(pruefwert);
  await card.getByRole("button", { name: "Vergleichen" }).click();
  await expect(card.getByRole("status")).toContainText("stimmt und die Kette ist bis dorthin lückenlos");
  await field.fill(pruefwert.slice(0, -1) + (pruefwert.endsWith("0") ? "1" : "0"));
  await card.getByRole("button", { name: "Vergleichen" }).click();
  await expect(card.getByRole("alert")).toContainText("stimmt nicht");
});

test("Version: installierte Version ohne Fehlermeldung, Update-Anleitung verlinkt (#1239)", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("region", { name: "Version", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Installiert: v\d+\.\d+\.\d+/);
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Versionshinweise" })).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/Speicherstadt\/haben\/releases\/tag\/v\d+\.\d+\.\d+/,
  );
  await card.getByText("So aktualisierst du").click();
  await expect(card.getByRole("link", { name: "Docker Compose und Podman Quadlets" })).toHaveAttribute(
    "href",
    "https://haben.app/installation-backup.html#updates",
  );
});

test("Eingesetzte Versionen: Verlauf und Versionshinweise anzeigen (#841)", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("region", { name: "Eingesetzte Versionen" });
  await expect(card).toBeVisible();
  const rows = card.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/v\d+\.\d+\.\d+/);
  await expect(rows.first().getByRole("link", { name: /Versionshinweise/ })).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/Speicherstadt\/haben\/releases\/tag\/v\d+\.\d+\.\d+/,
  );
});

test("Datenbankzugriff: tatsächliche Verbindungsrollen in den Einstellungen anzeigen (#619)", async () => {
  await go("/einstellungen?bereich=export");
  const card = page.getByRole("region", { name: "Datenbankzugriff", exact: true });
  await expect(card).toBeVisible();
  const sql = postgres(appDatabaseUrlFuer("belege-steuern"), { max: 1 });
  try {
    const [connection] = await sql<{ role: string; login_role: string }[]>`select current_user as role, session_user as login_role`;
    await expect(card.locator("dt")).toHaveText(["Aktuelle Rolle", "Anmelderolle"]);
    await expect(card.locator("dd")).toHaveText([connection!.role, connection!.login_role]);
    await expect(card).toContainText(/Appbetrieb mit eingeschränkten Rechten|Verbindung mit weitergehenden Rechten/);
    await expect(card.getByRole("link", { name: "Getrennte Datenbankrollen einrichten" })).toHaveAttribute(
      "href",
      "https://haben.app/installation-konfiguration.html#getrennte-datenbankrollen",
    );
    await expect(card.locator("input, textarea, select, button")).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

test("Änderungsprotokoll: Kontenkollisionen getrennt von Manipulation melden (#787)", async () => {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  try {
    // Bestand, dessen Nummern erst eine spätere Haben-Version reserviert hat; auch archivierte Konten wirken weiter.
    await sql`insert into own_accounts (kontenrahmen, account, name, parent_category, archived_at, created_by)
      values ('SKR03', '4920', 'Eigene Software 03', 'software', null, 'test-user'),
        ('SKR04', '6805', 'Eigene Software 04', 'software', now(), 'test-user')`;
    await go("/einstellungen?bereich=export");
    const card = page.getByRole("region", { name: "Änderungsprotokoll prüfen" });
    await card.getByRole("button", { name: "Kette prüfen" }).click();
    await expect(card.getByRole("status")).toContainText("2 Kontenkollisionen");
    await expect(card.getByRole("status")).toHaveClass(/banner-info/);
    await expect(card.getByRole("alert")).toHaveCount(0);
    const collisions = card.getByRole("region", { name: "Kontenkollisionen" });
    await expect(collisions).toContainText("SKR03 · 4920 · Eigene Software 03");
    await expect(collisions).toContainText("SKR04 · 6805 · Eigene Software 04");
    await expect(collisions).toContainText("Archivieren allein löst die Kollision nicht");
  } finally {
    await sql`delete from own_accounts where created_by = 'test-user' and name in ('Eigene Software 03', 'Eigene Software 04')`;
    await sql.end();
  }
});

test("Änderungsprotokoll: Dateien prüfen meldet eine fehlende Belegdatei (#857)", async () => {
  const sql = postgres(databaseUrlFuer(DURCHLAUF), { max: 1 });
  const sha256 = "e2e0".repeat(16);
  const card = page.getByRole("region", { name: "Änderungsprotokoll prüfen" });
  try {
    // Ein Beleg, dessen Datei im Speicher fehlt, etwa weil jemand sie im Dateisystem gelöscht hat
    await sql`insert into documents (sha256, filename, mime_type, size) values (${sha256}, 'verschwunden.pdf', 'application/pdf', 1)`;
    await go("/einstellungen?bereich=export");
    await card.getByRole("button", { name: "Dateien prüfen" }).click();
    await expect(card.getByRole("alert")).toContainText("Kette, Siegel und Sperren sind unverändert, aber 1 Datei fehlt oder ist verändert");
    await expect(card.getByRole("listitem").filter({ hasText: "verschwunden.pdf" })).toHaveText("Beleg verschwunden.pdf: fehlt");
  } finally {
    await sql`delete from documents where sha256 = ${sha256}`;
    await sql.end();
  }
  // „Kette prüfen“ liest die Dateien nicht erneut, sondern zeigt den gespeicherten Lauf
  await go("/einstellungen?bereich=export");
  await card.getByRole("button", { name: "Kette prüfen" }).click();
  await expect(card.getByRole("alert")).toContainText("1 Datei fehlt oder ist verändert");
  await card.getByRole("button", { name: "Dateien prüfen" }).click();
  await expect(card.getByRole("status")).toContainText("Kette, Siegel und Sperren sind unverändert:");
  await expect(card).toContainText("alle vorhanden und unverändert");
});

test("Belege per E-Mail: Postfach einrichten, Fehler beim Abruf sichtbar", async () => {
  await go("/einstellungen?bereich=email");
  const card = page.getByRole("form", { name: "Belege per E-Mail" });
  // Port 1 auf dem eigenen Rechner: kein IMAP-Server, der Abruf scheitert sofort
  await card.getByLabel("IMAP-Server").fill("127.0.0.1");
  await card.getByLabel("Port", { exact: true }).fill("1");
  await card.getByLabel("Verschlüsselung").selectOption("starttls");
  await card.getByLabel("Benutzername").fill("belege@mustermann.example");
  await card.getByLabel("Passwort").fill("geheim");
  await card.getByLabel("Ordner für Eingangsrechnungen").fill("Belege");
  await card.getByLabel("Freigegebene Absender").fill("rechnung@funknetz.example, @lieferant.example");
  await card.getByLabel("Ordner für Ausgangsrechnungen").fill("Ausgang");
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("status")).toHaveText("Postfach gespeichert.");
  await card.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(card.getByRole("alert")).toContainText("Abruf fehlgeschlagen");
  // Freigegebene Absender und Ausgangsordner sind gespeichert
  await go("/einstellungen?bereich=email");
  await expect(card.getByLabel("Freigegebene Absender")).toHaveValue("rechnung@funknetz.example\n@lieferant.example");
  await expect(card.getByLabel("Ordner für Ausgangsrechnungen")).toHaveValue("Ausgang");

  await go("/belege");
  await expect(page.getByText(/Belege per E-Mail: Anhänge an belege@mustermann\.example \(Ordner Belege\)/)).toBeVisible();
  await expect(page.getByText("Belege per E-Mail: Server nicht erreichbar.")).toBeVisible();
});

test("Kontoabruf: Enable Banking in den Einstellungen, ein falscher Schlüssel wird abgelehnt", async () => {
  await go("/bank");
  // Ohne Zugang zu Enable Banking steht der Weg im Dialog ausgegraut, mit Grund und Link zu den Einstellungen (#1951)
  await kontoVerbinden(page, "Bank hinzufügen");
  const wie = page.getByRole("dialog", { name: "Wie verbinden?" });
  const enableBanking = wie.getByRole("radio", { name: "Online-Banking über Enable Banking (PSD2)" });
  await expect(enableBanking).toBeDisabled();
  await expect(enableBanking).toHaveAccessibleDescription(/Braucht einen Zugang zu Enable Banking; einrichten unter Einstellungen › Bank\.$/);
  // Vorgewählt ist der erste Weg, der geht
  await expect(wie.getByRole("radio", { name: "Kontoauszüge als Datei (CSV/CAMT)" })).toBeChecked();
  expect(await axeVerstoesse(page), "Dialog „Wie verbinden?“").toEqual([]);
  // Der Link im Grund führt zur Einrichtung
  await wie.getByRole("link", { name: "Einstellungen › Bank" }).click();

  await page.waitForURL("**/einstellungen?bereich=bank");
  const card = page.getByRole("form", { name: "Automatischer Kontoabruf" });
  await expect(card.getByText("/api/bank/callback")).toBeVisible();
  // Die Application ID kommt aus dem Dateinamen der .pem
  await card
    .getByLabel("Privater Schlüssel (.pem)")
    .setInputFiles({ name: "0b7c3f1e-1234-4abc-9def-0123456789ab.pem", mimeType: "application/x-pem-file", buffer: Buffer.from("kein Schlüssel") });
  await expect(card.getByLabel("Application ID")).toHaveValue("0b7c3f1e-1234-4abc-9def-0123456789ab");
  await card.getByRole("button", { name: "Prüfen und speichern" }).click();
  await expect(card.getByRole("alert")).toContainText("keine gültige .pem-Datei");
});

test("Bank verbinden: die markierte Bank ist gewählt, auch als einziger Treffer der Suche (#555)", async () => {
  const api = await enableBankingAttrappe();
  try {
    await go("/einstellungen?bereich=bank");
    const card = page.getByRole("form", { name: "Automatischer Kontoabruf" });
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await card.getByLabel("Privater Schlüssel (.pem)").setInputFiles({
      name: "0b7c3f1e-1234-4abc-9def-0123456789ab.pem",
      mimeType: "application/x-pem-file",
      buffer: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })),
    });
    await card.getByRole("button", { name: "Prüfen und speichern" }).click();
    await expect(card.getByText("Zugang geprüft und verschlüsselt gespeichert")).toBeVisible();

    await go("/bank");
    await bankVerbinden(page, "Online-Banking über Enable Banking (PSD2)");
    const banken = page.getByRole("listbox");
    const weiter = page.getByRole("button", { name: "Weiter zur Bank" });
    // Markiert und gewählt ist dasselbe: zu Beginn die erste Bank der Liste
    await expect(banken.getByRole("option")).toHaveText(["DKB", "Fyrst", "N26"]);
    await expect(banken).toHaveValue("DKB");
    await expect(page.getByText("Du wirst zu DKB weitergeleitet")).toBeVisible();
    await expect(weiter).toBeEnabled();

    // Bleibt nach der Suche nur eine Bank, ist sie markiert und auch gewählt; vorher blieb der Knopf grau (#555)
    await page.getByLabel("Bank suchen").fill("N26");
    await expect(banken.getByRole("option")).toHaveText(["N26"]);
    await banken.getByRole("option", { name: "N26" }).click();
    await expect(weiter).toBeEnabled();
    await expect(page.getByText("Du wirst zu N26 weitergeleitet")).toBeVisible();
    await expect(page.getByRole("group", { name: "Kontoart" })).toBeVisible();

    // Ohne Klick: der einzige Treffer ist gewählt und bleibt es, wenn die Suche wieder alle zeigt
    await page.getByLabel("Bank suchen").fill("fyrst");
    await expect(banken.getByRole("option")).toHaveText(["Fyrst"]);
    await expect(page.getByText("Du wirst zu Fyrst weitergeleitet")).toBeVisible();
    await expect(weiter).toBeEnabled();
    await page.getByLabel("Bank suchen").fill("");
    await expect(banken.getByRole("option")).toHaveCount(3);
    await expect(banken).toHaveValue("Fyrst");
    await expect(page.getByText("Du wirst zu Fyrst weitergeleitet")).toBeVisible();

    // Abrufbeginn in der Zukunft: Mit noValidate prüft der Browser max nicht mehr, der Fehler steht am Feld (Review #970)
    const ab = page.getByLabel("Umsätze abrufen ab");
    await ab.fill(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
    await weiter.click();
    await expect(ab).toBeFocused();
    await expect(ab).toHaveAttribute("aria-invalid", "true");
    await ab.fill("");

    // Kein Treffer: nichts gewählt; der Knopf bleibt bedienbar und sagt am Feld, warum es nicht weitergeht (DESIGN.md, Gesperrte Knöpfe)
    await page.getByLabel("Bank suchen").fill("Sparkasse");
    await expect(banken.getByRole("option")).toHaveCount(0);
    await weiter.click();
    await expect(banken).toBeFocused();
    await expect(banken).toHaveAccessibleDescription("Keine Bank passt zu „Sparkasse“. Ändere die Suche.");
    await page.getByRole("button", { name: "Abbrechen" }).click();

    // Zugang wieder entfernen, damit die folgenden Tests die Bankseite wie zuvor sehen
    await go("/einstellungen?bereich=bank");
    await card.getByRole("button", { name: "Entfernen" }).click();
    await bestaetigen(page, "Entfernen");
    await expect(card.getByLabel("Privater Schlüssel (.pem)")).toBeVisible();
  } finally {
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Farbe und Modus wechseln, bleiben nach dem Neuladen, Version unten in der Navigation", async () => {
  await go("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  // Die eingeklappte Leiste steht verborgen daneben im DOM, mit eigener Auswahl von Farbe und Modus
  const farbe = nav.getByLabel("Farbe").filter({ visible: true });
  const modus = nav.getByLabel("Modus").filter({ visible: true });
  await expect(nav.getByRole("link", { name: /^Haben \d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/ })).toBeVisible();
  const html = page.locator("html");
  await farbe.selectOption("pflaume");
  await modus.selectOption("dunkel");
  await expect(html).toHaveAttribute("data-theme", "pflaume");
  await expect(html).toHaveAttribute("data-mode", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "pflaume");
  await expect(html).toHaveAttribute("data-mode", "dark");
  await expect(farbe).toHaveValue("pflaume");
  await expect(modus).toHaveValue("dunkel");
  await farbe.selectOption("wald");
  await modus.selectOption("hell");
  await expect(html).toHaveAttribute("data-theme", "wald");
  await expect(html).toHaveAttribute("data-mode", "light");
});

test("Fristen und Kalender-Abo", async () => {
  await go("/fristen");
  await expect(page.getByRole("heading", { name: "Fristen", level: 1 })).toBeVisible();
  // „Später“ zeigt erst sechs Fristen, der Rest klappt auf
  const spaeter = page.getByRole("region", { name: /^Später/ });
  await expect(spaeter.getByRole("row")).toHaveCount(7);
  await spaeter.getByRole("button", { name: /^Alle \d+ zeigen$/ }).click();
  await expect(spaeter.getByRole("button", { name: /^Alle \d+ zeigen$/ })).toHaveCount(0);
  expect(await spaeter.getByRole("row").count()).toBeGreaterThan(7);
  await expect(page.getByText(/Umsatzsteuer-Voranmeldung/).first()).toBeVisible();
  await expect(page.getByText("Umsatzsteuer melden und zahlen").first()).toBeVisible();
  const abo = page.getByRole("region", { name: "Erinnerungen im Kalender" });
  await abo.getByRole("button", { name: "Kalender-Abo einrichten" }).click();
  const url = await abo.getByLabel(/Abo-Link/).inputValue();
  expect(url).toMatch(/\/api\/fristen\/kalender\?token=[\w-]{32}$/);
  const ics = await page.request.get(url);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain("BEGIN:VCALENDAR");
  expect((await page.request.get(url.replace(/token=.*/, "token=falsch"))).status()).toBe(404);

  // Neuer Link: Der alte stirbt erst nach der Rückfrage
  await go("/fristen");
  await abo.getByRole("button", { name: "Neuen Link erzeugen" }).click();
  const neuerLink = page.getByRole("dialog", { name: "Neuen Abo-Link erzeugen?" });
  await expect(neuerLink).toContainText("sofort ungültig");
  await neuerLink.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await page.request.get(url)).status()).toBe(200);
  await abo.getByRole("button", { name: "Neuen Link erzeugen" }).click();
  await bestaetigen(page, "Neuen Link erzeugen");
  const zweiterLink = await abo.getByLabel(/Abo-Link/).inputValue();
  expect(zweiterLink).not.toBe(url);
  expect((await page.request.get(url)).status()).toBe(404);

  // Beenden ebenso
  await go("/fristen");
  await abo.getByRole("button", { name: "Abo beenden" }).click();
  const beenden = page.getByRole("dialog", { name: "Kalender-Abo beenden?" });
  await expect(beenden).toContainText("nicht mehr");
  await beenden.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await page.request.get(zweiterLink)).status()).toBe(200);
  await abo.getByRole("button", { name: "Abo beenden" }).click();
  await bestaetigen(page, "Abo beenden");
  await expect(abo.getByRole("button", { name: "Kalender-Abo einrichten" })).toBeVisible();
  expect((await page.request.get(zweiterLink)).status()).toBe(404);
});

test("Keine Einkommensteuer-Vorauszahlungen: das Kästchen nimmt nur deren Hinweise aus den Fristen (#1240)", async () => {
  /** Alle Fristen aufklappen und die Titel der Einkommensteuer-Vorauszahlungen und Voranmeldungen zählen */
  const zaehlen = async () => {
    await go("/fristen");
    for (const knopf of await page.getByRole("button", { name: /^Alle \d+ zeigen$/ }).all()) await knopf.click();
    await expect(page.getByRole("button", { name: /^Alle \d+ zeigen$/ })).toHaveCount(0);
    return {
      vorauszahlungen: await page.getByRole("link", { name: /^Einkommensteuer-Vorauszahlung \d\/\d{4}$/ }).count(),
      voranmeldungen: await page.getByRole("link", { name: /^Umsatzsteuer-Voranmeldung/ }).count(),
    };
  };
  const vorher = await zaehlen();
  expect(vorher.vorauszahlungen).toBeGreaterThan(0);
  expect(vorher.voranmeldungen).toBeGreaterThan(0);

  // Zusammenveranlagung aus „Steuerdaten hinterlegen“: ein Kästchen für beide, der Ehegatte bleibt
  await go("/einstellungen?bereich=persoenlich");
  const taxpayer = page.getByRole("form", { name: "Persönliche Angaben" });
  const kaestchen = taxpayer.getByRole("checkbox", { name: "Keine Einkommensteuer-Vorauszahlungen festgesetzt" });
  await expect(kaestchen).not.toBeChecked();
  await expect(kaestchen).toHaveAccessibleDescription(/nur eine Erinnerung/);
  await kaestchen.check();
  await taxpayer.getByRole("button", { name: "Speichern" }).click();
  await expect(taxpayer.getByRole("status")).toBeVisible();

  await go("/einstellungen?bereich=persoenlich");
  await expect(kaestchen).toBeChecked();
  await expect(taxpayer.getByLabel("Art")).toHaveValue("zusammen");
  await expect(taxpayer.getByRole("group", { name: "Ehegatte (Person B)" }).getByLabel("Vorname")).toHaveValue("Erika");
  expect(await zaehlen()).toEqual({ vorauszahlungen: 0, voranmeldungen: vorher.voranmeldungen });

  // Abgewählt sind die Hinweise wieder da, für die folgenden Tests wie vorher
  await go("/einstellungen?bereich=persoenlich");
  await kaestchen.uncheck();
  await taxpayer.getByRole("button", { name: "Speichern" }).click();
  await expect(taxpayer.getByRole("status")).toBeVisible();
  expect(await zaehlen()).toEqual(vorher);
});

test("Pauschalen: Homeoffice, Fahrt, Verpflegung und Storno", async () => {
  await go("/pauschalen");
  await expect(page.getByRole("heading", { name: /^Pauschalen \d{4}$/, level: 1 })).toBeVisible();
  const neu = page.getByRole("region", { name: "Pauschale eintragen" });

  const homeoffice = neu.getByRole("form", { name: "Homeoffice-Pauschale" });
  await homeoffice.getByLabel("Tage im Homeoffice", { exact: true }).fill("12");
  await homeoffice.getByRole("button", { name: "72,00\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Homeoffice-Pauschale über 72,00\u00a0€ gebucht.");

  await neu.getByRole("button", { name: "Fahrt", exact: true }).click();
  const fahrt = neu.getByRole("form", { name: "Fahrt mit dem Privatfahrzeug" });
  await fahrt.getByLabel("Anlass und Ziel", { exact: true }).fill("Workshop Nordwerk, Karlsruhe");
  await fahrt.getByLabel("Kilometer einfach", { exact: true }).fill("42,5");
  await fahrt.getByRole("button", { name: "25,50\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Fahrt über 25,50\u00a0€ gebucht.");

  await neu.getByRole("button", { name: "Verpflegung", exact: true }).click();
  const verpflegung = neu.getByRole("form", { name: "Verpflegungsmehraufwand" });
  await verpflegung.getByLabel("Anlass und Ort", { exact: true }).fill("Kundenprojekt, München");
  await verpflegung.getByRole("combobox", { name: /^Reisetag/ }).selectOption("ganztag");
  await verpflegung.getByLabel("Frühstück", { exact: true }).check();
  await verpflegung.getByRole("button", { name: "22,40\u00a0€ buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Verpflegungsmehraufwand über 22,40\u00a0€ gebucht.");

  const liste = page.getByRole("region", { name: /^Eingetragen in/ });
  await expect(liste.getByRole("row")).toHaveCount(4);
  const zeile = liste.getByRole("row").filter({ hasText: "Karlsruhe" });
  await zeile.getByRole("button", { name: "Stornieren" }).click();
  // Ein Storno nennt dasselbe wie das, was es zurücknimmt (DESIGN.md, Rückfragen): Anlass, Strecke und Fahrzeug wie in der Liste
  await faktenZeigen(page, "Datum", "Anlass und Ziel", "Angaben", "Betrag");
  await expect(page.getByRole("dialog")).toContainText("Workshop Nordwerk, Karlsruhe");
  await expect(page.getByRole("dialog")).toContainText("85 km (hin und zurück) · Auto");
  await expect(page.getByRole("dialog").locator("dd").first()).toHaveText(/^\d{2}\.\d{2}\.\d{4}$/);
  await bestaetigen(page, "Stornieren");
  await expect(zeile.getByText("Storniert", { exact: true })).toBeVisible();
  await expect(page.getByText("94,40\u00a0€", { exact: true })).toBeVisible();
});

test("Pauschalen: fehlende Angaben stehen nach dem Druck auf Buchen am Feld, gebucht wird nichts", async () => {
  await go("/pauschalen");
  const neu = page.getByRole("region", { name: "Pauschale eintragen" });
  const liste = page.getByRole("region", { name: /^Eingetragen in/ });
  const zeilen = await liste.getByRole("row").count();

  // Vor dem ersten Druck kein Fehler, auch wenn das Feld leer ist
  const homeoffice = neu.getByRole("form", { name: "Homeoffice-Pauschale" });
  const tage = homeoffice.getByLabel("Tage im Homeoffice", { exact: true });
  await expect(tage).not.toHaveAttribute("aria-invalid");
  await homeoffice.getByRole("button", { name: "Buchen" }).click();
  await expect(tage).toBeFocused();
  await expect(tage).toHaveAccessibleDescription("Trag die Tage ein.");
  await tage.fill("0");
  await expect(tage).toHaveAccessibleDescription("Mindestens ein Tag.");

  // Mehrere Fehler: alle am Feld, der Fokus im ersten
  await neu.getByRole("button", { name: "Fahrt", exact: true }).click();
  const fahrt = neu.getByRole("form", { name: "Fahrt mit dem Privatfahrzeug" });
  await fahrt.getByLabel("Datum", { exact: true }).fill(`${YEAR - 1}-12-31`);
  await fahrt.getByRole("button", { name: "Buchen" }).click();
  await expect(fahrt.getByLabel("Datum", { exact: true })).toBeFocused();
  await expect(fahrt.getByLabel("Datum", { exact: true })).toHaveAccessibleDescription(/^Wähle einen Tag vom 01\.01\.\d{4} bis/);
  await expect(fahrt.getByLabel("Anlass und Ziel", { exact: true })).toHaveAccessibleDescription("Trag Anlass und Ziel ein.");
  await expect(fahrt.getByLabel("Kilometer einfach", { exact: true })).toHaveAccessibleDescription("Trag die Kilometer ein.");

  // Mahlzeiten ohne Field: Fehler unter den Kästchen, Fokus aufs erste
  await neu.getByRole("button", { name: "Verpflegung", exact: true }).click();
  const verpflegung = neu.getByRole("form", { name: "Verpflegungsmehraufwand" });
  await verpflegung.getByLabel("Anlass und Ort", { exact: true }).fill("Kundenprojekt, München");
  for (const mahlzeit of ["Frühstück", "Mittagessen", "Abendessen"]) await verpflegung.getByLabel(mahlzeit, { exact: true }).check();
  await verpflegung.getByRole("button", { name: "Buchen" }).click();
  await expect(verpflegung.getByLabel("Frühstück", { exact: true })).toBeFocused();
  await expect(verpflegung.getByLabel("Frühstück", { exact: true })).toHaveAccessibleDescription(
    "Nach Abzug der gestellten Mahlzeiten bleibt keine Pauschale.",
  );

  await expect(neu.getByRole("status")).toHaveCount(0);
  await expect(liste.getByRole("row")).toHaveCount(zeilen);
});

test("Pauschalen: Fahrt übernimmt beim Wechsel des Jahres das Vorgabedatum des neuen Jahres", async () => {
  await go("/pauschalen");
  const neu = page.getByRole("region", { name: "Pauschale eintragen" });
  await neu.getByRole("button", { name: "Fahrt", exact: true }).click();
  const fahrt = neu.getByRole("form", { name: "Fahrt mit dem Privatfahrzeug" });
  await page
    .getByRole("navigation", { name: "Jahr wählen" })
    .getByRole("link", { name: String(YEAR - 1), exact: true })
    .click();
  await expect(page.getByRole("heading", { name: `Pauschalen ${YEAR - 1}`, level: 1 })).toBeVisible();
  await expect(fahrt.getByLabel("Datum", { exact: true })).toHaveValue(`${YEAR - 1}-12-31`);
});

test("Pauschalen: Entfernungspauschale für Wege zur Betriebsstätte und Storno (#895)", async () => {
  await go("/pauschalen");
  const neu = page.getByRole("region", { name: "Pauschale eintragen" });
  await neu.getByRole("button", { name: "Wege zur Betriebsstätte", exact: true }).click();
  const wege = neu.getByRole("form", { name: "Wege zwischen Wohnung und Betriebsstätte" });
  await wege.getByLabel("Tage an der Betriebsstätte", { exact: true }).fill("15");
  // Mit Komma wie bei „Fahrt“: 12,5 km zählen als 12 volle Kilometer, nicht als 125
  await wege.getByLabel("Kilometer einfach", { exact: true }).fill("12,5");
  // Ohne Betriebsstätte bleibt „Buchen“ bedienbar; der Druck schreibt den Fehler ans Feld und setzt den Fokus dorthin (DESIGN.md, Gesperrte Knöpfe)
  const betriebsstaette = wege.getByLabel("Betriebsstätte", { exact: true });
  await wege.getByRole("button", { name: "68,40 € buchen" }).click();
  await expect(betriebsstaette).toBeFocused();
  await expect(betriebsstaette).toHaveAttribute("aria-invalid", "true");
  await expect(betriebsstaette).toHaveAccessibleDescription("Trag die Betriebsstätte ein.");
  await betriebsstaette.fill("Praxis Musterstadt");
  await expect(betriebsstaette).not.toHaveAttribute("aria-invalid");
  // ab 2026 0,38 € je Kilometer: 15 Tage × 12 km
  await wege.getByRole("button", { name: "68,40 € buchen" }).click();
  await expect(neu.getByRole("status")).toHaveText("Entfernungspauschale über 68,40 € gebucht.");

  const liste = page.getByRole("region", { name: /^Eingetragen in/ });
  const zeile = liste.getByRole("row").filter({ hasText: "Praxis Musterstadt" });
  await expect(zeile).toHaveCount(1);
  await zeile.getByRole("button", { name: "Stornieren" }).click();
  // Der Monat mit Jahr, dazu Betriebsstätte, Tage und Kilometer wie bei der Buchung
  await faktenZeigen(page, "Monat", "Betriebsstätte", "Angaben", "Betrag");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Praxis Musterstadt");
  await expect(dialog).toContainText("15 Tage × 12 km einfache Entfernung");
  await expect(dialog.locator("dd").first()).toHaveText(/^[A-ZÄÖÜ][a-zä]+ \d{4}$/);
  await bestaetigen(page, "Stornieren");
  await expect(zeile.getByText("Storniert", { exact: true })).toBeVisible();
});

test("Pauschalen: jeder Reiter ohne axe-Verstöße, hell und dunkel, am Desktop und am Handy", async () => {
  // barrierefreiheit.spec.ts prüft /pauschalen nur mit dem ersten Reiter; die übrigen Formulare erscheinen erst per Klick
  const vorher = page.viewportSize();
  for (const modus of ["hell", "dunkel"]) {
    for (const viewport of [LAPTOP, { width: 320, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
      await go("/pauschalen");
      const neu = page.getByRole("region", { name: "Pauschale eintragen" });
      for (const [reiter, formular] of [
        ["Homeoffice", "Homeoffice-Pauschale"],
        ["Fahrt", "Fahrt mit dem Privatfahrzeug"],
        ["Verpflegung", "Verpflegungsmehraufwand"],
        ["Wege zur Betriebsstätte", "Wege zwischen Wohnung und Betriebsstätte"],
      ] as const) {
        await neu.getByRole("button", { name: reiter, exact: true }).click();
        await expect(neu.getByRole("form", { name: formular })).toBeVisible();
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        expect(
          violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
          `${reiter}, ${modus}, ${viewport.width} px`,
        ).toEqual([]);
      }
    }
  }
  await page.evaluate(() => localStorage.setItem("haben-modus", "hell"));
  if (vorher) await page.setViewportSize(vorher);
});

test("Pauschalen: Homeoffice-Monat über die Monatsauswahl wählen (#928)", async () => {
  await go("/pauschalen");
  const homeoffice = page.getByRole("region", { name: "Pauschale eintragen" }).getByRole("form", { name: "Homeoffice-Pauschale" });
  const monat = homeoffice.getByLabel("Monat", { exact: true });
  await monat.click();
  const dialog = page.getByRole("dialog", { name: "Monat wählen" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Vorheriges Jahr" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Nächstes Jahr" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(monat).toBeFocused();
  await monat.click();
  await dialog.getByRole("button", { name: `Januar ${YEAR}` }).click();
  await expect(dialog).toBeHidden();
  await expect(monat).toContainText(`Januar ${YEAR}`);
});

test("Monatsauswahl: Tab aus dem offenen Raster schließt es, statt das nächste Feld zu verdecken (#928)", async () => {
  await go("/pauschalen");
  const homeoffice = page.getByRole("region", { name: "Pauschale eintragen" }).getByRole("form", { name: "Homeoffice-Pauschale" });
  const monat = homeoffice.getByLabel("Monat", { exact: true });
  const tage = homeoffice.getByLabel("Tage im Homeoffice", { exact: true });
  await monat.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Monat wählen" });
  await expect(dialog).toBeVisible();
  // Durch Jahreswechsel und Monate bis ins nächste Feld
  for (let i = 0; i < 20 && !(await tage.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(tage).toBeFocused();
  await expect(dialog).toBeHidden();
});

test("Monatsauswahl: offenes Raster ohne axe-Verstöße, hell und dunkel, am Desktop und am Handy (#928)", async () => {
  const vorher = page.viewportSize();
  for (const modus of ["hell", "dunkel"]) {
    for (const viewport of [LAPTOP, { width: 320, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate((m) => localStorage.setItem("haben-modus", m), modus);
      await go("/pauschalen");
      const homeoffice = page.getByRole("region", { name: "Pauschale eintragen" }).getByRole("form", { name: "Homeoffice-Pauschale" });
      await homeoffice.getByLabel("Monat", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Monat wählen" });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= viewport.width, `${modus}, ${viewport.width} px im Bild`).toBe(true);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `${modus}, ${viewport.width} px`,
      ).toEqual([]);
      await page.keyboard.press("Escape");
    }
  }
  await page.evaluate(() => localStorage.setItem("haben-modus", "hell"));
  if (vorher) await page.setViewportSize(vorher);
});

test("Jahreserklärung: Summen stehen offen, die Einzelzeilen hinter „Zeilen anzeigen“, auch per Tastatur (#1253)", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const ust = page.getByRole("region", { name: "Umsatzsteuererklärung", exact: true });
  const euer = page.getByRole("region", { name: "Anlage EÜR", exact: true });
  await expect(ust.getByRole("row", { name: /^Umsatzsteuer|^Überschuss/ })).toBeVisible();
  await expect(ust.getByRole("row", { name: /^Abschlusszahlung|^Erstattung/ })).toBeVisible();
  await expect(euer.getByRole("row", { name: /^Summe Betriebseinnahmen/ })).toBeVisible();
  await expect(euer.getByRole("row", { name: /^Gewinn|^Verlust/ })).toBeVisible();
  // Zugeklappt: die Zeilen sind nicht zu sehen, der Knopf zum Aufklappen schon
  await expect(ust.getByRole("row", { name: /^Umsätze zu 19 %/ })).toBeHidden();
  await expect(euer.getByRole("row", { name: /^Entnahmen einschließlich/ })).toBeHidden();
  // Mit der Tastatur: Fokus auf „Zeilen anzeigen“, Enter klappt auf
  const summary = ust.locator("summary").filter({ hasText: "Zeilen anzeigen" });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(ust.getByRole("row", { name: /^Umsätze zu 19 %/ })).toBeVisible();
  await expect(ust.getByRole("row", { name: /^Abziehbare Vorsteuer aus Rechnungen/ })).toBeVisible();
  await euer.locator("summary").filter({ hasText: "Zeilen anzeigen" }).click();
  await expect(euer.getByRole("row", { name: /^Entnahmen einschließlich/ })).toBeVisible();
});

test("Jahreserklärung: der Name der Schalter zum Aufklappen enthält kein Pfeilzeichen (#1253)", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const namen = nodes.filter((n) => n.role?.value === "DisclosureTriangle").map((n) => String(n.name?.value));
  expect(namen.some((n) => n.includes("Zeilen anzeigen"))).toBe(true);
  expect(namen.filter((n) => n.includes("›"))).toEqual([]);
});

test("Jahreserklärung: die Erklärungen stehen in einer nummerierten Reihenfolge, der nächste Schritt führt zum Abschnitt (#1253)", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);
  const reihenfolge = page.getByRole("region", { name: "Reihenfolge der Erklärungen" });
  const eintraege = reihenfolge.getByRole("listitem");
  await expect(eintraege).toHaveCount(3);
  await expect(eintraege.nth(0)).toContainText("Umsatzsteuer");
  await expect(eintraege.nth(1)).toContainText("Anlage EÜR");
  await expect(eintraege.nth(2)).toContainText("Einkommensteuer");
  // Die Sprungleiste ist darin aufgegangen: nur noch die Abschnitte darunter
  await expect(page.getByRole("navigation", { name: "Abschnitte der Jahreserklärung" })).toHaveCount(0);
  await expect(reihenfolge.getByRole("link", { name: "Verlauf" })).toBeVisible();
  // Der nächste Schritt ist die erste Erklärung ohne Übermittlung und ohne Vermerk und verlinkt auf ihren Abschnitt
  const schritt = reihenfolge.locator("p", { hasText: "Nächster Schritt:" });
  await expect(schritt).toBeVisible();
  const ziel = await schritt.getByRole("link").getAttribute("href");
  expect(ziel).toMatch(/^#(ust|euer|est)$/);
  await schritt.getByRole("link").click();
  await expect(page.locator(ziel!)).toBeInViewport();
});

test("Abgabe vermerken bei niedrigem Fenster: Tab hält jedes Feld über der Knopfzeile, der Dialog selbst scrollt nicht (WCAG 2.4.11)", async () => {
  const jahr = YEAR - 1;
  for (const [breite, hoehe] of [
    [1280, 420],
    [375, 600],
  ] as const) {
    await page.setViewportSize({ width: breite, height: hoehe });
    await go(`/jahreserklaerung/${jahr}`);
    const karte = page.getByRole("region", { name: `Abgabe außerhalb von Haben: Anlage EÜR ${jahr}`, exact: true });
    await karte.getByRole("button", { name: "Abgabe vermerken", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Anlage EÜR ${jahr} als abgegeben vermerken` });
    // Das Datumsfeld hat drei Tab-Stopps (Tag, Monat, Jahr); der Lauf beginnt beim Ticket
    await dialog.getByLabel("Transferticket", { exact: true }).focus();
    for (const name of ["Betrag", "Begründung", "Übermittlungsprotokoll (PDF, optional)"]) {
      await page.keyboard.press("Tab");
      const lage = await dialog.evaluate((d) => {
        const aktiv = document.activeElement as HTMLInputElement;
        // Der FilePicker versteckt sein <input type="file">; zu sehen ist der Knopf daneben
        const sichtbar = (aktiv.closest(".file-picker") ?? aktiv).getBoundingClientRect();
        return {
          label: aktiv.labels?.[0]?.textContent ?? aktiv.tagName,
          unten: sichtbar.bottom,
          knopfzeile: d.querySelector(":scope > form > .actions:last-child")!.getBoundingClientRect().top,
          dialogScroll: d.scrollTop,
        };
      });
      const wo = `${breite}×${hoehe}, ${name}`;
      expect(lage.label, wo).toBe(name);
      expect(lage.unten, `${wo}: hinter der Knopfzeile`).toBeLessThanOrEqual(lage.knopfzeile + 0.5);
      expect(lage.dialogScroll, `${wo}: der Dialog selbst scrollt`).toBe(0);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  // Wie playwright.config.ts (chromium), damit die folgenden Tests im selben Fenster laufen
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("Formular-Dialog bei niedrigem Fenster: Beim Öffnen bleibt das erste Feld oben sichtbar, das Formular scrollt nicht (#880)", async () => {
  const jahr = YEAR - 1;
  await page.setViewportSize({ width: 1280, height: 420 });
  const pruefen = async (dialog: ReturnType<Page["getByRole"]>, erstesFeld: string) => {
    await expect(dialog).toBeVisible();
    // Chrome macht das scrollende Formular selbst fokussierbar, showModal() fokussiert dann das Formular, kein Feld.
    // Zwei Frames abwarten, damit ein Scrollen danach schon passiert ist
    const lage = await dialog.evaluate(async (d, feld) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const form = d.querySelector(":scope > form") as HTMLElement;
      const label = [...d.querySelectorAll("label")].find((l) => l.textContent?.startsWith(feld))!;
      return {
        scrollTop: form.scrollTop,
        feldOben: label.getBoundingClientRect().top,
        formOben: form.getBoundingClientRect().top,
        scrollbar: form.scrollHeight > form.clientHeight,
        fokusAufFeld: label.control !== null && label.control === document.activeElement,
      };
    }, erstesFeld);
    expect(lage.scrollbar, `${erstesFeld}: das Formular muss scrollen, sonst prüft der Test nichts`).toBe(true);
    expect(lage.scrollTop, `${erstesFeld}: das Formular ist beim Öffnen schon gescrollt`).toBe(0);
    expect(lage.feldOben, `${erstesFeld}: liegt über dem oberen Rand`).toBeGreaterThanOrEqual(lage.formOben);
    // Der Fokus steht auf dem ersten Feld, nicht auf dem Formular als Scrollbereich
    expect(lage.fokusAufFeld, `${erstesFeld}: hat beim Öffnen den Fokus`).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  };
  await go(`/jahreserklaerung/${jahr}`);
  await page
    .getByRole("region", { name: `Abgabe außerhalb von Haben: Anlage EÜR ${jahr}`, exact: true })
    .getByRole("button", { name: "Abgabe vermerken", exact: true })
    .click();
  await pruefen(page.getByRole("dialog", { name: `Anlage EÜR ${jahr} als abgegeben vermerken` }), "Tag der Abgabe");
  await go("/dauerbelege/neu");
  await neuenLieferantenOeffnen(page);
  await pruefen(page.getByRole("dialog", { name: "Neuen Lieferanten anlegen" }), "Name oder Firma");
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("Jahreserklärung: Abgabetag im Erklärungsjahr meldet das Feld, nicht erst der Server (Review #975)", async () => {
  const jahr = YEAR - 1;
  await go(`/jahreserklaerung/${jahr}`);
  const karte = page.getByRole("region", { name: `Abgabe außerhalb von Haben: Anlage EÜR ${jahr}`, exact: true });
  await karte.getByRole("button", { name: "Abgabe vermerken", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Anlage EÜR ${jahr} als abgegeben vermerken` });
  // Alles stimmt bis auf den Tag: Er liegt im Erklärungsjahr, der Server nimmt erst ab dem 1. Januar des Folgejahres an (vermerk.ts)
  await dialog.getByLabel("Tag der Abgabe", { exact: true }).fill(`${jahr}-06-30`);
  await dialog.getByLabel("Transferticket", { exact: true }).fill("et9f3k2m7q1x");
  await dialog.getByLabel("Begründung", { exact: true }).fill("Anlage EÜR extern mit WISO abgegeben.");
  const haken = dialog.getByLabel("Abweichung geprüft und bewusst übernommen");
  if (await haken.count()) await haken.check();
  await dialog.getByRole("button", { name: "Vermerken", exact: true }).click();
  await expect(dialog.getByLabel("Tag der Abgabe", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Tag der Abgabe", { exact: true })).toHaveAccessibleDescription(new RegExp(`01\\.01\\.${jahr + 1}`));
  await page.keyboard.press("Escape");
});

test("Jahreserklärung: im laufenden Jahr gibt es keinen Abgabetag, die Karte sagt warum statt eines Knopfs (Review #975, Runde 2)", async () => {
  // Das Kalenderjahr, nicht YEAR: das rechnet in den ersten Wochen des Jahres im Vorjahr (daten.ts)
  const jahr = currentYear();
  await go(`/jahreserklaerung/${jahr}`);
  const karte = page.getByRole("region", { name: `Abgabe außerhalb von Haben: Anlage EÜR ${jahr}`, exact: true });
  await expect(karte).toContainText(`Vermerken geht erst nach Ablauf des Jahres ${jahr}`);
  await expect(karte.getByRole("button", { name: "Abgabe vermerken", exact: true })).toHaveCount(0);
});

test("Jahreserklärung: Abgabe außerhalb von Haben vermerken, mit Protokoll und ohne zweiten Vermerk", async () => {
  const jahr = YEAR - 1;
  await go(`/jahreserklaerung/${jahr}`);
  const ust = page.getByRole("region", { name: "Umsatzsteuererklärung", exact: true });
  // Die Karte traegt Formular und Jahr im Namen, weil sie auf der Seite zweimal vorkommt (USt und EÜR)
  const karte = ust.getByRole("region", { name: `Abgabe außerhalb von Haben: Umsatzsteuererklärung ${jahr}`, exact: true });
  const uebermitteln = ust.getByRole("form", { name: "Umsatzsteuererklärung übermitteln", exact: true });
  await expect(uebermitteln).toBeVisible();
  await karte.getByRole("button", { name: "Abgabe vermerken", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: `Umsatzsteuererklärung ${jahr} als abgegeben vermerken` });
  await randImDialog(dialog, [dialog.getByLabel("Transferticket", { exact: true }), dialog.getByRole("button", { name: "Vermerken", exact: true })]);
  // Leer abgeschickt: Fehler am Transferticket, der Fokus dort, der Dialog bleibt offen (DESIGN.md, Gesperrte Knöpfe)
  await dialog.getByRole("button", { name: "Vermerken", exact: true }).click();
  await expect(dialog.getByLabel("Transferticket", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("Transferticket", { exact: true })).toHaveAccessibleDescription(/Trag das Transferticket aus dem Übermittlungsprotokoll ein/);
  await expect(dialog.getByLabel("Begründung", { exact: true })).toHaveAccessibleDescription(/Trag eine Begründung mit mindestens 10 Zeichen ein\./);
  // Der Abgabetag liegt im Folgejahr: eine Jahreserklärung kann nicht vor dem Jahresende abgegeben werden
  await dialog.getByLabel("Tag der Abgabe", { exact: true }).fill(`${jahr + 1}-01-02`);
  await dialog.getByLabel("Transferticket", { exact: true }).fill("et9f3k2m7q1x");
  await dialog.getByLabel("Betrag", { exact: true }).fill("0,00");
  await dialog.getByLabel("Begründung", { exact: true }).fill("Umsatzsteuererklärung extern mit WISO abgegeben.");
  const protokollFeld = dialog.locator(".field", { has: page.getByText("Übermittlungsprotokoll (PDF, optional)", { exact: true }) });
  const protokollDialog = await filePickerPruefen(page, protokollFeld, "Übermittlungsprotokoll");
  await protokollDialog.setFiles({
    name: "Uebermittlungsprotokoll.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% Übermittlungsprotokoll\n%%EOF\n"),
  });
  // Weicht der Betrag vom gerechneten Wert ab, verlangt der Dialog eine ausdrueckliche Bestaetigung
  const haken = dialog.getByLabel("Abweichung geprüft und bewusst übernommen");
  if (await haken.count()) await haken.check();
  await dialog.getByRole("button", { name: "Vermerken", exact: true }).click();

  // Danach gilt die Erklärung als abgegeben; der Kopf nennt Tag, Betrag und Ticket, ein zweiter Vermerk fehlt (#871)
  await expect(ust.getByText(`Außerhalb abgegeben am 02.01.${jahr + 1}`)).toBeVisible();
  await expect(karte.locator("p", { hasText: `Abgegeben am 02.01.${jahr + 1}` })).toBeVisible();
  await expect(karte).toContainText("Ein zweiter Vermerk ist nicht möglich.");
  await expect(karte.getByRole("button", { name: "Abgabe vermerken" })).toHaveCount(0);
  // Neben der Vermerk-Karte steht kein ausgegrauter Kasten zum Übermitteln mehr (#1080)
  await expect(uebermitteln).toHaveCount(0);
  // Begründung und Protokoll stehen zugeklappt darunter: verdeckt heißt nicht sichtbar, also erst zugeklappt
  // prüfen, dann aufklappen und Begründung wie Protokollverweis sichtbar nachsehen
  const begruendung = karte.getByText("Umsatzsteuererklärung extern mit WISO abgegeben.");
  await expect(begruendung).toBeHidden();
  await expect(karte.locator("details[open]")).toHaveCount(0);
  await karte.locator("summary").click();
  await expect(karte.locator("details[open]")).toHaveCount(1);
  await expect(begruendung).toBeVisible();
  const protokollLink = karte.getByRole("link", { name: /Übermittlungsprotokoll/ });
  await expect(protokollLink).toBeVisible();
  const protokoll = await page.request.get((await protokollLink.getAttribute("href"))!);
  expect(protokoll.headers()["content-type"]).toContain("application/pdf");

  // Auch nach dem Neuladen bleibt der Vermerk stehen
  await go(`/jahreserklaerung/${jahr}`);
  await expect(page.getByRole("region", { name: "Umsatzsteuererklärung", exact: true }).getByText(`Außerhalb abgegeben am 02.01.${jahr + 1}`)).toBeVisible();
});

test("Jahreserklärung: Einkommensteuererklärung außerhalb von Haben vermerken, ohne Betrag (#1073)", async () => {
  const jahr = YEAR - 1;
  await go(`/jahreserklaerung/${jahr}`);
  const est = page.getByRole("region", { name: `Einkommensteuererklärung ${jahr}`, exact: true });
  const karte = est.getByRole("region", { name: `Abgabe außerhalb von Haben: Einkommensteuererklärung ${jahr}`, exact: true });
  await karte.getByRole("button", { name: "Abgabe vermerken", exact: true }).click();

  // Das Übermittlungsprotokoll der Einkommensteuer nennt keinen Steuerbetrag: kein Feld dafür, auch keine Schätzung
  const dialog = page.getByRole("dialog", { name: `Einkommensteuererklärung ${jahr} als abgegeben vermerken` });
  await expect(dialog.getByLabel("Tag der Abgabe", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Betrag", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Tag der Abgabe", { exact: true }).fill(`${jahr + 1}-09-29`);
  await dialog.getByLabel("Transferticket", { exact: true }).fill("es7k2m9q4x1p");
  await dialog.getByLabel("Begründung", { exact: true }).fill("Einkommensteuererklärung extern mit WISO abgegeben.");
  await dialog.getByRole("button", { name: "Vermerken", exact: true }).click();

  await expect(karte.locator("p", { hasText: `Abgegeben am 29.09.${jahr + 1}` })).toContainText("Betrag nicht vermerkt");
  await expect(est).toContainText("Das Ergebnis steht erst mit dem Steuerbescheid fest");
});

test("Jahreserklärung: Speichern sperrt die Einkommensteuer-Maske wieder (#1098)", async () => {
  const jahr = YEAR - 1;
  await go(`/jahreserklaerung/${jahr}`);
  const form = page.getByRole("form", { name: "Angaben zur Einkommensteuer" });

  // Vermerkt ist die Maske zu. Ohne Vermerk gäbe es nichts zu sperren, deshalb legt der Test ihn hier an.
  const karte = page.getByRole("region", { name: `Abgabe außerhalb von Haben: Einkommensteuererklärung ${jahr}` });
  const vermerken = karte.getByRole("button", { name: "Abgabe vermerken" });
  if (await vermerken.isVisible().catch(() => false)) {
    await vermerken.click();
    const dialog = page.getByRole("dialog", { name: `Einkommensteuererklärung ${jahr} als abgegeben vermerken` });
    await dialog.getByLabel("Tag der Abgabe").fill(`${jahr + 1}-01-05`);
    await dialog.getByLabel("Transferticket").fill("et9f3k2m7q1xb");
    await dialog.getByLabel("Begründung").fill("Einkommensteuererklärung außerhalb von Haben mit WISO abgegeben.");
    // Der ESt-Vermerk trägt keinen Betrag (#1073): den gibt es erst mit dem Bescheid, deshalb steht im Dialog kein Feld
    await expect(dialog.getByLabel("Betrag")).toHaveCount(0);
    const haken = dialog.getByLabel("Abweichung geprüft und bewusst übernommen");
    if (await haken.count()) await haken.check();
    await dialog.getByRole("button", { name: "Vermerken" }).click();
  }

  // Nur die Felder der Maske: die Aufstellung der erklärten Zeilen steht mit einem Vermerk davor und hat eigene,
  // immer bedienbare Eingaben (#1149)
  const feld = form.locator("fieldset input").first();
  const bearbeiten = form.getByRole("button", { name: "Angaben bearbeiten" });
  // Sperren kann die Maske nur, was vermerkt ist; den Vermerk legt der Test oben selbst an. Kein Selbst-Überspringen:
  // Fehlt der Vermerk oder die Karte dazu, ist das ein echter Fehler und der Lauf gehört rot (#1098).
  await expect(bearbeiten).toBeVisible();
  await expect(feld).toBeDisabled();

  // Mit Vermerk und noch keiner gespeicherten Zeile muss die Eingabe offen stehen, sonst ließen sich die Anlagen
  // der Einkommensteuer nie erfassen (#1149)
  await expect(form.getByText("Zeilenwerte aus dem Übermittlungsprotokoll")).toBeVisible();
  await expect(form.getByText("noch nicht erfasst")).toBeVisible();

  // Die Aufstellung bringt kein eigenes <form> mit. Ein <form> im <form> ist nach HTML ungültig: der Browser wirft
  // das innere Start-Tag weg, sein </form> schließt das äußere, und fieldset, Hinweis und der Fuß mit „Angaben
  // speichern" lägen außerhalb (#1084). Geprüft wird das ausgelieferte HTML, so wie der Browser es liest — nicht der
  // nach der Hydration zusammengesetzte Baum, in dem ein verschachteltes Formular stehen bliebe.
  const ausgeliefert = await (await page.request.get(page.url())).text();
  const formular = await page.evaluate((html) => {
    const geparst = new DOMParser().parseFromString(html, "text/html");
    return { forms: geparst.querySelectorAll("form").length, verschachtelt: geparst.querySelectorAll("form form").length };
  }, ausgeliefert);
  expect(formular.forms).toBeGreaterThan(0);
  expect(formular.verschachtelt).toBe(0);

  // Aufgeschlossen wird nur gelesen, bis jemand speichert. Der Klick geht als Zeigerklick dorthin, wo der Mensch
  // klickt: „Angaben bearbeiten“ steht rechts im Fuß, „Angaben speichern“ links. Stünden beide an derselben Stelle,
  // träfe das Loslassen schon den Absende-Knopf, und die leere Maske speicherte und sperrte sich selbst (#1098, #1141).
  await bearbeiten.scrollIntoViewIfNeeded();
  const kasten = await bearbeiten.boundingBox();
  if (!kasten) throw new Error("„Angaben bearbeiten“ hat keine Fläche");
  await page.mouse.move(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(form.getByRole("button", { name: "Angaben speichern" })).toBeVisible();
  await expect(feld).toBeEnabled();
  // Der Fehlklick speichert nichts: der Hinweis kommt erst mit dem Speichern weiter unten
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toHaveCount(0);

  await form.getByRole("button", { name: "Angaben speichern" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Angaben gespeichert." })).toBeVisible();
  // Nach dem Speichern wieder zu: kein Dauerbearbeiten, der Knopf heißt wieder „Angaben bearbeiten"
  await expect(bearbeiten).toBeVisible();
  await expect(feld).toBeDisabled();
});

test("Zeilenwerte aus dem Übermittlungsprotokoll ersetzen Habens Rechnung (#997)", async () => {
  await go(`/jahreserklaerung/${YEAR - 1}`);

  // Der Durchlauf hat die Anlage EÜR weiter oben schon vermerkt; ohne Vermerk gäbe es keine Erklärung, zu
  // der Zeilen gehören können. Falls nicht, hier anlegen.
  const karte = page.getByRole("region", { name: `Abgabe außerhalb von Haben: Anlage EÜR ${YEAR - 1}` });
  const vermerken = karte.getByRole("button", { name: "Abgabe vermerken" });
  if (await vermerken.isVisible().catch(() => false)) {
    await vermerken.click();
    const dialog = page.getByRole("dialog", { name: `Anlage EÜR ${YEAR - 1} als abgegeben vermerken` });
    await dialog.getByLabel("Transferticket").fill("ABC123456789");
    await dialog.getByLabel("Begründung").fill("Anlage EÜR außerhalb von Haben mit WISO abgegeben.");
    // Der Betrag bleibt der aus den Buchungen gerechnete, damit keine Abweichung bestätigt werden muss
    await dialog.getByRole("button", { name: "Vermerken" }).click();
  }

  // Die Maske der Anlage EÜR, nicht die der Umsatzsteuer: nur dort steht die Gewinnzeile
  const erfassen = page
    .locator("details", { hasText: "Zeilenwerte aus dem Übermittlungsprotokoll" })
    .filter({ has: page.getByLabel("Steuerpflichtiger Gewinn / Verlust (gewinn)") })
    .last();
  await expect(erfassen).toBeVisible({ timeout: 15_000 });
  await erfassen.locator("summary").first().click();
  await erfassen.getByLabel("Steuerpflichtiger Gewinn / Verlust (gewinn)").fill("1.234,56");
  // Ein nicht lesbarer Wert: Meldung am Feld, Fokus dort, nichts gespeichert, die Eingaben bleiben (#1270)
  const ausgaben = erfassen.getByLabel("Summe der Betriebsausgaben (ausgaben)");
  await ausgaben.fill("12€50");
  await erfassen.getByRole("button", { name: "Zeilenwerte speichern" }).click();
  await expect(erfassen.getByText("Trag den Betrag der Zeile ein, etwa 1.234,56, oder lass das Feld leer.")).toBeVisible();
  await expect(ausgaben).toBeFocused();
  await expect(erfassen.getByLabel("Steuerpflichtiger Gewinn / Verlust (gewinn)")).toHaveValue("1.234,56");
  await expect(page.getByText("Diese Zahlen stammen aus dem Übermittlungsprotokoll", { exact: false })).toHaveCount(0);
  await ausgaben.fill("");
  await erfassen.getByRole("button", { name: "Zeilenwerte speichern" }).click();

  // Die erklärten Werte ersetzen Habens Rechnung und nennen ihre Herkunft
  await expect(page.getByText("Diese Zahlen stammen aus dem Übermittlungsprotokoll", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("1.234,56\u00a0€").first()).toBeVisible();

  // Habens Rechnung bleibt stehen, und die Maske nimmt die noch fehlenden Zeilen auf (Review zu #997).
  // Vorher verschwand beides, sobald eine Zeile gespeichert war.
  await expect(page.getByText("Habens Rechnung aus den Buchungen", { exact: false }).first()).toBeVisible();
  const nachtragen = page.locator("details", { hasText: "Zeilenwerte aus dem Übermittlungsprotokoll" }).filter({ hasText: "Zeilen offen" }).first();
  await expect(nachtragen).toBeVisible();
  await nachtragen.locator("summary").first().click();
  await expect(nachtragen.getByLabel("Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben (vereinnahmteUst)")).toBeVisible();
});

test("Seiten mit den Daten dieses Abschnitts ohne axe-Verstöße", async () => {
  await ohneAxeVerstoesse(page, ["/pauschalen", "/finanzamt", "/fristen", "/einstellungen?bereich=elster"]);
  // Mit hinterlegtem Zertifikat; barrierefreiheit.spec.ts sieht die Seite ohne
  await kontrasteInThemes(page, ["/einstellungen?bereich=elster"]);
});

test("Keine Fehler im Browser", async () => {
  expect(pageErrors).toEqual([]);
});
