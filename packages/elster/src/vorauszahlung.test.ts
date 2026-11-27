import { describe, expect, it } from "vitest";
import { checkXml } from "./fake-client.ts";
import { buildVorauszahlungXml, vorauszahlungJahre } from "./vorauszahlung.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

const input = {
  steuernummer13: "2893081508152",
  bundesland: "BW",
  absender: { name: "Mustermann IT · Max Mustermann", strasse: "Hauptstraße 12a", plz: "70173", ort: "Stuttgart" },
  quartal: "Q4" as const,
  jahr: 2026,
  begruendung: "Sehr geehrte Damen und Herren,\nGewinn 01.01.2026–27.11.2026: 12.000,00 €.",
  heute: "2026-11-27",
  herstellerId: "74931",
  produktVersion: "0.1.0",
  test: true,
};

/** Nutzdaten ohne die Zeilenumbrüche zwischen den Elementen, die elsterXml einfügt */
const nutzdaten = (xml: string) =>
  xml
    .slice(xml.indexOf("<Nutzdaten>") + "<Nutzdaten>".length, xml.indexOf("</Nutzdaten>"))
    .trim()
    .replace(/>\n</g, "><");

describe("Antrag auf Anpassung der Vorauszahlungen (AnpassungVorauszahlung v22)", () => {
  it("baut Kopf und Nutzdaten in der Reihenfolge von Eing_Vorauszlg-22.xsd", () => {
    const xml = buildVorauszahlungXml(input);
    expect(checkXml(xml)).toBeUndefined();
    expect(xml).toContain("<Verfahren>ElsterNachricht</Verfahren>");
    expect(xml).toContain("<DatenArt>AnpassungVorauszahlung</DatenArt>");
    expect(xml).toContain(`<Empfaenger id="F">2893</Empfaenger>`);
    expect(datenartVersionFromXml(xml)).toBe("AnpassungVorauszahlung_22");
    expect(hasTestmerker(xml)).toBe(true);
    expect(hasTestmerker(buildVorauszahlungXml({ ...input, test: false }))).toBe(false);
    expect(nutzdaten(xml)).toBe(
      [
        `<Vorauszahlung xmlns="http://finkonsens.de/elster/elsternachricht/anpassungvorauszahlung/v22" version="22">`,
        "<Steuernummer>2893081508152</Steuernummer>",
        "<Begruendung>Sehr geehrte Damen und Herren,\nGewinn 01.01.2026-27.11.2026: 12.000,00 €.</Begruendung>",
        "<Steuerpflichtiger><SteuerpflichtigerTyp>NichtNatPerson</SteuerpflichtigerTyp><Name>Mustermann IT - Max Mustermann</Name>",
        "<Adresse><StrAdrInl><Strasse>Hauptstraße</Strasse><Hausnummer>12</Hausnummer><Hausnummernzusatz>a</Hausnummernzusatz>",
        "<Postleitzahl>70173</Postleitzahl><Ort>Stuttgart</Ort></StrAdrInl></Adresse></Steuerpflichtiger>",
        "<AntragFuerSteuerartZeitraum><Steuerart>0030</Steuerart><Quartal>Q4</Quartal><Jahr>2026</Jahr></AntragFuerSteuerartZeitraum>",
        "</Vorauszahlung>",
      ].join(""),
    );
  });

  it("Kopf: DatenLieferant im Zeichensatz des TransferHeaders (th000011_extern.xsd)", () => {
    expect(buildVorauszahlungXml(input)).toContain("<DatenLieferant>Mustermann IT - Max Mustermann</DatenLieferant>");
  });

  it("stellt ihn als natürliche Person mit IdNr und Telefon", () => {
    const xml = nutzdaten(
      buildVorauszahlungXml({
        ...input,
        person: { idnr: "86095742719", vorname: "Max", name: "Mustermann" },
        telefon: "+49 (941) 123-456",
        quartal: "nVz",
        jahr: 2024,
      }),
    );
    expect(xml).toContain(
      "<SteuerpflichtigerTyp>NatPerson</SteuerpflichtigerTyp><IdNr>86095742719</IdNr><Name>Mustermann</Name><Vorname>Max</Vorname><Telefon>+49941123-456</Telefon><Adresse>",
    );
    expect(xml).toContain("<Quartal>nVz</Quartal><Jahr>2024</Jahr>");
  });

  it("Zeichensatz: zerlegte Umlaute (NFD), weicher Trennstrich und Null-Breite-Leerzeichen aus kopiertem Text (Review #1987)", () => {
    const zerlegt = "Gewinn laut Bescheid von Herrn Mu\u0308ller";
    expect(buildVorauszahlungXml({ ...input, begruendung: zerlegt })).toContain("<Begruendung>Gewinn laut Bescheid von Herrn Müller</Begruendung>");
    expect(buildVorauszahlungXml({ ...input, begruendung: "Vorauszahlungs\u00adbescheid vom\u200b 10.03." })).toContain(
      "<Begruendung>Vorauszahlungsbescheid vom 10.03.</Begruendung>",
    );
    // Im Kopf steht der Firmenname auch dann, wenn als natürliche Person gesendet wird
    expect(buildVorauszahlungXml({ ...input, absender: { ...input.absender, name: "Mu\u0308ller IT" } })).toContain(
      "<DatenLieferant>Müller IT</DatenLieferant>",
    );
  });

  it("Telefon: „(0)“ nach der Landesvorwahl fällt weg (Review #1987)", () => {
    expect(buildVorauszahlungXml({ ...input, telefon: "+49 (0)941 123456" })).toContain("<Telefon>+49941123456</Telefon>");
  });

  it("Name: erst ersetzen, dann auf 72 Zeichen kürzen (Review #1987)", () => {
    const name = `${"x".repeat(70)}…`;
    expect(buildVorauszahlungXml({ ...input, absender: { ...input.absender, name } })).toContain(`<Name>${"x".repeat(70)}..</Name>`);
  });

  it("lässt eine Telefonnummer weg, die nicht ins Muster passt", () => {
    expect(nutzdaten(buildVorauszahlungXml({ ...input, telefon: "0941 123456 Durchwahl 7" }))).not.toContain("<Telefon>");
    expect(nutzdaten(buildVorauszahlungXml({ ...input, telefon: "+49 941 1234567890123456" }))).not.toContain("<Telefon>");
  });

  it("nimmt nur Jahre an, die ELSTER erlaubt (eEing_144), und prüft die Begründung", () => {
    expect(vorauszahlungJahre("2026-11-27")).toEqual([2027, 2026, 2025, 2024, 2023]);
    expect(() => buildVorauszahlungXml({ ...input, jahr: 2022 })).toThrow("Das Jahr muss zwischen 2023 und 2027 liegen.");
    expect(() => buildVorauszahlungXml({ ...input, jahr: 2028 })).toThrow(/2023 und 2027/);
    expect(() => buildVorauszahlungXml({ ...input, begruendung: " " })).toThrow(/Begründung/);
    expect(() => buildVorauszahlungXml({ ...input, begruendung: "x".repeat(15_001) })).toThrow(/Begründung/);
    expect(() => buildVorauszahlungXml({ ...input, begruendung: "Danke 🙂" })).toThrow("Begründung: Das Zeichen „🙂“ nimmt ELSTER nicht an.");
    expect(() => buildVorauszahlungXml({ ...input, quartal: "Q5" as never })).toThrow(/Quartal/);
    expect(() => buildVorauszahlungXml({ ...input, absender: { ...input.absender, strasse: "Am Markt" } })).toThrow(/Hausnummer/);
  });
});
