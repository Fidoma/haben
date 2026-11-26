import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { menueGruppe } from "./menue-gruppe.ts";
import { NAV_GROUPS, STEUERBERATUNG_NAV } from "./navigation.ts";

const routen = fileURLToPath(new URL("../routes/_app/", import.meta.url));

/** Weiterleitungen: Ihr Ziel hat den Eyebrow von Hand (Jahresabschluss, Jahreserklärung, Umsatzsteuer › Voranmeldung) */
const WEITERLEITUNG = new Set(["/abschluss", "/jahreserklaerung", "/umsatzsteuer"]);

describe("menueGruppe", () => {
  it("nennt die Menügruppe der Seite", () => {
    expect(menueGruppe("/angebote")).toBe("Verkauf");
    expect(menueGruppe("/belege")).toBe("Ausgaben");
    expect(menueGruppe("/kasse")).toBe("Geld");
  });

  it("liest für die Steuerberatung deren Menü", () => {
    expect(menueGruppe("/rechnungen", false)).toBe("Steuerberatung");
    expect(menueGruppe("/rechnungen", true)).toBe("Verkauf");
  });

  it("wirft für eine Seite, die nicht im Menü der Rolle steht", () => {
    expect(() => menueGruppe("/gibt-es-nicht")).toThrow(/steht nicht im Menü/);
    expect(() => menueGruppe("/angebote", false)).toThrow(/Steuerberatung/);
  });
});

describe("Eyebrow der Seiten im Menü", () => {
  const seiten = [...NAV_GROUPS, ...STEUERBERATUNG_NAV].flatMap((gruppe) => gruppe.links.map((link) => link.to));
  const steuerberatung = new Set(STEUERBERATUNG_NAV.flatMap((gruppe) => gruppe.links.map((link) => link.to)));

  for (const to of [...new Set(seiten)].filter((seite) => !WEITERLEITUNG.has(seite))) {
    it(`${to} zeigt den Namen der Menügruppe, nicht von Hand getippt`, () => {
      const datei = [`${routen}${to.slice(1)}.tsx`, `${routen}${to.slice(1)}/index.tsx`].find((pfad) => existsSync(pfad));
      expect(datei, `Seite zu ${to} gefunden`).toBeDefined();
      const quelltext = readFileSync(datei!, "utf8");
      // Die Seiten der Steuerberatung reichen `inhaber` durch, damit sie den Namen ihres Menüs zeigen
      const aufruf = steuerberatung.has(to) ? `menueGruppe("${to}", inhaber)` : `menueGruppe("${to}"`;
      expect(quelltext.includes(aufruf), `${aufruf} fehlt in ${datei}`).toBe(true);
      expect(quelltext.includes('className="eyebrow"'), `Eyebrow fehlt in ${datei}`).toBe(true);
      expect(quelltext.match(/className="eyebrow">(?!\s*\{menueGruppe\()/g) ?? [], "Eyebrow von Hand").toEqual([]);
    });
  }
});
