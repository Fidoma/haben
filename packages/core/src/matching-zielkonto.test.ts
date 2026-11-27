import { describe, expect, it } from "vitest";
import { suggestMatches, type OpenItem } from "./matching.ts";

// Weitere Zahlungskonten (#1887): Zwei Rechnungen über denselben Betrag an denselben Kunden, je auf ein anderes Konto
const rechnung = (id: string, zielIban: string | undefined): OpenItem => ({
  type: "invoice",
  id,
  number: `2026-${id}`,
  date: "2026-09-05",
  dueDate: "2026-09-19",
  open: 119_000,
  partyName: "Nordwerk Software GmbH",
  partyIbans: [],
  ...(zielIban ? { zielIban } : {}),
});

const zahlung = {
  bookingDate: "2026-09-18",
  amount: 119_000,
  counterpartyName: "Nordwerk Software GmbH",
  purpose: "Miete September",
  kontoIban: "DE02 1203 0000 0000 2020 51",
};

describe("suggestMatches mit Zielkonto der Rechnung", () => {
  it("bevorzugt die Rechnung, deren IBAN zum Konto der Zahlung passt", () => {
    const [erste, zweite] = suggestMatches(zahlung, [rechnung("001", "DE89370400440532013000"), rechnung("002", "DE02120300000000202051")]);
    expect(erste?.item.id).toBe("002");
    expect(erste?.reasons).toContain("Auf das Konto der Rechnung");
    expect(zweite?.reasons).not.toContain("Auf das Konto der Rechnung");
    expect(erste!.score).toBe(zweite!.score + 10);
  });

  it("hebt keinen schwachen Posten über die Schwelle: das Konto ordnet nur unter den Vorschlägen", () => {
    // Teilzahlung ohne Nummer und ohne Namen: 5 Punkte, mit dem Konto der Rechnung 15, beides unter 40
    const teil = { ...zahlung, amount: 50_000, counterpartyName: "Unbekannt" };
    expect(suggestMatches(teil, [rechnung("002", "DE02120300000000202051")])).toEqual([]);
  });

  it("ohne Zielkonto oder ohne Konto des Umsatzes wie bisher", () => {
    const [ohneZiel] = suggestMatches(zahlung, [rechnung("001", undefined)]);
    const [ohneKonto] = suggestMatches({ ...zahlung, kontoIban: null }, [rechnung("002", "DE02120300000000202051")]);
    expect(ohneZiel?.reasons).not.toContain("Auf das Konto der Rechnung");
    expect(ohneKonto?.reasons).not.toContain("Auf das Konto der Rechnung");
    expect(ohneZiel?.score).toBe(ohneKonto?.score);
  });
});
