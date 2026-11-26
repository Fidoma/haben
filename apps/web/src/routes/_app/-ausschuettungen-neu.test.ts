import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({}) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("../../server/functions/ausschuettung.ts", () => ({ createAusschuettungFn: vi.fn(), previewAusschuettung: vi.fn() }));
import { Icon } from "../../components/Icon.tsx";
import { EmpfaengerTabelle, VorschlagMeldungen } from "./-ausschuettungen-neu.tsx";

const grund = "Der Gewinnvortrag zum Beschluss beträgt 25.000,00 €; mehr lässt sich nicht ausschütten.";
const hinweis = "Für 2026 passt der Anteil in Prozent nicht zur Beteiligung in Euro: Erika Gesellschafter 60 % (nach der Beteiligung 50 %).";

const symbol = (name: "alert" | "info") => renderToStaticMarkup(createElement(Icon, { name }));

/*
 * #1286: Der Grund sperrt „Beschluss buchen“, der Hinweis nicht; man soll sehen, welcher Banner den Knopf sperrt, auch
 * ohne Farbe (WCAG 1.4.1): Grund mit Symbol alert, Hinweis mit info
 */
it("zeigt den sperrenden Grund als Warnung mit alert und den Hinweis als banner-info mit info, den Grund zuerst", () => {
  const html = renderToStaticMarkup(createElement(VorschlagMeldungen, { issues: [grund], hinweise: [hinweis] }));
  expect(html).toBe(
    `<div class="banner" role="status">${symbol("alert")}<span>${grund}</span></div>` +
      `<div class="banner banner-info" role="status">${symbol("info")}<span>${hinweis}</span></div>`,
  );
});

it("zeigt ohne Grund und Hinweis nichts", () => {
  expect(renderToStaticMarkup(createElement(VorschlagMeldungen, { issues: [], hinweise: [] }))).toBe("");
});

/*
 * #1812: Verteilt wird nach der Beteiligung in Euro (§ 29 Abs. 3 Satz 1 GmbHG, #1286); die Tabelle nennt sie je Empfänger in
 * einer eigenen Spalte. Ausschüttungen von vor #1812 haben nur den Anteil in Prozent gespeichert (bis #1286 der Maßstab):
 * Die Spalte heißt dann „Anteil“ und zeigt ihn, ohne die gespeicherten Daten zu ändern
 */
const empfaenger = (name: string, anteil: number, beteiligung?: number) => ({
  name,
  anteil,
  ...(beteiligung === undefined ? {} : { beteiligung }),
  brutto: 1_000_000,
  ausEinlagekonto: 0,
  ertrag: 1_000_000,
  kapest: 250_000,
  soli: 13_750,
  kist: 0,
  netto: 736_250,
  kirchensteuer: 0 as const,
  religionsschluessel: null,
});
const zellen = (html: string, tag: "th" | "td") => [...html.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))].map((m) => m[1]);

it("nennt je Empfänger die Beteiligung in Euro in einer eigenen Spalte, in der Summe alle Beteiligungen zusammen (#1812)", () => {
  const html = renderToStaticMarkup(
    createElement(EmpfaengerTabelle, {
      empfaenger: [empfaenger("Erika", 3334, 1_000_000), empfaenger("Max", 3333, 1_000_000), empfaenger("Lena", 3333, 1_000_000)],
    }),
  );
  expect(zellen(html, "th").slice(0, 3)).toEqual(["Gesellschafter", "Beteiligung", "Brutto"]);
  expect(zellen(html, "th").slice(-4)).toEqual(["Erika", "Max", "Lena", "Summe"]);
  expect(html).toContain('<td class="num" data-label="Beteiligung">10.000,00\u00a0€</td>');
  expect(html).toContain('<td class="num" data-label="Beteiligung">30.000,00\u00a0€</td>');
  expect(html).not.toContain("%");
});

it("zeigt bei einer Ausschüttung ohne gespeicherte Beteiligung weiter den Anteil in Prozent (#1812)", () => {
  const html = renderToStaticMarkup(createElement(EmpfaengerTabelle, { empfaenger: [empfaenger("Erika", 6000), empfaenger("Max", 4000)] }));
  expect(zellen(html, "th").slice(0, 3)).toEqual(["Gesellschafter", "Anteil", "Brutto"]);
  expect(zellen(html, "th").slice(-3)).toEqual(["Erika", "Max", "Summe"]);
  expect(html).toContain('<td class="num" data-label="Anteil">60\u00a0%</td>');
  expect(html).toContain('<td class="num" data-label="Anteil">40\u00a0%</td>');
  expect(html).toContain('<td class="num" data-label="Anteil">100\u00a0%</td>');
});
