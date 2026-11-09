import { expect, test } from "@playwright/test";

test("Tourismusstatistik zeigt Monatswerte und HOTE-Export", async ({ page }) => {
  await page.goto("/pms/tourismusstatistik?year=2027&month=1");
  await expect(page.getByRole("heading", { name: "Tourismusstatistik" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monatswerte" })).toBeVisible();
  await expect(page.getByRole("button", { name: "HOTE-CSV exportieren" })).toBeVisible();
});
