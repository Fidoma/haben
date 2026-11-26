import { expect, type Page } from "@playwright/test";

/** Kontensuche prüfen, ohne eine Buchung festzuschreiben. Die zweite Zeile bleibt absichtlich leer. */
export async function kontensuchePruefen(page: Page) {
  const form = page.getByRole("form", { name: "Manuelle Buchung" });
  const konto = form.getByLabel("Konto Zeile 1");
  await form.getByLabel("Buchungstext").fill("Kontensuche prüfen");
  await form.getByLabel("Soll Zeile 1").fill("100,00");

  // Der erste Buchstabe darf den Renderpfad der Formularprüfung nicht zum Absturz bringen.
  await konto.fill("k");
  await expect(form).toBeVisible();
  await konto.fill("kapital");
  const kapital = form.getByRole("option").filter({ hasText: "Gezeichnetes Kapital" });
  await expect(kapital).toHaveCount(1);
  await kapital.click();
  await expect(konto).toHaveValue("2900");

  // „kapital“ träfe zuerst 7630 Kapitalertragsteuer (SKR04): Enter übernimmt den ersten Treffer
  await konto.fill("gezeichnet");
  await konto.press("Enter");
  await expect(konto).toHaveValue("2900");
  await konto.fill("Unbekanntes Konto");
  await expect(form.getByText("Keine Treffer", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Buchen", exact: true }).click();
  await expect(konto).toHaveAccessibleDescription(/Konto nicht gefunden/);

  // Leeren entfernt auch das zuvor gewählte Konto und die Meldung zur Namenseingabe.
  await konto.fill("");
  // Das leere Feld zeigt alle Konten; die offene Liste läge über „Buchen“
  await konto.press("Escape");
  await form.getByRole("button", { name: "Buchen", exact: true }).click();
  await expect(konto).not.toHaveAccessibleDescription(/Konto nicht gefunden/);
  // Der Fehler steht am Feld der Zeile, ohne „Zeile 1:“ davor (#1277)
  await expect(konto).toHaveAccessibleDescription("Konto hat vier Ziffern.");
  await konto.fill("2900");
  await expect(form.getByRole("option").filter({ hasText: "Gezeichnetes Kapital" })).toHaveCount(1);
  await konto.press("Escape");
  await expect(konto).toHaveValue("2900");

  // Am Handy schneidet kein Scrollbereich der Tabelle die Trefferliste ab: Der Treffer steht ganz im Bild
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await konto.fill("verbindlichkeiten");
  await konto.evaluate((feld) => feld.scrollIntoView({ block: "start" }));
  const treffer = form.getByRole("option").first();
  await expect(treffer).toContainText(/^\d{4} · Verbindlichkeiten/);
  await expect(treffer).toBeInViewport({ ratio: 1 });
  await konto.press("Escape");
  if (viewport) await page.setViewportSize(viewport);
}
