import { describe, expect, it } from "vitest";
import { kapgSteuernFehler, type SteuernFormular } from "./kapg-steuern-pruefung.ts";

// #1277: statt „Hebesatz in ganzen Prozent und Verlustvorträge als Betrag eingeben.“ je Feld eine Meldung, mit den Grenzen
// von kapgAngabenSchema und saveKapgAngaben
describe("Prüfung der Angaben zur Körperschaft- und Gewerbesteuer", () => {
  const gut: SteuernFormular = { year: 2026, hebesatz: "400", vortragKst: "", vortragGewst: "", ruecktrag: "" };
  const fehler = (f: Partial<SteuernFormular>) => Object.fromEntries(Object.entries(kapgSteuernFehler({ ...gut, ...f })).filter(([, e]) => e !== null));
  const ganzeProzent = "Trag den Hebesatz der Gemeinde in ganzen Prozent ein, etwa 400.";

  it("nimmt gültige Angaben an, leere Verlustvorträge gelten als 0", () => {
    expect(fehler({})).toEqual({});
    expect(fehler({ vortragKst: "12.500,00", vortragGewst: "0", ruecktrag: "1000" })).toEqual({});
    expect(Object.keys(kapgSteuernFehler(gut))).toEqual(["hebesatz", "vortragKst", "vortragGewst", "ruecktrag"]);
  });

  it("meldet einen leeren, nicht ganzzahligen oder nicht lesbaren Hebesatz am Hebesatz", () => {
    expect(fehler({ hebesatz: "" })).toEqual({ hebesatz: ganzeProzent });
    expect(fehler({ hebesatz: "400,5" })).toEqual({ hebesatz: ganzeProzent });
    expect(fehler({ hebesatz: "vierhundert" })).toEqual({ hebesatz: ganzeProzent });
  });

  it("nennt den Mindesthebesatz des Jahres wie der Server (§ 16 Abs. 4 Satz 2 GewStG) und die Obergrenze des Schemas", () => {
    expect(fehler({ hebesatz: "199" })).toEqual({ hebesatz: "Der Hebesatz beträgt 2026 mindestens 200 %." });
    expect(fehler({ year: 2027, hebesatz: "200" })).toEqual({ hebesatz: "Der Hebesatz beträgt 2027 mindestens 280 %." });
    expect(fehler({ year: 2027, hebesatz: "280" })).toEqual({});
    expect(fehler({ hebesatz: "1500" })).toEqual({});
    expect(fehler({ hebesatz: "1501" })).toEqual({ hebesatz: "Trag einen Hebesatz bis 1.500 % ein." });
  });

  it("meldet jeden Verlustvortrag und den Rücktrag am eigenen Feld", () => {
    expect(fehler({ vortragKst: "zehntausend", vortragGewst: "-5,00", ruecktrag: "100.000.000.000,01" })).toEqual({
      vortragKst: "Trag den Betrag ein, etwa 10.000,00, oder lass das Feld leer.",
      vortragGewst: "Trag einen Betrag von 0,00 bis 100.000.000.000,00 ein, etwa 10.000,00, oder lass das Feld leer.",
      ruecktrag: "Trag einen Betrag von 0,00 bis 100.000.000.000,00 ein, etwa 5.000,00, oder lass das Feld leer.",
    });
  });
});
