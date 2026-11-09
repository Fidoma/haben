import { expect, test } from "@playwright/test";
import { day, SESSION } from "./daten.ts";

test.use({ storageState: SESSION });

test("Reservierung anlegen, bearbeiten und dauerhaft stornieren", async ({ page }) => {
  await page.goto("/pms/zimmer");
  await page.getByRole("button", { name: "Neues Zimmer" }).click();
  const roomForm = page.getByRole("form", { name: "Neues Zimmer" });
  await roomForm.getByLabel("Zimmernummer").fill("E2E-R1");
  await roomForm.getByLabel("Bezeichnung (optional)").fill("Gartenseite");
  await roomForm.getByRole("button", { name: "Anlegen" }).click();

  await page.goto("/pms/reservierungen");
  await expect(page.getByRole("heading", { level: 1, name: "Reservierungen" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Reservierungen" })).toBeVisible();
  await page.getByRole("button", { name: "Neue Reservierung" }).click();
  const createForm = page.getByRole("form", { name: "Neue Reservierung" });
  await createForm.getByLabel("Kunde").selectOption({ label: "Nordwerk Software GmbH" });
  await createForm.getByLabel("Zimmer").selectOption({ label: "E2E-R1 · Gartenseite" });
  await createForm.getByLabel("Anreise").fill(day(20));
  await createForm.getByLabel("Abreise").fill(day(22));
  await createForm.getByLabel("Interne Notiz (optional)").fill("Späte Anreise");
  await createForm.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Reservierung angelegt.")).toBeVisible();

  const row = page.locator(".reservation-cols", { hasText: "E2E-R1" });
  await expect(row).toContainText("Nordwerk Software GmbH");
  await expect(row).toContainText("2");
  await row.getByRole("button", { name: /bearbeiten/ }).click();
  const editForm = page.getByRole("form", { name: "Reservierung bearbeiten" });
  await editForm.getByLabel("Abreise").fill(day(23));
  await editForm.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Reservierung gespeichert.")).toBeVisible();
  await expect(row).toContainText("3");

  await row.getByRole("button", { name: /stornieren/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("E2E-R1");
  await dialog.getByRole("button", { name: "Stornieren" }).click();
  await expect(page.getByText("Reservierung storniert.")).toBeVisible();
  await page.getByRole("button", { name: /Storniert \(1\)/ }).click();
  await expect(page.locator(".reservation-cols", { hasText: "E2E-R1" })).toContainText("Storniert");
});
