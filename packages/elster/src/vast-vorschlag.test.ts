import { describe, expect, it } from "vitest";
import { buildEstXml } from "./est.ts";
import { checkXml } from "./fake-client.ts";
import { type VastQuelle, vastVorschlag } from "./vast-vorschlag.ts";

/*
 * Vorschläge aus den Belegen der vorausgefüllten Steuererklärung (#1328). Die Belege sind erfunden, im Aufbau der Schemas
 * VaSt-Belege/Schema/<Jahr>/VaSt_<Beleg>-<Jahr>01-Nutzdaten.xsd (ERiC-Dokumentation 44.3.6.0); die Regeln stehen in
 * Zuordnungsinformationen/ESt_<Jahr>/Jahresdokumentation_VAST_Vorberechnungen_<Jahr>.ods.
 */

const A = "86095742719";
const B = "65929970489";
const idnr = { a: A, b: B };

const ns = (art: string, version: string) => `http://finkonsens.de/elster/elstervast/vast${art.toLowerCase()}/v${version}`;

function beleg(belegart: string, version: string, inhalt: string, extra: Partial<VastQuelle> = {}): VastQuelle {
  const art = belegart.replace(/^VaSt_/, "");
  return {
    id: `${belegart}-${Math.random().toString(36).slice(2, 8)}`,
    belegart,
    schemaversion: version,
    test: false,
    xml: `<?xml version="1.0" encoding="UTF-8"?><${belegart} xmlns="${ns(art, version)}" version="${version}">${inhalt}</${belegart}>`,
    ...extra,
  };
}

/** Lohnsteuerbescheinigung: Klasse im ersten ELStAM, Werte in Besteuerungsgrund */
function lstb(year: number, person: string, klasse: string, werte: Record<string, string>, extra: Partial<VastQuelle> = {}) {
  const grund = Object.entries(werte)
    .map(([name, wert]) => `<${name}>${wert}</${name}>`)
    .join("");
  return beleg(
    "VaSt_LStB",
    `${year}01`,
    `<ArbGName>Nordwerk GmbH</ArbGName><Allgemein><IdNr>${person}</IdNr></Allgemein><Dauer><Jahr>${year}</Jahr><Anfang>01.01</Anfang><Ende>31.12</Ende></Dauer>` +
      `<Besteuerungsmerkmal><ELStAM><GueltigAb>01.01</GueltigAb><Steuerklasse><Klasse>${klasse}</Klasse></Steuerklasse></ELStAM></Besteuerungsmerkmal>` +
      `<Besteuerungsgrund>${grund}</Besteuerungsgrund>`,
    extra,
  );
}

/** Kranken- und Pflegeversicherung: Beitragsdaten [BetragArt, MerkmalBeitragArt, Betrag], Versicherungsnehmer (WeiterePerson) */
function krv(
  year: number,
  versichert: string,
  beitraege: [string, string, string][],
  vn: { idnr?: string; firma?: string }[] = [{ idnr: versichert }],
  merkmal = "3",
) {
  const weitere = vn
    .map((v) =>
      v.firma
        ? `<WeiterePerson><NNPers><Firmenname>${v.firma}</Firmenname></NNPers></WeiterePerson>`
        : `<WeiterePerson><NatPerson><IdNr>${v.idnr}</IdNr></NatPerson></WeiterePerson>`,
    )
    .join("");
  const daten = beitraege
    .map(
      ([art, merkmalArt, betrag]) =>
        `<Beitragsdaten><BetragArt>${art}</BetragArt><MerkmalBeitragArt>${merkmalArt}</MerkmalBeitragArt><MerkmalBeiTrag>${merkmal}</MerkmalBeiTrag><Betrag>${betrag}</Betrag></Beitragsdaten>`,
    )
    .join("");
  return beleg(
    "VaSt_KRV",
    `${year}01`,
    `<BetroffenerFall><Meldejahr>${year}</Meldejahr><BetroffenePerson><NatPerson><IdNr>${versichert}</IdNr></NatPerson>${weitere}</BetroffenePerson></BetroffenerFall><Versicherung><Name>Techniker Krankenkasse</Name></Versicherung><Vertragsdaten>${daten}</Vertragsdaten>`,
  );
}

/** Zuschüsse nach § 10 Abs. 4b EStG: Zahlungsdaten [Zahlungsart, Betrag] */
function zus(year: number, person: string, zahlungen: [string, string][]) {
  const z = zahlungen
    .map(([art, b]) => `<Zahlungsdaten><Zahlungsart>${art}</Zahlungsart><Betrag>${b}</Betrag><Waehrung>EUR</Waehrung></Zahlungsdaten>`)
    .join("");
  return beleg(
    "VaSt_ZUS",
    `${year}01`,
    `<BetroffenerFall><Meldejahr>${year}</Meldejahr><BetroffenePerson><NatPerson><IdNr>${person}</IdNr></NatPerson></BetroffenePerson></BetroffenerFall>${z}`,
  );
}

function rue(year: number, person: string, betraege: string[]) {
  const werte = betraege.map((b) => `<Werte><ZahlJahr>${year}</ZahlJahr><Waehrung>EUR</Waehrung><Betrag>${b}</Betrag></Werte>`).join("");
  return beleg(
    "VaSt_RUE",
    `${year}01`,
    `<BetroffenerFall><NatPerson><IdNr>${person}</IdNr></NatPerson></BetroffenerFall><Vertragsdaten><Beitragsdaten>${werte}</Beitragsdaten></Vertragsdaten>`,
  );
}

function lersl(year: number, person: string, leistungen: [string, string][]) {
  const l = leistungen.map(([art, betrag]) => `<Leistung><Betrag>${betrag}</Betrag><Art>${art}</Art></Leistung>`).join("");
  return beleg("VaSt_LErsL", `${year}01`, `<Zuflussjahr>${year}</Zuflussjahr><LeistungsEmpfaenger><IdNr>${person}</IdNr></LeistungsEmpfaenger>${l}`);
}

describe("Vorschläge aus den ELSTER-Belegen (VaSt)", () => {
  it("2025: eine Lohnsteuerbescheinigung je Spalte der Anlage N, mit Cent wie bescheinigt; Rentenversicherung samt berufsständischer", () => {
    const b = lstb(2025, A, "1", {
      BruttoArbLohn: "48000.00",
      LSteuer: "7512.34",
      Soli: "0.00",
      ArbnKiSteuer: "601.00",
      ArbgAnteilRenVers: "4464.00",
      ArbnAnteilRenVers: "4464.00",
      ArbnAnteilBerufsVers: "10.50",
      ArbnAnteilKrankVers: "3912.00",
      ArbnAnteilPflegVers: "816.00",
      ArbnAnteilArblVers: "624.00",
    });
    const v = vastVorschlag({ year: 2025, idnr, belege: [b] });
    expect(v.arbeitnehmer.a).toEqual([
      {
        herkunft: b.id,
        bescheinigung: {
          steuerklasse: 1,
          brutto: 4_800_000,
          lohnsteuer: 751_234,
          kirchensteuer: 60_100,
          rvArbeitgeber: 446_400,
          rvArbeitnehmer: 447_450,
          kvArbeitnehmer: 391_200,
          pvArbeitnehmer: 81_600,
          avArbeitnehmer: 62_400,
        },
      },
    ]);
    expect(v.arbeitnehmer.b).toBeUndefined();
  });

  it("2024: zwei Arbeitgeber, Klasse 0 zählt wie 6; Kirchensteuer des Ehegatten nur neben der eigenen", () => {
    const erst = lstb(2024, A, "3", { BruttoArbLohn: "30000.00", ArbnKiSteuer: "100.00", EhegKiSteuer: "50.00" });
    const zweit = lstb(2024, A, "0", { BruttoArbLohn: "6000.00", EhegKiSteuer: "20.00" });
    const v = vastVorschlag({ year: 2024, idnr, belege: [erst, zweit] });
    expect(v.arbeitnehmer.a?.map((x) => x.bescheinigung)).toEqual([
      { steuerklasse: 3, brutto: 3_000_000, kirchensteuer: 10_000, kirchensteuerEhegatte: 5_000 },
      { steuerklasse: 6, brutto: 600_000 },
    ]);
  });

  it("2023: Zusammenveranlagung, Belege nach der IdNr der Person; steuerfreie Arbeitgeberzuschüsse je Person summiert und abgerundet", () => {
    const a = lstb(2023, A, "4", { BruttoArbLohn: "40000.00", StFreiGeKrankVers: "1200.40", StFreiGePflegVers: "300.99" });
    const a2 = lstb(2023, A, "6", { BruttoArbLohn: "2000.00", StFreiGeKrankVers: "100.40" });
    const b = lstb(2023, B, "4", { BruttoArbLohn: "35000.00", StFreiPrKrankVers: "2400.55" });
    const v = vastVorschlag({ year: 2023, idnr, belege: [a, b, a2] });
    expect(v.arbeitnehmer.a?.map((x) => x.bescheinigung.brutto)).toEqual([4_000_000, 200_000]);
    expect(v.arbeitnehmer.b?.map((x) => x.bescheinigung.brutto)).toEqual([3_500_000]);
    expect(v.vorsorge.a?.werte).toEqual({ agZuschussGkv: 130_000, agZuschussPv: 30_000 });
    expect(v.vorsorge.a?.herkunft.agZuschussGkv).toEqual([a.id, a2.id]);
    expect(v.vorsorge.b?.werte).toEqual({ agZuschussKv: 240_000 });
  });

  it("2022: gesetzliche Kranken- und Pflegeversicherung; Beiträge mit Krankengeld um 4 % gemindert (§ 10 Abs. 1 Nr. 3 Buchst. a Satz 4 EStG), aufgerundet", () => {
    const k = krv(2022, A, [
      ["01", "1", "1200.00"],
      ["02", "1", "4800.00"],
      ["05", "1", "1000.10"],
    ]);
    const v = vastVorschlag({ year: 2022, idnr, belege: [k] });
    // 1.200,00 + 4.800,00 − 192,00 = 5.808,00; Pflege 1.000,10 aufgerundet auf 1.001,00
    expect(v.vorsorge.a?.werte).toEqual({ gkv: 580_800, gkvZusatz: 19_200, gpv: 100_100 });
    expect(v.vorsorge.a?.herkunft.gkv).toEqual([k.id]);
  });

  it("2025: private Versicherung: Beiträge aufgerundet, Erstattungen abgerundet; gesetzliche Erstattungen haben kein Feld und stehen als Hinweis", () => {
    const k = krv(2025, A, [
      ["01", "2", "3600.20"],
      ["05", "2", "480.01"],
      ["06", "2", "300.99"],
      ["10", "2", "20.00"],
    ]);
    const g = krv(2025, B, [
      ["01", "1", "2400.00"],
      ["06", "1", "100.00"],
    ]);
    const v = vastVorschlag({ year: 2025, idnr, belege: [k, g] });
    expect(v.vorsorge.a?.werte).toEqual({ pkv: 360_100, ppv: 48_100, pkvErstattung: 32_000 });
    expect(v.vorsorge.b?.werte).toEqual({ gkv: 240_000 });
    expect(v.hinweise.join(" ")).toContain("Erstattungen der gesetzlichen Kranken- und Pflegeversicherung");
  });

  it("Kranken- und Pflegeversicherung: Beiträge Dritter zählen nur mit einer Firma als Versicherungsnehmer", () => {
    const dritte = krv(2025, A, [["01", "1", "1000.00"]], [{ idnr: A }], "1");
    const firma = krv(2025, A, [["01", "1", "500.00"]], [{ firma: "Nordwerk GmbH" }], "1");
    const v = vastVorschlag({ year: 2025, idnr, belege: [dritte, firma] });
    expect(v.vorsorge.a?.werte).toEqual({ gkv: 50_000 });
    expect(v.vorsorge.a?.herkunft.gkv).toEqual([firma.id]);
  });

  it("Basisrente über alle Verträge und Jahre des Belegs aufgerundet; über 99.999 € kein Vorschlag", () => {
    const r1 = rue(2024, A, ["1200.10"]);
    const r2 = rue(2024, A, ["300.00", "50.00"]);
    expect(vastVorschlag({ year: 2024, idnr, belege: [r1, r2] }).vorsorge.a?.werte).toEqual({ basisrente: 155_100 });
    const hoch = vastVorschlag({ year: 2024, idnr, belege: [rue(2024, A, ["100000.00"])] });
    expect(hoch.vorsorge.a).toBeUndefined();
    expect(hoch.hinweise.join(" ")).toContain("Basisrente");
  });

  it("Lohnersatzleistungen je Leistung abgerundet, Nullbeträge fallen weg; Art wie bescheinigt", () => {
    const l = lersl(2023, B, [
      ["Elterngeld", "5400.80"],
      ["Krankengeld", "0.00"],
      ["Arbeitslosengeld", "1234.56"],
    ]);
    const v = vastVorschlag({ year: 2023, idnr, belege: [l] });
    expect(v.ersatzleistungen.b).toEqual([
      { herkunft: [l.id], leistung: { art: "Elterngeld", betrag: 540_000 } },
      { herkunft: [l.id], leistung: { art: "Arbeitslosengeld", betrag: 123_400 } },
    ]);
  });

  it("übernimmt nie Testbelege, keine fremde Version und keine fremde IdNr; nennt jeweils den Grund", () => {
    const test = lstb(2025, A, "1", { BruttoArbLohn: "1000.00" }, { test: true });
    const alt = lstb(2025, A, "1", { BruttoArbLohn: "1000.00" }, { schemaversion: "202401" });
    const fremd = lstb(2025, "12345678901", "1", { BruttoArbLohn: "1000.00" });
    const v = vastVorschlag({ year: 2025, idnr, belege: [test, alt, fremd] });
    expect(v.arbeitnehmer).toEqual({});
    const text = v.hinweise.join(" ");
    expect(text).toContain("Testbeleg");
    expect(text).toContain("202401");
    expect(text).toContain("keiner Person");
  });

  it("2026 hat noch keine Zuordnung: kein Vorschlag, mit Hinweis", () => {
    const v = vastVorschlag({ year: 2026, idnr, belege: [lstb(2026, A, "1", { BruttoArbLohn: "1000.00" })] });
    expect(v.arbeitnehmer).toEqual({});
    expect(v.hinweise).toEqual(["Für 2026 gibt es noch keine amtliche Zuordnung der Belege; Haben schlägt nichts vor."]);
  });

  it("nennt Werte, die Haben noch nicht übernimmt: Lohnersatz in der Lohnsteuerbescheinigung, Zuschüsse nach § 10 Abs. 4b EStG, andere Belegarten", () => {
    const b = lstb(2025, A, "1", { BruttoArbLohn: "1000.00", LeistungenProgVorbeh: "500.00" });
    const z = zus(2025, A, [["04", "100.00"]]);
    const rbm = beleg("VaSt_RBM", "202501", "");
    const text = vastVorschlag({ year: 2025, idnr, belege: [b, z, rbm] }).hinweise.join(" ");
    expect(text).toContain("Lohnersatz");
    expect(text).toContain("§ 10 Abs. 4b EStG");
    expect(text).toContain("Rentenbezugsmitteilung");
    expect(text).toContain("Anteil an Kranken- und Pflegeversicherung");
  });

  // Aus der Selbstprüfung von #1954
  it("2025: Zuschüsse zur Basisrente (Zahlungsart 02/03) mindern sie, Rückforderungen (22/23) erhöhen sie (Berechne_E2000701)", () => {
    const r = rue(2025, A, ["2400.00"]);
    const z = zus(2025, A, [
      ["02", "500.00"],
      ["22", "100.00"],
    ]);
    const v = vastVorschlag({ year: 2025, idnr, belege: [r, z] });
    expect(v.vorsorge.a?.werte).toEqual({ basisrente: 200_000 });
    expect(v.vorsorge.a?.herkunft.basisrente).toEqual([r.id, z.id]);
    // Ohne Basisrentenvertrag zählt ein solcher Zuschuss hier nicht
    expect(vastVorschlag({ year: 2025, idnr, belege: [z] }).vorsorge.a).toBeUndefined();
  });

  it("2024: Kirchensteuer laut Lohnsteuerbescheinigung als gezahlte Kirchensteuer (Berechne_E0108004), beider Personen, mit Cent", () => {
    const a = lstb(2024, A, "4", { BruttoArbLohn: "40000.00", ArbnKiSteuer: "601.00", EhegKiSteuer: "50.00", KiSteuerArbnMKalJahr: "20.00" });
    const b = lstb(2024, B, "4", { BruttoArbLohn: "30000.00", ArbnKiSteuer: "100.10" });
    const v = vastVorschlag({ year: 2024, idnr, belege: [a, b] });
    expect(v.sonderausgaben).toEqual({ werte: { kirchensteuerGezahlt: 77_110 }, herkunft: { kirchensteuerGezahlt: [a.id, b.id] } });
  });

  it("2025: ohne die Felder für mehrere Kalenderjahre", () => {
    const a = lstb(2025, A, "1", { BruttoArbLohn: "40000.00", ArbnKiSteuer: "601.00", KiSteuerArbnMKalJahr: "20.00" });
    expect(vastVorschlag({ year: 2025, idnr, belege: [a] }).sonderausgaben?.werte).toEqual({ kirchensteuerGezahlt: 60_100 });
  });

  it("Versicherungsnehmer: erste IdNr über alle, Firma in irgendeinem; Beiträge Dritter zählen mit Firma auch neben der Person", () => {
    const k = krv(2025, A, [["01", "1", "800.00"]], [{ idnr: A }, { firma: "Nordwerk GmbH" }], "1");
    expect(vastVorschlag({ year: 2025, idnr, belege: [k] }).vorsorge.a?.werte).toEqual({ gkv: 80_000 });
  });

  it("Herkunft je Feld der Kranken- und Pflegeversicherung", () => {
    const k1 = krv(2025, A, [["01", "1", "1000.00"]]);
    const k2 = krv(2025, A, [["05", "1", "200.00"]]);
    const v = vastVorschlag({ year: 2025, idnr, belege: [k1, k2] });
    expect(v.vorsorge.a?.herkunft).toEqual({ gkv: [k1.id], gpv: [k2.id] });
  });

  it("Lohnsteuerbescheinigung ohne Steuerklasse: keine Spalte der Anlage N, die Zuschüsse zählen trotzdem", () => {
    const ohne = beleg(
      "VaSt_LStB",
      "202501",
      `<Allgemein><IdNr>${A}</IdNr></Allgemein><Besteuerungsgrund><BruttoArbLohn>1000.00</BruttoArbLohn><StFreiGeKrankVers>120.00</StFreiGeKrankVers></Besteuerungsgrund>`,
    );
    const v = vastVorschlag({ year: 2025, idnr, belege: [ohne] });
    expect(v.arbeitnehmer.a).toBeUndefined();
    expect(v.vorsorge.a?.werte).toEqual({ agZuschussGkv: 12_000 });
    expect(v.hinweise.join(" ")).toContain("ohne Steuerklasse");
  });

  it("Kranken- und Pflegeversicherung eines Kindes: Hinweis auf die Anlage Kind statt „keiner Person“", () => {
    const kind = krv(2025, "57286403713", [["01", "2", "600.00"]], [{ idnr: A }]);
    const text = vastVorschlag({ year: 2025, idnr, belege: [kind] }).hinweise.join(" ");
    expect(text).toContain("Kind");
    expect(text).not.toContain("keiner Person");
  });

  it("passt in die Angaben der Erklärung: buildEstXml schreibt die Werte in Anlage N, Vorsorgeaufwand und Hauptvordruck", () => {
    const v = vastVorschlag({
      year: 2025,
      idnr,
      belege: [
        lstb(2025, A, "1", { BruttoArbLohn: "48000.00", LSteuer: "7512.34", ArbnAnteilRenVers: "4464.00", ArbnAnteilKrankVers: "3912.00" }),
        krv(2025, B, [["01", "1", "2400.00"]]),
        rue(2025, A, ["1200.00"]),
        lersl(2025, B, [["Elterngeld", "5400.80"]]),
      ],
    });
    const xml = buildEstXml({
      year: 2025,
      steuernummer13: "2836216146249",
      bundesland: "BW",
      herstellerId: "74931",
      produktVersion: "0.1.0",
      test: true,
      personA: { idnr: A, vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", religion: "11", beruf: "Entwickler" },
      personB: { idnr: B, vorname: "Erika", name: "Muster", geburtsdatum: "1987-09-01", religion: "11", beruf: "" },
      verheiratetSeit: "2015-06-20",
      anschrift: { strasse: "Hauptstraße 12a", plz: "77815", ort: "Bühl" },
      iban: "DE89 3704 0044 0532 0130 00",
      angaben: {
        vorsorge: { a: v.vorsorge.a?.werte ?? {}, b: v.vorsorge.b?.werte ?? {} },
        sonderausgaben: {},
        haushaltsnah: {},
        kinder: [],
        arbeitnehmer: { a: { bescheinigungen: (v.arbeitnehmer.a ?? []).map((x) => x.bescheinigung), werbungskosten: {} } },
        ersatzleistungen: { b: (v.ersatzleistungen.b ?? []).map((x) => x.leistung) },
      },
    });
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toContain("<E0200204>48000,00</E0200204>");
    expect(xml).toContain("<E0200304>7512,34</E0200304>");
    expect(xml).toContain("<E2000701>1200</E2000701>");
    expect(xml).toContain("<E2001805>2400</E2001805>");
    expect(xml).toContain("<E0104110>Elterngeld</E0104110>");
    expect(xml).toContain("<E0104113>5400</E0104113>");
  });
});

// TDD-Review von #1954
describe("Vorschläge aus den ELSTER-Belegen: Review", () => {
  it("Kranken- und Pflegeversicherung des Ehegatten bei Einzelveranlagung, Person A Versicherungsnehmer: kein Hinweis auf ein Kind", () => {
    const ehegatte = krv(2025, B, [["01", "2", "600.00"]], [{ idnr: A }]);
    const text = vastVorschlag({ year: 2025, idnr: { a: A }, belege: [ehegatte] }).hinweise.join(" ");
    expect(text).not.toContain("für ein Kind");
  });

  it("Kirchensteuer: „nur ≥ 0“ gilt je Person (Berechne_E0108004), nicht für die Summe beider", () => {
    const a = lstb(2024, A, "4", { BruttoArbLohn: "40000.00", ArbnKiSteuer: "-50.00" });
    const b = lstb(2024, B, "4", { BruttoArbLohn: "30000.00", ArbnKiSteuer: "200.00" });
    expect(vastVorschlag({ year: 2024, idnr, belege: [a, b] }).sonderausgaben).toEqual({
      werte: { kirchensteuerGezahlt: 20_000 },
      herkunft: { kirchensteuerGezahlt: [b.id] },
    });
  });

  it("Lohnersatzleistungen über 20: Platz je Beleg, der erste Beleg ohne Platz trägt die Summe aus sich und den folgenden (Berechne_Platz_PersonA, Berechne_E0104113)", () => {
    const leistungen = (art: string, betrag: string, n: number) => Array.from({ length: n }, (_, i): [string, string] => [`${art} ${i + 1}`, betrag]);
    const l1 = lersl(2025, A, leistungen("Krankengeld", "100.00", 11));
    const l2 = lersl(2025, A, leistungen("Elterngeld", "10.60", 6));
    const l3 = lersl(2025, A, leistungen("Arbeitslosengeld", "1.25", 5));
    const e = vastVorschlag({ year: 2025, idnr, belege: [l1, l2, l3] }).ersatzleistungen.a ?? [];
    // 22 Leistungen: l1 (11) und l2 (17 bis dahin) haben Platz, l3 (22) nicht; 5 × 1,25 = 6,25, abgerundet 6
    expect(e).toHaveLength(18);
    expect(e.at(-1)).toEqual({ herkunft: [l3.id], leistung: { art: "Angabe aus Bescheinigungen", betrag: 600 } });
    // Bis 20 Leistungen hat jeder Beleg Platz
    expect(vastVorschlag({ year: 2025, idnr, belege: [l1, l2] }).ersatzleistungen.a).toHaveLength(17);
  });

  it("liest einen Beleg auch in der Hülle <Belege>", () => {
    const b = lstb(2025, A, "1", { BruttoArbLohn: "1000.00" });
    const gehuellt = { ...b, xml: `<Belege>${b.xml.replace(/^<\?xml[^>]*\?>/, "")}</Belege>` };
    expect(vastVorschlag({ year: 2025, idnr, belege: [gehuellt] }).arbeitnehmer.a?.[0]?.bescheinigung.brutto).toBe(100_000);
  });
});
