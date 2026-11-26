import { createServer, type Server } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, STRIPE_PORT } from "./durchlaeufe.ts";
import { axeVerstoesse, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/**
 * Stripe (#1280, #1729) in eigener, leerer Datenbank (Projekt „stripe-abruf“, e2e/durchlaeufe.ts): Schlüssel des Testmodus
 * abgelehnt, Live-Schlüssel als Verbindung gespeichert, Balance Transactions abgerufen und als Umsätze im Konto des
 * Zahlungsdienstleisters, Verbindung entfernt. Nur der Server dieses Durchlaufs fragt die nachgebaute API unten
 * (STRIPE_API_URL in playwright.config.ts): eine Zahlung mit Gebühr und eine Auszahlung.
 */

test.describe.configure({ mode: "serial" });

const KONTO = "acct_1E2eBeispiel";
const SCHLUESSEL = ["rk", "live", "e2eBeispielSchluessel4711"].join("_"); // zusammengesetzt, damit GitHubs Geheimnis-Scanner ihn nicht für echt hält

let page: Page;
let pageErrors: string[] = [];
let stripe: Server;
/** Was Haben an die nachgebaute API geschickt hat: Methode, Pfad mit Abfrage und der Schlüssel aus dem Kopf */
const anfragen: { pfad: string; schluessel: string }[] = [];

function bewegungen() {
  const jetzt = Math.floor(Date.now() / 1000) - 60;
  return [
    {
      id: "txn_e2eZahlung",
      object: "balance_transaction",
      amount: 11900,
      created: jetzt,
      currency: "eur",
      description: "Rechnung 2026-101",
      fee: 400,
      net: 11500,
      reporting_category: "charge",
      source: { id: "ch_e2eZahlung", object: "charge", billing_details: { name: "Studio Süd", email: null }, description: "Rechnung 2026-101" },
      status: "available",
      type: "charge",
    },
    {
      id: "txn_e2eAuszahlung",
      object: "balance_transaction",
      amount: -5000,
      created: jetzt,
      currency: "eur",
      description: "STRIPE PAYOUT",
      fee: 0,
      net: -5000,
      reporting_category: "payout",
      source: { id: "po_e2eAuszahlung", object: "payout" },
      status: "pending",
      type: "payout",
    },
  ];
}

/** Nachgebaute Stripe-API: Konto zum Schlüssel und eine Seite Balance Transactions */
async function stripeAttrappe(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    anfragen.push({ pfad: `${request.method} ${url.pathname}${url.search}`, schluessel: request.headers.authorization ?? "" });
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.headers.authorization !== `Bearer ${SCHLUESSEL}`)
      return json(401, { error: { message: "Invalid API Key provided", type: "invalid_request_error" } });
    if (url.pathname === "/v1/account") return json(200, { id: KONTO, object: "account" });
    if (url.pathname === "/v1/balance_transactions") return json(200, { object: "list", data: bewegungen(), has_more: false });
    json(404, { error: { message: "nicht nachgebaut" } });
  });
  await new Promise<void>((resolve) => server.listen(STRIPE_PORT, "127.0.0.1", resolve));
  return server;
}

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  stripe = await stripeAttrappe();
});

test.afterAll(async () => {
  await page.context().close();
  await new Promise((resolve) => stripe?.close(resolve));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const karte = () => page.getByRole("region", { name: "Zahlungsdienstleister", exact: true });
const formular = () => karte().getByRole("form", { name: "Neue Verbindung" });
/** Die Verbindung heißt wie vorgeschlagen nach dem Anbieter */
const verbindung = () => karte().getByRole("region", { name: "Stripe", exact: true });

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Ein Schlüssel des Testmodus wird abgelehnt, ohne Stripe zu fragen", async () => {
  await gehe(page, "/einstellungen?bereich=bank");
  await expect(karte().getByText("Nicht eingerichtet.")).toBeVisible();
  expect(await axeVerstoesse(page), "Einstellungen › Bank mit der Karte der Zahlungsdienstleister").toEqual([]);

  await karte().getByRole("button", { name: "Verbindung hinzufügen" }).click();
  await expect(formular().getByLabel("Anbieter")).toHaveValue("stripe");
  await expect(formular().getByLabel("Name")).toHaveValue("Stripe");
  // Ohne Namen: Fehler am Feld statt Meldung des Browsers, der Fokus steht im Feld (DESIGN.md, Gesperrte Knöpfe)
  await formular().getByLabel("Name").fill("");
  await formular().getByRole("button", { name: "Speichern" }).click();
  await expect(formular().getByText("Gib der Verbindung einen Namen.")).toBeVisible();
  await expect(formular().getByLabel("Name")).toBeFocused();
  await formular().getByLabel("Name").fill("Stripe");
  await formular().getByLabel("API-Schlüssel").fill(["rk", "test", "e2eBeispielSchluessel4711"].join("_"));
  await formular().getByRole("button", { name: "Speichern" }).click();
  await expect(formular().getByRole("alert")).toContainText("Haben ruft nur Live-Umsätze ab; bitte einen Live-Schlüssel mit Leserechten eintragen.");
  await expect(verbindung()).toHaveCount(0);
  expect(anfragen).toEqual([]);
});

test("Live-Schlüssel speichern: Stripe nennt das Konto, der Schlüssel liegt nur verschlüsselt in der Datenbank", async () => {
  await formular().getByLabel("API-Schlüssel").fill(SCHLUESSEL);
  await formular().getByRole("button", { name: "Speichern" }).click();

  await expect(karte().getByText("Verbindung gespeichert.")).toBeVisible();
  await expect(verbindung().getByText(`Stripe: verbunden mit ${KONTO} (Schlüssel …4711).`)).toBeVisible();
  await expect(verbindung().getByText(/Noch kein Abruf\./)).toBeVisible();
  await verbindung().getByRole("button", { name: "Bearbeiten" }).click();
  await expect(verbindung().getByLabel("API-Schlüssel (leer lassen zum Behalten)")).toHaveValue("");
  await verbindung().getByRole("button", { name: "Abbrechen" }).click();
  expect(anfragen.map((a) => a.pfad)).toEqual(["GET /v1/account"]);

  const sql = postgres(databaseUrlFuer("stripe-abruf"), { max: 1, onnotice: () => {} });
  try {
    const [zeile] =
      await sql`select provider, name, account_id, key_hint, position('e2eBeispiel' in encode(ciphertext, 'escape')) as klartext from psp_connections`;
    expect(zeile).toEqual({ provider: "stripe", name: "Stripe", account_id: KONTO, key_hint: "4711", klartext: 0 });
  } finally {
    await sql.end();
  }
});

test("Jetzt abrufen: Zahlung, Gebühr und Auszahlung kommen ins Konto des Zahlungsdienstleisters", async () => {
  const sql = postgres(databaseUrlFuer("stripe-abruf"), { max: 1, onnotice: () => {} });
  try {
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Stripe', 'zahlungsdienstleister', 'stripe', 3)`;
    await gehe(page, "/einstellungen?bereich=bank");
    await verbindung().getByRole("button", { name: "Jetzt abrufen" }).click();
    await expect(verbindung().getByText("Abruf durchgelaufen.")).toBeVisible();
    await expect(verbindung().getByText(/Letzter Abruf: /)).toBeVisible();

    const abruf = anfragen.find((a) => a.pfad.startsWith("GET /v1/balance_transactions"));
    expect(abruf?.pfad).toContain("expand%5B%5D=data.source");
    expect(abruf?.schluessel).toBe(`Bearer ${SCHLUESSEL}`);

    const umsaetze = await sql`select bank_reference, amount, counterparty_name from bank_transactions order by bank_reference`;
    expect(umsaetze.map((u) => [u.bank_reference, Number(u.amount)])).toEqual([
      ["txn_e2eAuszahlung", -5000],
      ["txn_e2eZahlung", 11900],
      ["txn_e2eZahlung-gebuehr", -400],
    ]);
    expect(umsaetze.find((u) => u.bank_reference === "txn_e2eZahlung")?.counterparty_name).toBe("Studio Süd");

    // Ein zweiter Abruf legt nichts doppelt an
    await verbindung().getByRole("button", { name: "Jetzt abrufen" }).click();
    await expect(verbindung().getByText("Abruf durchgelaufen.")).toBeVisible();
    expect(await sql`select count(*)::int as n from bank_transactions`).toEqual([{ n: 3 }]);
  } finally {
    await sql.end();
  }

  await gehe(page, "/bank");
  await expect(page.getByText("Studio Süd").first()).toBeVisible();
});

test("Verbindung entfernen löscht den Schlüssel, die Umsätze bleiben", async () => {
  await gehe(page, "/einstellungen?bereich=bank");
  await verbindung().getByRole("button", { name: "Verbindung entfernen" }).click();
  const dialog = page.getByRole("dialog", { name: "Verbindung Stripe entfernen?" });
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(karte().getByText("Verbindung entfernt. Übernommene Umsätze bleiben im Konto stehen.")).toBeVisible();
  await expect(karte().getByText("Nicht eingerichtet.")).toBeVisible();

  const sql = postgres(databaseUrlFuer("stripe-abruf"), { max: 1, onnotice: () => {} });
  try {
    expect(await sql`select count(*)::int as n from psp_connections`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from bank_transactions`).toEqual([{ n: 3 }]);
  } finally {
    await sql.end();
  }
});
