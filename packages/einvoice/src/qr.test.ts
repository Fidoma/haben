import { girocodePayload } from "@haben/core";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { girocodeSvg, qrSvg } from "./qr.ts";

/** Liest den QR-Code aus dem SVG mit einem unabhängigen Decoder: jedes Modul 4 Pixel, 4 Module Ruhezone */
function lesen(svg: string): { text: string; version: number } {
  const size = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1]);
  const dunkel = new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(([, x, y]) => `${x},${y}`));
  const px = 4;
  const breite = (size + 8) * px;
  const bild = new Uint8ClampedArray(breite * breite * 4).fill(255);
  for (let y = 0; y < breite; y++) {
    for (let x = 0; x < breite; x++) {
      if (!dunkel.has(`${Math.floor(x / px) - 4},${Math.floor(y / px) - 4}`)) continue;
      bild.fill(0, (y * breite + x) * 4, (y * breite + x) * 4 + 3);
    }
  }
  const code = jsQR(bild, breite, breite);
  if (!code) throw new Error("kein QR-Code erkannt");
  return { text: new TextDecoder().decode(new Uint8Array(code.binaryData)), version: code.version };
}

function giro(amount: number, text: string, name = "Müller & Söhne GmbH"): string {
  const payload = girocodePayload({ name, iban: "DE89370400440532013000", bic: "COBADEFFXXX", amount, text });
  if (!payload) throw new Error("ungültiger GiroCode im Test");
  return payload;
}

describe("qrSvg", () => {
  it.each([
    ["kurzer Text", "Rechnung 4711"],
    ["GiroCode mit Umlauten", giro(123_45, "Rechnung 2026-001 für März")],
    ["GiroCode mit langem Verwendungszweck", giro(9_999_999_99, `Rechnung ${"x".repeat(130)}`)],
  ])("%s lässt sich wieder lesen", (_name, text) => {
    expect(lesen(qrSvg(text)).text).toBe(text);
  });

  it("zeichnet ohne Rand, die Größe passt zur Version", () => {
    const svg = qrSvg("Rechnung 4711");
    const { version } = lesen(svg);
    expect(svg).toContain(`viewBox="0 0 ${4 * version + 17} ${4 * version + 17}"`);
    expect(svg).toContain('d="M0 0h1v1h-1z');
  });

  it("nimmt Fehlerkorrektur M wie bisher (Version 1 trägt bei M höchstens 14 Byte, bei L 17)", () => {
    expect(lesen(qrSvg("a".repeat(14))).version).toBe(1);
    expect(lesen(qrSvg("a".repeat(15))).version).toBe(2);
  });

  it("bleibt beim längsten GiroCode bei Version 13 (EPC069-12: höchstens 331 Byte, Version 13, Fehlerkorrektur M)", () => {
    const text = giro(9_999_999_99, `${"ä".repeat(62)}x`, "Ö".repeat(70));
    expect(new TextEncoder().encode(text).length).toBe(331);
    expect(lesen(qrSvg(text))).toEqual({ text, version: 13 });
  });
});

describe("girocodeSvg", () => {
  it("gibt ohne IBAN keinen Code", () => {
    expect(girocodeSvg({ name: "X", iban: "", amount: 100, text: "R" })).toBeNull();
  });
});
