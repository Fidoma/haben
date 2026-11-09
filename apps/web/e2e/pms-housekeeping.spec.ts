import { expect, test } from "@playwright/test";

test("Housekeeping ist über die PMS-Navigation erreichbar", async ({ page }) => {
  await page.goto("/pms/housekeeping");
  await expect(page.getByRole("heading", { name: "Housekeeping" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Zu reinigen/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sauber/ })).toBeVisible();
});
