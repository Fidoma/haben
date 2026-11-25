import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KorrekturAktionen } from "./KorrekturAktionen.tsx";

const render = (busy = false) => renderToStaticMarkup(createElement(KorrekturAktionen, { busy, onCancel: () => {}, onCorrect: () => {} }));

/** Knopf mit Namen und der Text, auf den sein aria-describedby zeigt */
function knopf(html: string, name: string) {
  const button = new RegExp(`<button([^>]*)>${name}</button>`).exec(html);
  const id = /aria-describedby="([^"]+)"/.exec(button?.[1] ?? "")?.[1];
  const text = id ? new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1] : undefined;
  return { gefunden: button !== null, text };
}

describe("Korrigieren einer festgeschriebenen Rechnung", () => {
  it("behält die Namen der Knöpfe", () => {
    const html = render();
    expect(knopf(html, "Stornieren").gefunden).toBe(true);
    expect(knopf(html, "Rechnungskorrektur anlegen").gefunden).toBe(true);
  });

  it("erklärt jeden Knopf unter ihm und verbindet den Text mit dem Knopf", () => {
    const html = render();
    expect(knopf(html, "Stornieren").text).toMatch(/^Hebt die Rechnung ganz auf.*Korrekturen werden mit storniert/);
    // Das Papierstorno einer Schlussrechnung im Bilanzverfahren und einer Anzahlungsanforderung bucht nichts (advance-invoice.ts)
    expect(knopf(html, "Stornieren").text).not.toMatch(/gebucht/);
    expect(knopf(html, "Rechnungskorrektur anlegen").text).toMatch(/^Mindert den Betrag: ein Entwurf mit allen Positionen negativ/);
  });

  it("sperrt beide Knöpfe, solange etwas läuft, und lässt die Erklärung stehen", () => {
    const html = render(true);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(knopf(html, "Stornieren").text).toBeDefined();
  });
});
