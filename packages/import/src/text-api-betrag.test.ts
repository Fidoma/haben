import { describe, expect, it } from "vitest";
import { apiBetragInCent } from "./text.ts";

/* Beträge aus der API eines Anbieters als Dezimaltext (#1729): ganze Cent ohne Gleitkomma, für alle Adapter */
describe("apiBetragInCent", () => {
  it("rechnet ohne Gleitkomma", () => {
    expect(apiBetragInCent("-1.10")).toBe(-110);
    expect(apiBetragInCent("0.07")).toBe(7);
    expect(apiBetragInCent("1234")).toBe(123_400);
    expect(apiBetragInCent("19.9")).toBe(1_990);
    // Nullen nach dem Cent ändern nichts
    expect(apiBetragInCent("2.500")).toBe(250);
    expect(apiBetragInCent("-0.00")).toBe(0);
  });

  it("lehnt Unbrauchbares, echte Bruchteile von Cent und zu große Beträge ab", () => {
    for (const wert of ["1,10", "1.234,56", "1e3", "", " ", "-", ".5", "0.005", "12.3456", "9".repeat(20)]) expect(apiBetragInCent(wert), wert).toBeNull();
  });
});
