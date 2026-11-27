import type { EstXmlInput } from "./est.ts";

/** Eingabe einer Zusammenveranlagung 2025 für Tests der Einkommensteuererklärung */
export const estInput = (overrides: Partial<EstXmlInput> = {}): EstXmlInput => ({
  year: 2025,
  steuernummer13: "2836216146249",
  bundesland: "BW",
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
  personA: { idnr: "86095742719", vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", religion: "11", beruf: "IT-Berater" },
  personB: { idnr: "65929970489", vorname: "Erika", name: "Muster", geburtsdatum: "1987-09-01", religion: "02", beruf: "" },
  verheiratetSeit: "2015-06-20",
  anschrift: { strasse: "Hauptstraße 12a", plz: "77815", ort: "Bühl" },
  telefon: "07223 12345",
  iban: "DE89 3704 0044 0532 0130 00",
  gewinn: { einkunftsart: "selbstaendig", taetigkeit: "IT-Beratung", betrag: 8_543_250 },
  angaben: {
    vorsorge: { a: { pkv: 600_000, ppv: 40_049, pkvErstattung: 50_000 }, b: { gkv: 300_000, gpv: 60_000 }, sonstige: 25_000 },
    sonderausgaben: { kirchensteuerGezahlt: 12_000, spenden: 10_000 },
    krankheitskosten: 150_000,
    haushaltsnah: { handwerker: 80_000 },
    kinder: [{ idnr: "57286403713", vorname: "Lena", geburtsdatum: "2025-03-05", familienkasse: "Familienkasse BW", kinderbetreuung: 200_000 }],
    kap: { ertraegeMitSteuerabzug: 120_000, sparerPauschbetrag: 100_000, kapitalertragsteuer: 5_000, soli: 275 },
  },
  ...overrides,
});
