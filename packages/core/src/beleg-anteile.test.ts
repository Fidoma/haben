import { describe, expect, it } from "vitest";
import { belegAnteile, betrieblicherAnteil, hatPrivatanteil, privaterAnteil } from "./beleg-anteile.ts";

describe("Anteile eines Belegs", () => {
  it("teilt centgenau in betrieblich und privat, gerundet wie beim Buchen", () => {
    expect(belegAnteile(4_999, 20)).toEqual({ business: 3_999, private: 1_000 });
    expect(belegAnteile(12_345, 19)).toEqual({ business: 9_999, private: 2_346 });
    expect(belegAnteile(10_000, 2.5)).toEqual({ business: 9_750, private: 250 });
    // 25 % von 10 ct sind 2,5 → privater Teil gerundet 3, betrieblich 7 (nicht umgekehrt)
    expect(belegAnteile(10, 25)).toEqual({ business: 7, private: 3 });
    expect(belegAnteile(-1_000, 25)).toEqual({ business: -750, private: -250 });
    for (const [betrag, prozent] of [
      [0, 0],
      [1, 33.33],
      [853, 40],
      [50_000_000, 99.99],
      [-777, 7.5],
    ] as const) {
      const { business, private: privat } = belegAnteile(betrag, prozent);
      expect(business + privat).toBe(betrag);
    }
  });

  it("betrieblicher Teil: ohne Anteil der ganze Betrag, bei 100 % nichts", () => {
    expect(betrieblicherAnteil(4_999, 0)).toBe(4_999);
    expect(betrieblicherAnteil(853, 40)).toBe(512);
    expect(betrieblicherAnteil(1_000, 100)).toBe(0);
    expect(betrieblicherAnteil(-853, 40)).toBe(-512);
    // Der private Teil wird gerundet, der betriebliche ist die Differenz: 33 % von 350 ct sind 115,5 → 116
    // privat, betrieblich 234. Direkt gerundet wären es 234,5 → 235 (Fehler aus #1981).
    expect(betrieblicherAnteil(350, 33)).toBe(234);
    expect(betrieblicherAnteil(10, 25)).toBe(7);
  });

  it("privater Teil: ohne Anteil nichts, sonst die Entnahme", () => {
    expect(privaterAnteil(4_999, 0)).toBe(0);
    expect(privaterAnteil(853, 40)).toBe(341);
    expect(privaterAnteil(1_000, 100)).toBe(1_000);
    expect(privaterAnteil(-853, 40)).toBe(-341);
  });

  it("hatPrivatanteil unterscheidet 0 von jedem gesetzten Wert", () => {
    expect(hatPrivatanteil(0)).toBe(false);
    expect(hatPrivatanteil(null)).toBe(false);
    expect(hatPrivatanteil(undefined)).toBe(false);
    expect(hatPrivatanteil(1)).toBe(true);
    expect(hatPrivatanteil(100)).toBe(true);
  });
});
