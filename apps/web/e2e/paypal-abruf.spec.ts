import { createServer, type Server } from "node:http";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { databaseUrlFuer, PAYPAL_PORT } from "./durchlaeufe.ts";
import { durchlaufSeite, einrichten, gehe, kontoVerbinden } from "./einrichtung.ts";

/**
 * PayPal über die Transaction Search (#1512) in eigener, leerer Datenbank (Projekt „paypal-abruf“, e2e/durchlaeufe.ts):
 * über die geführte Einrichtung (#1951) Zugang prüfen, speichern und zum ersten Mal abrufen, erneut abrufen ohne Dubletten,
 * entfernen. Nur der Server dieses Durchlaufs fragt
 * die nachgebaute API unten (PAYPAL_API_URL in playwright.config.ts). Sie kennt nur die Client-ID unten und liefert eine
 * Zahlung mit Gebühr und eine Abbuchung per Hand (T0403).
 */

test.describe.configure({ mode: "serial" });

const CLIENT_ID = "e2e-paypal-app-AB12";
const SECRET = "e2e-paypal-geheimnis";
const KONTO = "BEISPIELHAENDLER1";

let page: Page;
let pageErrors: string[] = [];
let paypal: Server;
/** Was Haben an die nachgebaute API geschickt hat: Methode und Pfad */
const anfragen: string[] = [];

/** Zeitstempel wie in der API, zwei Tage vor jetzt, damit der Tag sicher im Fenster liegt */
const vorZweiTagen = () => `${new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19)}+0000`;

function transaktionen() {
  const zeit = vorZweiTagen();
  return [
    {
      transaction_info: {
        transaction_id: "9XY12345AB678901C",
        transaction_event_code: "T0006",
        transaction_initiation_date: zeit,
        transaction_amount: { currency_code: "EUR", value: "100.00" },
        fee_amount: { currency_code: "EUR", value: "-3.00" },
        transaction_status: "S",
        invoice_id: "RE-2026-117",
      },
      payer_info: { email_address: "erika@example.org", payer_name: { given_name: "Erika", surname: "Beispiel" } },
    },
    {
      transaction_info: {
        transaction_id: "7UT34567CD890124E",
        transaction_event_code: "T0403",
        transaction_initiation_date: zeit,
        transaction_amount: { currency_code: "EUR", value: "-50.00" },
        transaction_status: "S",
      },
    },
  ];
}

/** Nachgebaute API: Anmeldung (nur mit CLIENT_ID und SECRET), Saldo mit Kontokennung, Transaktionen */
async function paypalAttrappe(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    request.resume();
    request.on("end", () => {
      anfragen.push(`${request.method} ${url.pathname}`);
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === "/v1/oauth2/token") {
        const richtig = `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64")}`;
        if (request.headers.authorization !== richtig) return json(401, { error: "invalid_client", error_description: "Client Authentication failed" });
        return json(200, { access_token: "e2e-zugang", token_type: "Bearer", expires_in: 3600 });
      }
      if (request.headers.authorization !== "Bearer e2e-zugang") return json(401, { name: "AUTHENTICATION_FAILURE" });
      if (url.pathname === "/v1/reporting/balances") return json(200, { account_id: KONTO, balances: [] });
      if (url.pathname === "/v1/reporting/transactions") return json(200, { transaction_details: transaktionen(), page: 1, total_pages: 1 });
      json(404, { name: "RESOURCE_NOT_FOUND" });
    });
  });
  await new Promise<void>((resolve) => server.listen(PAYPAL_PORT, "127.0.0.1", resolve));
  return server;
}

test.beforeAll(async ({ browser }) => {
  ({ page, pageErrors } = await durchlaufSeite(browser));
  paypal = await paypalAttrappe();
});

test.afterAll(async () => {
  await page.context().close();
  await new Promise((resolve) => paypal?.close(resolve));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const zugang = () => page.getByRole("form", { name: "Zugang" });
/** Die Verbindung heißt wie vorgeschlagen nach dem Anbieter; ihre Zeile steht auf der Seite Verbindungen (#1951) */
const verbindung = () => page.getByRole("region", { name: "Zahlungsdienstleister", exact: true }).getByRole("row").filter({ hasText: "PayPal" });
const abrufBereich = () => page.getByRole("region", { name: "Automatischer Abruf" });

async function mitDatenbank<T>(arbeit: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrlFuer("paypal-abruf"), { max: 1, onnotice: () => {} });
  try {
    return await arbeit(sql);
  } finally {
    await sql.end();
  }
}

test("Einrichtung", async () => {
  await einrichten(page);
});

test("Falsche Zugangsdaten: PayPal lehnt beim Prüfen ab, nichts wird gespeichert, das Secret steht in keiner Meldung", async () => {
  await gehe(page, "/bank");
  await kontoVerbinden(page, "Zahlungsdienstleister hinzufügen");
  const dialog = page.getByRole("dialog", { name: "Anbieter wählen" });
  await dialog.getByRole("radio", { name: "PayPal" }).check();
  await expect(dialog.getByRole("radio", { name: "PayPal" })).toHaveAccessibleDescription("Client-ID und Secret · 3 Schritte · noch nicht verbunden");
  await dialog.getByRole("button", { name: "Weiter" }).click();
  await page.waitForURL(/\/bank\/verbinden\/paypal$/);
  await expect(zugang().getByLabel("Umgebung")).toHaveValue("false");
  await zugang().getByLabel("Client-ID", { exact: true }).fill(CLIENT_ID);
  await zugang().getByLabel("Secret", { exact: true }).fill("falsches-geheimnis");
  await zugang().getByRole("button", { name: "Zugang prüfen" }).click();

  const meldung = zugang().getByText(/PayPal nimmt die Zugangsdaten nicht an: Anmeldung abgelehnt/);
  await expect(meldung).toBeVisible();
  await expect(meldung).not.toContainText("falsches-geheimnis");
  await expect(zugang().getByRole("button", { name: "Weiter" })).toHaveCount(0);
  expect(await mitDatenbank((sql) => sql`select count(*)::int as n from psp_connections`)).toEqual([{ n: 0 }]);
});

test("Zugang prüfen, speichern und erster Abruf: Zahlung, Gebühr und Abbuchung per Hand kommen ins neue Konto", async () => {
  const abrufAb = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await zugang().getByLabel("Secret", { exact: true }).fill(SECRET);
  await zugang().getByRole("button", { name: "Zugang prüfen" }).click();
  await expect(page.getByRole("status", { name: "Zugang geprüft" })).toContainText(`PayPal-Konto ${KONTO} (Client-ID …AB12).`);
  expect(anfragen).toContain("GET /v1/reporting/balances");
  expect(await mitDatenbank((sql) => sql`select count(*)::int as n from psp_connections`)).toEqual([{ n: 0 }]);
  await zugang().getByRole("button", { name: "Weiter" }).click();

  const einstellungen = page.getByRole("form", { name: "Name und Zeitraum" });
  await expect(einstellungen.getByLabel("Name")).toHaveValue("PayPal");
  await einstellungen.getByLabel("Abruf ab").fill(abrufAb);
  await einstellungen.getByRole("button", { name: "Speichern und abrufen" }).click();
  const ergebnis = page.getByRole("region", { name: "Erster Abruf" });
  await expect(ergebnis.getByText("Fertig", { exact: true })).toBeVisible();
  await expect(ergebnis).toContainText("2 Bewegungen beim Anbieter, 3 neue Umsätze im Konto „PayPal“.");
  expect(anfragen).toContain("GET /v1/reporting/transactions");

  // Client-ID und Secret stehen nicht im Klartext in der Datenbank
  const [zeile] = await mitDatenbank(
    (sql) =>
      sql`select account_id, key_hint, abruf_start::text, position(${SECRET} in encode(ciphertext, 'escape')) as secret, position(${CLIENT_ID} in encode(ciphertext, 'escape')) as client from psp_connections`,
  );
  expect(zeile).toEqual({ account_id: KONTO, key_hint: "AB12", abruf_start: abrufAb, secret: 0, client: 0 });
  // Die Abbuchung per Hand (T0403) ist als Auszahlung eingeordnet: PayPal ist die Gegenseite, nicht leer wie bei einem unbekannten Code
  expect(await umsaetze()).toEqual(ERWARTET);
  await ergebnis.getByRole("link", { name: "Zum Konto" }).click();
  await expect(page.getByRole("navigation", { name: "Konten" }).getByRole("link", { name: /^PayPal/ })).toHaveAttribute("aria-current", "page");
  // „Alle Konten“ mit nur einem Konto (so verlinken Journal und Liquidität einen Umsatz): Haben zeigt das eine Konto, also ist
  // seine Karte gewählt, auch wenn die Adresse „alle“ sagt (#1951)
  await gehe(page, "/bank?konto=alle&filter=alle");
  await expect(page.getByRole("navigation", { name: "Konten" }).getByRole("link", { name: /^PayPal/ })).toHaveAttribute("aria-current", "page");
  await gehe(page, "/bank/verbindungen");
  await expect(verbindung().getByText(`PayPal · ${KONTO}`)).toBeVisible();
});

const umsaetze = () => mitDatenbank((sql) => sql`select amount, counterparty_name from bank_transactions order by amount`);
const ERWARTET = [
  { amount: -5_000, counterparty_name: "PayPal" },
  { amount: -300, counterparty_name: "PayPal" },
  { amount: 10_000, counterparty_name: "Erika Beispiel" },
];

test("Jetzt abrufen an der Verbindung legt nichts doppelt an; Bearbeiten zeigt Client-ID und Secret nicht", async () => {
  await verbindung().getByRole("button", { name: "PayPal jetzt abrufen" }).click();
  await expect(abrufBereich().getByText("PayPal: Abruf durchgelaufen.")).toBeVisible();
  expect(await umsaetze()).toEqual(ERWARTET);
  await verbindung().getByRole("button", { name: "Weitere Aktionen für PayPal" }).click();
  await page.getByRole("menuitem", { name: "Bearbeiten …" }).click();
  const dialog = page.getByRole("dialog", { name: "PayPal bearbeiten" });
  await expect(dialog).toContainText(`PayPal: verbunden mit ${KONTO} (Client-ID …AB12).`);
  await expect(dialog).toContainText(/Letzter Abruf: /);
  await expect(dialog.getByLabel("Secret (leer lassen zum Behalten)")).toHaveValue("");
  await expect(dialog.getByLabel("Client-ID (leer lassen zum Behalten)")).toHaveValue("");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
});

test("Verbindung entfernen löscht Client-ID und Secret, die Umsätze bleiben", async () => {
  await verbindung().getByRole("button", { name: "Weitere Aktionen für PayPal" }).click();
  await page.getByRole("menuitem", { name: "Verbindung entfernen" }).click();
  const dialog = page.getByRole("dialog", { name: "Verbindung PayPal entfernen?" });
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(abrufBereich().getByText("Verbindung entfernt. Übernommene Umsätze bleiben im Konto stehen.")).toBeVisible();
  await expect(verbindung().getByRole("button", { name: "PayPal jetzt abrufen" })).toHaveCount(0);
  expect(await mitDatenbank((sql) => sql`select count(*)::int as n from psp_connections`)).toEqual([{ n: 0 }]);
  expect(await mitDatenbank((sql) => sql`select count(*)::int as n from bank_transactions`)).toEqual([{ n: 3 }]);
});
