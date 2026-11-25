import { expect, test } from "@playwright/test";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { einrichten, gehe } from "./einrichtung.ts";

/**
 * Vorschläge der Bankliste gemeinsam bestätigen (#1440): Markieren mit Klick und Leertaste, Bestätigen bucht alle
 * markierten Umsätze auf einmal; Umsätze ohne Vorschlag haben kein Markierfeld. Dazu der Fortschritt über der Liste
 * (#1253): Zahl der offenen Umsätze, „Nächsten offenen“ und nach dem letzten Umsatz der nächste Schritt.
 */

const DURCHLAUF = "bank-bestaetigen";
const ACTOR = "system:bank-bestaetigen-e2e";
const ZEILEN: [string, string, string, string][] = [
  ["13.10.26", "Erika Beispiel", "Reparatur eins", "119,00"],
  ["14.10.26", "Erika Beispiel", "Reparatur zwei", "119,00"],
  ["15.10.26", "Erika Beispiel", "Reparatur drei", "119,00"],
  ["15.10.26", "Erika Beispiel", "Reparatur vier", "119,00"],
  ["16.10.26", "Unbekannt AG", "Etwas anderes", "42,00"],
];

function dkbCsv(rows: typeof ZEILEN) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [date, date, "Gebucht", name, "Mustermann IT", purpose, "Eingang", "", amount, "", "", ""].map((c) => `"${c}"`).join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

/** Fünf Eingänge; die ersten beiden von Erika Beispiel sind von Hand auf „Erlöse 19 %“ gebucht, daraus lernt Haben den Vorschlag für die nächsten beiden */
async function umsaetzeAnlegen() {
  const url = databaseUrlFuer(DURCHLAUF);
  if (!new URL(url).pathname.endsWith("bank_bestaetigen_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_URL: `http://localhost:${portFuer(DURCHLAUF)}`,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  const bank = await import("../src/server/modules/bank/index.ts");
  await bank.importStatement(ACTOR, dkbCsv(ZEILEN), null);
  for (const purpose of ["Reparatur eins", "Reparatur zwei"]) await erloeseBuchen(purpose, 119_00);
}

/** Bucht den Umsatz mit diesem Verwendungszweck von Hand auf „Erlöse 19 %“; die Datenbank bleibt offen bis zum Ende der Datei */
async function erloeseBuchen(purpose: string, amount: number) {
  const { db, schema } = await import("../src/server/db/index.ts");
  const bank = await import("../src/server/modules/bank/index.ts");
  const rows = await db.select({ id: schema.bankTransactions.id, purpose: schema.bankTransactions.purpose }).from(schema.bankTransactions);
  const id = rows.find((r) => r.purpose === purpose)?.id;
  if (!id) throw new Error(`Umsatz fehlt: ${purpose}`);
  await bank.allocate(ACTOR, { kind: "kategorie", transactionId: id, amount, kategorie: { kategorie: "erloese", steuersatz: 1900 } });
}

test.afterAll(async () => {
  const { closeDatabase } = await import("../src/server/db/index.ts");
  await closeDatabase();
});

test("Vorschläge markieren (Klick, Leertaste) und gemeinsam bestätigen", async ({ page }) => {
  await einrichten(page);
  await umsaetzeAnlegen();

  // Fortschritt (#1253): drei Umsätze offen; „Nächsten offenen“ springt vom gewählten zum folgenden
  await gehe(page, "/bank");
  await expect(page.getByText("3 Umsätze noch offen")).toBeVisible();
  await expect(page.locator(".tx-row.selected")).toContainText("Etwas anderes");
  await page.getByRole("link", { name: "Nächsten offenen" }).click();
  await expect(page.locator(".tx-row.selected")).toContainText("Reparatur vier");
  await expect(page.locator(".tx-row.selected")).toBeFocused();

  // Suche mit nur einem Treffer im Filter „Offen“: Der Zähler gilt für alle, also führt der Knopf zurück zu allen offenen
  await gehe(page, "/bank?suche=Unbekannt");
  await expect(page.getByText("3 Umsätze noch offen")).toBeVisible();
  await page.getByRole("link", { name: "Nächsten offenen" }).click();
  await expect(page).not.toHaveURL(/suche=/);
  // Das Suchfeld ist mit geleert, sonst setzte es die Suche kurz darauf wieder ein
  await expect(page.getByLabel("Umsätze durchsuchen")).toHaveValue("");
  await expect(page.locator(".tx-wrap")).toHaveCount(3);

  await gehe(page, "/bank?filter=alle");

  const zeile = (zweck: string) => page.locator(".tx-wrap").filter({ hasText: zweck });
  const markierfeld = (zweck: string) => zeile(zweck).getByRole("checkbox");

  // Vorschlag mit Markierfeld nur dort, wo er ohne Rückfrage buchbar ist
  await expect(zeile("Reparatur drei")).toContainText("Vorschlag: Erlöse 19 %");
  await expect(zeile("Reparatur vier")).toContainText("Vorschlag: Erlöse 19 %");
  await expect(zeile("Etwas anderes")).not.toContainText("Vorschlag:");
  await expect(markierfeld("Etwas anderes")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Markierte bestätigen" })).toBeDisabled();

  // Ein Umsatz mit Klick, der andere mit der Leertaste auf der Zeile
  await markierfeld("Reparatur drei").check();
  await zeile("Reparatur vier").getByRole("link").focus();
  await page.keyboard.press("Space");
  await expect(markierfeld("Reparatur vier")).toBeChecked();
  await expect(page.getByRole("button", { name: "2 bestätigen" })).toBeEnabled();

  // Gebucht wird erst mit dem Klick auf „bestätigen“
  await expect(zeile("Reparatur drei")).not.toContainText("Zugeordnet");
  await page.getByRole("button", { name: "2 bestätigen" }).click();
  await expect(page.getByText("2 Umsätze bestätigt und gebucht.")).toBeVisible();
  await expect(zeile("Reparatur drei")).toContainText("Zugeordnet");
  await expect(zeile("Reparatur vier")).toContainText("Zugeordnet");
  await expect(zeile("Etwas anderes")).not.toContainText("Zugeordnet");
  await expect(page.getByRole("button", { name: /bestätigen/ })).toHaveCount(0);

  // Ohne Markierfeld bleiben die Trennlinien zwischen den Zeilen (sie liegen sonst am Umschlag der Zeile)
  const linien = await page
    .locator(".tx-wrap")
    .evaluateAll((wraps) =>
      wraps.map(
        (w) =>
          Number.parseFloat(getComputedStyle(w).borderTopWidth) + Number.parseFloat(getComputedStyle(w.querySelector(".tx-row") as Element).borderTopWidth),
      ),
    );
  expect(linien.length).toBeGreaterThan(0);
  expect(linien.every((breite) => breite === 1)).toBe(true);

  // Ein Umsatz bleibt offen: Der gewählte ist der einzige, also gibt es keinen „nächsten“
  await gehe(page, "/bank");
  await expect(page.getByText("1 Umsatz noch offen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Nächsten offenen" })).toHaveCount(0);

  // Alles zugeordnet: kein Zähler mehr, dafür der nächste Schritt
  await erloeseBuchen("Etwas anderes", 42_00);
  await gehe(page, "/bank");
  await expect(page.getByText("Alles zugeordnet.")).toBeVisible();
  await expect(page.getByText("noch offen")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Nächsten offenen" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Belege prüfen" })).toHaveAttribute("href", "/belege?status=pruefen");
  await expect(page.getByRole("link", { name: "Voranmeldung prüfen" })).toHaveAttribute("href", "/umsatzsteuer");
});
