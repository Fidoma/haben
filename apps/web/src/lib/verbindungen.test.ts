import { describe, expect, it } from "vitest";
import type { KartenStatus } from "./kontenkarten.ts";
import { hinweisText, ibanKurz, loesungFuer, nachDringlichkeit, sammelHinweis } from "./verbindungen.ts";

/* Knopf und Hinweis zum Status eines Kontos (#1951): Bankseite und Seite Verbindungen bieten dasselbe an */

const status = (text: string, teil: Partial<KartenStatus> = {}): KartenStatus => ({ text, tone: "warn", emphasis: "notice", detail: null, ...teil });
const bank = { art: "enablebanking" as const, verbindungId: "eb" };
const fints = { art: "fints" as const, verbindungId: "f" };
const psp = { art: "psp" as const, verbindungId: "p" };

describe("loesungFuer", () => {
  it("ohne Status kein Knopf", () => {
    expect(loesungFuer({ status: null, zugang: psp })).toBeNull();
  });

  it("Konflikt klären, Freigabe über einen neuen Abruf", () => {
    expect(loesungFuer({ status: status("Konflikt"), zugang: psp })).toEqual({ art: "klaeren", label: "Klären" });
    expect(loesungFuer({ status: status("Freigabe nötig"), zugang: fints })).toEqual({ art: "abrufen", label: "Jetzt abrufen" });
  });

  it("Enable Banking meldet man neu an, FinTS und Zahlungsdienstleister ändern den Zugang", () => {
    for (const text of ["Fehlgeschlagen", "Abgelaufen", "Läuft ab"]) {
      expect(loesungFuer({ status: status(text), zugang: bank })?.label).toBe("Neu anmelden");
      expect(loesungFuer({ status: status(text), zugang: fints })?.label).toBe("Zugang ändern");
      expect(loesungFuer({ status: status(text), zugang: psp })?.label).toBe("Zugang ändern");
    }
  });

  it("veraltet: mit Verbindung abrufen, ohne eine Datei importieren", () => {
    expect(loesungFuer({ status: status("Veraltet"), zugang: fints })?.art).toBe("abrufen");
    expect(loesungFuer({ status: status("Veraltet"), zugang: null })).toEqual({ art: "datei", label: "Datei importieren" });
  });
});

describe("hinweisText", () => {
  const karte = { name: "Mollie", fehler: null, zugang: psp };

  it("nennt den Fehler des Abrufs im Wortlaut", () => {
    expect(hinweisText({ ...karte, status: status("Fehlgeschlagen", { tone: "danger" }), fehler: "Schlüssel abgelehnt" })).toBe(
      "Der letzte Abruf ist fehlgeschlagen: Schlüssel abgelehnt",
    );
  });

  it("wiederholt „fehlgeschlagen“ nicht, wenn der Fehler schon so beginnt (FinTS und Zahlungsdienstleister schreiben „Abruf fehlgeschlagen: …“)", () => {
    expect(hinweisText({ ...karte, status: status("Fehlgeschlagen", { tone: "danger" }), fehler: "Abruf fehlgeschlagen: Schlüssel abgelehnt" })).toBe(
      "Der letzte Abruf ist fehlgeschlagen: Schlüssel abgelehnt",
    );
  });

  it("Ablauf: Zustimmung bei Enable Banking, sonst der Zugang", () => {
    expect(hinweisText({ ...karte, zugang: bank, status: status("Läuft ab", { detail: "in 12 Tagen" }) })).toBe(
      "Die Zustimmung bei der Bank läuft in 12 Tagen ab. Danach ruft Haben nichts mehr ab.",
    );
    expect(hinweisText({ ...karte, status: status("Abgelaufen") })).toBe("Der Zugang ist abgelaufen. Bis du ihn erneuerst, ruft Haben nichts mehr ab.");
    expect(hinweisText({ ...karte, zugang: bank, status: status("Abgelaufen") })).toBe(
      "Die Zustimmung bei der Bank ist abgelaufen. Bis du sie erneuerst, ruft Haben nichts mehr ab.",
    );
  });

  it("Konflikt mit Zahl, veraltet je nachdem, ob das Konto verbunden ist", () => {
    expect(hinweisText({ ...karte, status: status("Konflikt", { detail: "3 Umsätze" }) })).toBe(
      "Der Abruf liefert 3 Umsätze anders als beim ersten Mal. Bis du entscheidest, übernimmt Haben davon nichts.",
    );
    expect(hinweisText({ ...karte, zugang: null, status: status("Veraltet", { detail: "13.11." }) })).toBe(
      "Der letzte Stand ist vom 13.11. Importiere eine neuere Datei oder verbinde das Konto.",
    );
  });
});

describe("nachDringlichkeit und sammelHinweis", () => {
  const karten = [
    { name: "Shop DE", status: null, zugang: psp, fehler: null },
    { name: "PayPal", status: status("Konflikt"), zugang: psp, fehler: null },
    { name: "eBay-Shop", status: status("Läuft ab", { emphasis: "urgent" }), zugang: psp, fehler: null },
    { name: "Mollie", status: status("Fehlgeschlagen", { tone: "danger", emphasis: "urgent" }), zugang: psp, fehler: null },
    { name: "SumUp", status: null, zugang: psp, fehler: null },
  ];

  it("fehlgeschlagen vor dringend vor Hinweis, sonst wie vorher", () => {
    expect(nachDringlichkeit(karten).map((k) => k.name)).toEqual(["Mollie", "eBay-Shop", "PayPal", "Shop DE", "SumUp"]);
  });

  it("zählt die Konten mit Status, das Dringendste zuerst; ohne Status kein Hinweis", () => {
    expect(sammelHinweis(karten)).toBe("3 Konten brauchen dich: Mollie (Fehlgeschlagen), eBay-Shop (Läuft ab) und PayPal (Konflikt).");
    expect(sammelHinweis([karten[1]!])).toBe("Ein Konto braucht dich: PayPal (Konflikt).");
    expect(sammelHinweis([karten[0]!])).toBeNull();
  });
});

describe("ibanKurz", () => {
  it("Land und Prüfziffer, dann die letzten vier Ziffern", () => {
    expect(ibanKurz("DE12 5001 0517 0648 4898 90")).toBe("DE12 …9890");
    expect(ibanKurz(null)).toBeNull();
  });
});
