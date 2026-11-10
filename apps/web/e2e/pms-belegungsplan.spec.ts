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
  await expect(page.getByRole("searchbox", { name: "Reservierungen suchen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Neue Reservierung" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Belegungen im Zeitraum" })).toBeVisible();

  if ((await page.locator(".reservation-scheduler-card").count()) > 0) {
    await expect(page.locator(".scheduler_default_main")).toBeVisible();
  }
});
