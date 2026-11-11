import { expect, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

test.use({ storageState: SESSION });

test("Belegungsplan lädt DayPilot und bietet die barrierefreie Alternative", async ({ page }) => {
  await page.goto("/pms/belegungsplan");
  await expect(page.getByRole("heading", { level: 1, name: "Belegungsplan" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Belegungsplan" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Reservierungen" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Zimmer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Reservierung" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Zimmer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hotelstatistik" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Reservierungen suchen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Neue Reservierung" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Belegungen im Zeitraum" })).toBeVisible();

  if ((await page.locator(".reservation-scheduler-card").count()) > 0) {
    await expect(page.locator(".scheduler_default_main")).toBeVisible();
  }
});

test("Standardartikel wird für neue Reservierungspositionen vorausgewählt", async ({ page }) => {
  await page.goto("/pms/belegungsplan");
  await page.getByLabel("PMS-Aktionen").getByRole("button", { name: "Einstellungen" }).click();

  const settings = page.getByRole("dialog", { name: "PMS-Einstellungen" });
  const articleOption = settings.getByLabel("Standardartikel").locator("option", { hasText: "B-01" });
  await settings.getByLabel("Standardartikel").selectOption((await articleOption.getAttribute("value"))!);
  await settings.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toContainText("PMS-Einstellungen gespeichert");

  await page.getByLabel("PMS-Aktionen").getByRole("button", { name: "+ Reservierung" }).click();
  await expect(page.getByLabel("Artikel Position 1")).toHaveValue("Beratung Softwarearchitektur");
  await expect(page.getByLabel("Preis Position 1 in Euro")).toHaveValue("110,00");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await expect(page.getByLabel("Artikel Position 2")).toHaveValue("Beratung Softwarearchitektur");
  await expect(page.getByLabel("Preis Position 2 in Euro")).toHaveValue("110,00");
});

test("Hotelstatistik öffnet die Gesamtsicht im Belegungsplan", async ({ page }) => {
  await page.goto("/pms/belegungsplan");
  await page.getByRole("button", { name: "Hotelstatistik" }).click();

  await expect(page.getByRole("heading", { name: "Hotelstatistik" })).toBeVisible();
  await expect(page.getByLabel("Zeitraum")).toHaveValue("current-year");
  await expect(page.getByText("Hotelumsatz")).toBeVisible();
  await expect(page.getByText("Zimmernächte")).toBeVisible();
});
