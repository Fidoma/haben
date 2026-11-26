import { describe, expect, it } from "vitest";
import { abrufText, kontoText, verbundenText, zugangArt } from "./psp-einrichtung.ts";

describe("Auswahl des Anbieters (#1951)", () => {
  it("nennt den Zugang nach den geheimen Feldern des Adapters, ohne die Felder der config", () => {
    expect(zugangArt([{ label: "API-Schlüssel", art: "geheim" }])).toBe("API-Schlüssel");
    expect(
      zugangArt([
        { label: "Client-ID", art: "geheim" },
        { label: "Secret", art: "geheim" },
        { label: "Umgebung", art: "auswahl" },
      ]),
    ).toBe("Client-ID und Secret");
  });

  it("nennt bestehende Verbindungen mit Namen", () => {
    expect(verbundenText([])).toBe("noch nicht verbunden");
    expect(verbundenText(["Shop DE", "Kurse"])).toBe("verbunden: „Shop DE“ und „Kurse“");
  });
});

describe("Konto der neuen Verbindung", () => {
  const frei = { name: "Stripe alt" };
  it("das gewählte Konto geht vor", () => {
    expect(kontoText({ gewaehlt: { name: "Stripe Kurse" }, automatisch: frei, gebunden: false, name: "Shop" })).toBe(
      "Der Abruf schreibt in das Konto „Stripe Kurse“.",
    );
  });

  it("„Automatisch“: das an den Abruf gebundene, sonst das freie, sonst ein neues mit dem Namen der Verbindung", () => {
    expect(kontoText({ gewaehlt: null, automatisch: frei, gebunden: true, name: "Shop" })).toContain(
      "das die Umsätze dieses Kontos beim Anbieter schon bekommt",
    );
    expect(kontoText({ gewaehlt: null, automatisch: frei, gebunden: false, name: "Shop" })).toBe("Der Abruf schreibt in das freie Konto „Stripe alt“.");
    expect(kontoText({ gewaehlt: null, automatisch: null, gebunden: false, name: " Shop DE " })).toBe(
      "Haben legt das Konto „Shop DE“ der Art Zahlungsdienstleister an.",
    );
  });
});

describe("Ergebnis des ersten Abrufs", () => {
  it("Bewegungen beim Anbieter und neue Umsätze im Konto, Einzahl und Mehrzahl", () => {
    expect(abrufText({ entries: 2, added: 3, accountName: "Shop DE" })).toBe("2 Bewegungen beim Anbieter, 3 neue Umsätze im Konto „Shop DE“.");
    expect(abrufText({ entries: 1, added: 1, accountName: "Shop DE" })).toBe("1 Bewegung beim Anbieter, 1 neuer Umsatz im Konto „Shop DE“.");
  });

  it("ohne Konto in Haben ist nichts übernommen", () => {
    expect(abrufText({ entries: 4, added: 0, accountName: null })).toBe("4 Bewegungen beim Anbieter; übernommen ist nichts.");
  });
});
