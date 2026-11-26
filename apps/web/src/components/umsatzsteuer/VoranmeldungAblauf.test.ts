import { formatEuro } from "@haben/core";
import { describe, expect, it } from "vitest";
import { ablaufSchritt, ergebnisSatz } from "./VoranmeldungAblauf.tsx";

describe("Ergebnissatz der Voranmeldung (#1253, Punkt 43)", () => {
  it("nennt bei Zahllast mit künftiger Frist Betrag und Frist", () => {
    expect(ergebnisSatz(123_400, "2026-12-10", "2026-11-23")).toBe(`Du zahlst ${formatEuro(123_400)} bis 10.12.2026.`);
    // Am Tag der Frist ist sie noch nicht überschritten
    expect(ergebnisSatz(123_400, "2026-12-10", "2026-12-10")).toBe(`Du zahlst ${formatEuro(123_400)} bis 10.12.2026.`);
  });

  it("sagt bei überfälliger Frist, dass die Zahllast fällig war, statt eine Frist in der Vergangenheit zu nennen", () => {
    expect(ergebnisSatz(150_000, "2026-11-10", "2026-11-23")).toBe(`Die Zahllast von ${formatEuro(150_000)} war am 10.11.2026 fällig.`);
  });

  it("nennt bei Erstattung den Betrag ohne Vorzeichen und keine Frist, auch wenn der Tag vorbei ist", () => {
    expect(ergebnisSatz(-12_300, "2026-12-10", "2026-11-23")).toBe(`Du bekommst ${formatEuro(12_300)} zurück, sobald das Finanzamt zustimmt.`);
    expect(ergebnisSatz(-12_300, "2026-11-10", "2026-11-23")).toBe(`Du bekommst ${formatEuro(12_300)} zurück, sobald das Finanzamt zustimmt.`);
  });

  it("sagt bei 0, dass nichts zu zahlen ist", () => {
    expect(ergebnisSatz(0, "2026-12-10", "2026-11-23")).toBe("Diesmal ist nichts zu zahlen.");
  });
});

describe("Ablauf der Voranmeldung (#1253, Punkt 42)", () => {
  const stand = { locked: false, gespeichert: true, geaendert: false, ausgeglichen: false };

  it("beginnt mit dem Prüfen der Zahlen, solange nichts gespeichert oder seit dem Speichern geändert ist", () => {
    expect(ablaufSchritt({ ...stand, gespeichert: false })).toBe(1);
    expect(ablaufSchritt({ ...stand, geaendert: true })).toBe(1);
  });

  it("geht mit dem gespeicherten, unveränderten Entwurf zum Abgeben", () => {
    expect(ablaufSchritt(stand)).toBe(2);
  });

  it("steht nach dem Festschreiben beim Zahlen, bis die Posten ausgeglichen sind; danach ist nichts mehr offen", () => {
    expect(ablaufSchritt({ ...stand, locked: true })).toBe(3);
    expect(ablaufSchritt({ ...stand, locked: true, ausgeglichen: true })).toBeNull();
  });
});
