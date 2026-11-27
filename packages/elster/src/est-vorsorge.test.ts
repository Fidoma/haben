import { describe, expect, it } from "vitest";
import { buildEstXml, type EstLohnsteuerbescheinigung, type EstVorsorgePerson } from "./est.ts";
import { estInput } from "./est.testdaten.ts";
import { checkXml } from "./fake-client.ts";

/* Anlage Vorsorgeaufwand (est-vorsorge.ts): Rundung wie die amtliche Zuordnung, Arbeitgeberzuschüsse nach den ERiC-Regeln */

const fest = estInput();
const mitVorsorge = (a: EstVorsorgePerson, bescheinigungen?: EstLohnsteuerbescheinigung[]) =>
  buildEstXml(
    estInput({
      angaben: {
        ...fest.angaben,
        vorsorge: { a, sonstige: 25_000 },
        ...(bescheinigungen ? { arbeitnehmer: { a: { bescheinigungen, werbungskosten: {} } } } : {}),
      },
    }),
  );
const zuschuss = (xml: string) => /<Stfr_AG_Zusch>[\s\S]*?<\/Stfr_AG_Zusch>/.exec(xml)?.[0] ?? "";

describe("anlageVorsorge", () => {
  it("rundet die Summen der Lohnsteuerbescheinigungen wie die Zuordnung: Beiträge auf, den Arbeitgeberanteil ab", () => {
    // VAST_Vorberechnungen_2025.ods, Blatt „VaSt_LStB_Gesamt - Regeln“: Berechne_E2000401, E2001203, E2001505 und E2004403
    // mit Aufrunden(Summe(…)), Berechne_E2000801 mit Abrunden(Summe(…)); kaufmännisch ergäbe 4464, 4465, 1000, 300 und 200
    const xml = mitVorsorge({}, [
      { steuerklasse: 1, brutto: 2_000_000, rvArbeitnehmer: 200_020, rvArbeitgeber: 200_030, kvArbeitnehmer: 50_000, pvArbeitnehmer: 15_000 },
      { steuerklasse: 6, brutto: 1_000_000, rvArbeitnehmer: 246_420, rvArbeitgeber: 246_430, kvArbeitnehmer: 50_001, pvArbeitnehmer: 15_010 },
      { steuerklasse: 6, brutto: 500_000, avArbeitnehmer: 20_010 },
    ]);
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toMatch(/<AVor>\s*<Person>PersonA<\/Person>\s*<E2000401>4465<\/E2000401>\s*<E2000801>4464<\/E2000801>\s*<\/AVor>/);
    expect(xml).toMatch(/<AN>\s*<E2001203>1001<\/E2001203>\s*<E2001505>301<\/E2001505>\s*<\/AN>/);
    expect(xml).toMatch(/<Pers>\s*<Person>PersonA<\/Person>\s*<E2004403>201<\/E2004403>\s*<\/Pers>/);
  });

  it("schreibt Arbeitnehmer- und Arbeitgeberanteil zur Rentenversicherung gemeinsam, den fehlenden mit 0 (Regel 950020)", () => {
    // Berechne_E2000401 und Berechne_E2000801 greifen, sobald einer der Anteile ≠ 0 ist; aus dem TDD-Review
    const avor = (xml: string) => /<AVor>[\s\S]*?<\/AVor>/.exec(xml)?.[0] ?? "";
    const kleinerAg = avor(mitVorsorge({}, [{ steuerklasse: 1, brutto: 2_000_000, rvArbeitnehmer: 10_000, rvArbeitgeber: 60 }]));
    expect(kleinerAg).toMatch(/<E2000401>100<\/E2000401>\s*<E2000801>0<\/E2000801>/);
    const nurAg = avor(mitVorsorge({}, [{ steuerklasse: 1, brutto: 600_000, rvArbeitgeber: 55_800 }]));
    expect(nurAg).toMatch(/<E2000401>0<\/E2000401>\s*<E2000801>558<\/E2000801>/);
    expect(mitVorsorge({ basisrente: 100_000 })).not.toContain("<E2000401>");
  });

  it("schreibt beim Zuschuss zur Krankenversicherung ohne den zur Pflegeversicherung dort 0 (Regel 100240078)", () => {
    // Berechne_E2003907: 0, wenn nur ein Zuschuss zur Krankenversicherung bescheinigt ist
    const gesetzlich = zuschuss(mitVorsorge({ gkv: 300_000, gpv: 60_000, agZuschussGkv: 84_000 }));
    expect(gesetzlich).toMatch(/<E2003705>840<\/E2003705>\s*<E2003907>0<\/E2003907>/);
    expect(gesetzlich).not.toContain("<E2003807>");
    const privat = zuschuss(mitVorsorge({ pkv: 600_000, ppv: 40_000, agZuschussKv: 120_000 }));
    expect(privat).toMatch(/<E2003807>1200<\/E2003807>\s*<E2003907>0<\/E2003907>/);
    expect(privat).not.toContain("<E2003705>");
  });

  it("schreibt beim Zuschuss zur Pflegeversicherung allein die 0 zur Krankenversicherung der Person (Regeln 100240075, 100240076, 100240078)", () => {
    // Berechne_E2003705 setzt 0; bei einer privat versicherten Person verlangte ERiC dann Beiträge zur gesetzlichen KV
    const gesetzlich = zuschuss(mitVorsorge({ gkv: 300_000, gpv: 60_000, agZuschussPv: 12_000 }));
    expect(gesetzlich).toMatch(/<E2003705>0<\/E2003705>\s*<E2003907>120<\/E2003907>/);
    expect(gesetzlich).not.toContain("<E2003807>");
    const lohn = zuschuss(mitVorsorge({ agZuschussPv: 12_000 }, [{ steuerklasse: 1, brutto: 2_000_000, kvArbeitnehmer: 100_000, pvArbeitnehmer: 30_000 }]));
    expect(lohn).toMatch(/<E2003705>0<\/E2003705>\s*<E2003907>120<\/E2003907>/);
    const privat = zuschuss(mitVorsorge({ pkv: 600_000, ppv: 40_000, agZuschussPv: 12_000 }));
    expect(privat).toMatch(/<E2003807>0<\/E2003807>\s*<E2003907>120<\/E2003907>/);
    expect(privat).not.toContain("<E2003705>");
  });
});
