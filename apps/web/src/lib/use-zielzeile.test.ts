import { describe, expect, it } from "vitest";
import { zielzeile } from "./use-zielzeile.ts";

// Zeile, auf die ein Link zeigt (`#buchung-<id>`): Journal (#1855) und Kontenblatt (#1635)
describe("Zielzeile einer Buchung", () => {
  it("die getroffene Zeile ist hervorgehoben und nimmt den Fokus an", () => {
    expect(zielzeile("buchung-e1", "buchung-e1")).toEqual({ id: "buchung-e1", "aria-current": "true", tabIndex: -1 });
  });

  it("andere Zeilen tragen nur ihren Anker", () => {
    expect(zielzeile("buchung-e2", "buchung-e1")).toEqual({ id: "buchung-e2", "aria-current": undefined, tabIndex: undefined });
  });

  it("ohne Anker (weitere Zeile derselben Buchung im Kontenblatt) nichts, auch ohne Ziel", () => {
    expect(zielzeile(undefined, "")).toEqual({ id: undefined, "aria-current": undefined, tabIndex: undefined });
  });
});
