import { expect, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

test.use({ storageState: SESSION });

test("Zimmer anlegen, bearbeiten, archivieren und wiederherstellen", async ({ page }) => {
  await page.goto("/pms/zimmer");
  await expect(page.getByRole("heading", { level: 1, name: "Zimmer" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Zimmer" })).toBeVisible();

  await page.getByRole("button", { name: "Neues Zimmer" }).click();
  const createForm = page.getByRole("form", { name: "Neues Zimmer" });
  await createForm.getByLabel("Zimmernummer").fill("TDD-101");
  await createForm.getByLabel("Bezeichnung (optional)").fill("Doppelzimmer Hofseite");
  await createForm.getByLabel("Kapazität").fill("2");
  await createForm.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Zimmer angelegt.")).toBeVisible();

  const row = page.locator(".room-cols", { hasText: "TDD-101" });
  await expect(row).toContainText("Doppelzimmer Hofseite");
  await expect(row).toContainText("2");
  await row.getByRole("button", { name: "Zimmer TDD-101 bearbeiten" }).click();
  const editForm = page.getByRole("form", { name: "Zimmer bearbeiten" });
  await editForm.getByLabel("Bezeichnung (optional)").fill("Doppelzimmer Garten");
  await editForm.getByLabel("Kapazität").fill("3");
  await editForm.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Zimmer gespeichert.")).toBeVisible();
  await expect(row).toContainText("Doppelzimmer Garten");

  await row.getByRole("button", { name: "Archivieren" }).click();
  await expect(page.getByText("Zimmer archiviert.")).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /Archiviert \(1\)/ }).click();
  const archivedRow = page.locator(".room-cols", { hasText: "TDD-101" });
  await archivedRow.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(page.getByText("Zimmer wiederhergestellt.")).toBeVisible();
});
