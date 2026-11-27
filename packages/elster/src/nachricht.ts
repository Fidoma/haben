import { finanzamtsnummer } from "@haben/core";
import { checkSteuernummer13, ElsterEingabeError, elsterXml, escapeXml, TESTMERKER } from "./xml.ts";
import { ungueltigesZeichen, zeichenErsetzen } from "./zeichensatz.ts";

/**
 * Sonstige Nachricht an das Finanzamt (Verfahren ElsterNachricht, Datenart SonstigeNachrichten,
 * Version 22). Aufbau wie bei viking, das damit an ELSTER sendet. Version 22 gleicht Version 21 bis auf den
 * Namensraum (Schemas im ERiC-Paket 43.4.6.0); ERiC 45 kennt Version 21 nicht mehr, Echtfälle mit Version 22
 * nimmt ERiC ab 43.5 an (ERiC-Releasenotes 45.1, Kap. 3.1.2 und 7.1.4).
 */
export const NACHRICHT_BETREFF_MAX = 99;
export const NACHRICHT_TEXT_MAX = 15_000;

export interface NachrichtAbsender {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
}

/** Inhaber als natürliche Person; ohne Angabe geht die Nachricht unter dem Firmennamen als nicht natürliche Person */
export interface NachrichtPerson {
  idnr: string;
  vorname: string;
  name: string;
}

export interface NachrichtXmlInput {
  steuernummer13: string;
  /** Kürzel des Bundeslands, z. B. "BW" */
  bundesland: string;
  absender: NachrichtAbsender;
  person?: NachrichtPerson;
  betreff: string;
  text: string;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

/**
 * "Hauptstraße 12a" → Straße, Hausnummer (nur Ziffern, so verlangen es die ELSTER-Schemas) und Zusatz ("a", "-14").
 */
export function splitStrasse(strasse: string): { strasse: string; hausnummer: string; zusatz?: string } | null {
  const match = /^(.*?)\s*(\d+)(\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/.exec(strasse.trim());
  if (!match?.[1] || !match[2]) return null;
  const zusatz = match[3]!.replace(/\s+/g, "").replace(/^-(?=[a-zA-Z])/, "");
  return { strasse: match[1].replace(/,$/, "").trim(), hausnummer: match[2], ...(zusatz ? { zusatz } : {}) };
}

export function buildNachrichtXml(input: NachrichtXmlInput): string {
  checkSteuernummer13(input.steuernummer13);
  const betreff = elsterZeichen(input.betreff.trim(), "Betreff");
  const text = elsterZeichen(input.text.trim(), "Text");
  if (!betreff || betreff.length > NACHRICHT_BETREFF_MAX) throw new ElsterEingabeError(`Der Betreff braucht 1 bis ${NACHRICHT_BETREFF_MAX} Zeichen.`);
  if (!text || text.length > NACHRICHT_TEXT_MAX) throw new ElsterEingabeError(`Der Text braucht 1 bis ${NACHRICHT_TEXT_MAX} Zeichen.`);
  const steuerpflichtiger = steuerpflichtigerXml(input.absender, input.person);
  const e = escapeXml;
  return elsterXml(
    {
      verfahren: "ElsterNachricht",
      datenArt: "SonstigeNachrichten",
      testmerker: input.test ? TESTMERKER : undefined,
      ziel: input.bundesland,
      herstellerId: input.herstellerId,
      datenlieferant: input.absender.name,
    },
    [
      {
        ticket: "1",
        empfaenger: { id: "F", wert: finanzamtsnummer(input.steuernummer13) },
        produktVersion: input.produktVersion,
        nutzdaten: [
          `<Nachricht xmlns="http://finkonsens.de/elster/elsternachricht/sonstigenachrichten/v22" version="22">`,
          `<Steuernummer>${input.steuernummer13}</Steuernummer>`,
          ...steuerpflichtiger,
          `<Inhalt>`,
          `<Betreff>${e(betreff)}</Betreff>`,
          `<Text>${e(text)}</Text>`,
          `</Inhalt>`,
          `</Nachricht>`,
        ],
      },
    ],
  );
}

/**
 * Element Steuerpflichtiger, gleich aufgebaut in SonstigeNachrichten v22 und AnpassungVorauszahlung v22
 * (Eing_sonstNachr-22.xsd, Eing_Vorauszlg-22.xsd): Typ, IdNr nur bei natürlichen Personen, Name, Vorname, Telefon,
 * inländische Anschrift. Telefon nur, wenn die Datenart es kennt und die Nummer das Muster [0-9+-/] mit höchstens
 * 20 Zeichen erfüllt.
 */
export function steuerpflichtigerXml(absender: NachrichtAbsender, person: NachrichtPerson | undefined, telefon?: string): string[] {
  const adresse = splitStrasse(elsterZeichen(absender.strasse, "Straße"));
  if (!adresse) throw new ElsterEingabeError("In der Anschrift fehlt die Hausnummer.");
  const e = (text: string) => escapeXml(elsterZeichen(text, "Anschrift und Name"));
  // Höchstens 72 Zeichen erst nach dem Ersetzen: aus „…“ werden drei
  const name = (text: string) => escapeXml(elsterZeichen(text, "Name").slice(0, 72));
  // „+49 (0)941 …“: die 0 in Klammern gehört nicht zur internationalen Nummer
  const nummer = telefon?.replace(/\(0\)/g, "").replace(/[\s()]/g, "") ?? "";
  return [
    `<Steuerpflichtiger>`,
    ...(person
      ? [
          `<SteuerpflichtigerTyp>NatPerson</SteuerpflichtigerTyp>`,
          `<IdNr>${e(person.idnr)}</IdNr>`,
          `<Name>${name(person.name)}</Name>`,
          `<Vorname>${name(person.vorname)}</Vorname>`,
        ]
      : [`<SteuerpflichtigerTyp>NichtNatPerson</SteuerpflichtigerTyp>`, `<Name>${name(absender.name)}</Name>`]),
    ...(/^[0-9+\-/]{1,20}$/.test(nummer) ? [`<Telefon>${nummer}</Telefon>`] : []),
    `<Adresse>`,
    `<StrAdrInl>`,
    `<Strasse>${e(adresse.strasse)}</Strasse>`,
    `<Hausnummer>${e(adresse.hausnummer)}</Hausnummer>`,
    ...(adresse.zusatz ? [`<Hausnummernzusatz>${e(adresse.zusatz)}</Hausnummernzusatz>`] : []),
    `<Postleitzahl>${e(absender.plz)}</Postleitzahl>`,
    `<Ort>${e(absender.ort)}</Ort>`,
    `</StrAdrInl>`,
    `</Adresse>`,
    `</Steuerpflichtiger>`,
  ];
}

/** Text im Zeichensatz der Nachrichten: typografische Zeichen ersetzt, andere Zeichen außerhalb mit Feld abgelehnt */
export function elsterZeichen(text: string, feld: string): string {
  const ersetzt = zeichenErsetzen(text);
  const falsch = ungueltigesZeichen(ersetzt);
  if (falsch) throw new ElsterEingabeError(`${feld}: Das Zeichen „${falsch}“ nimmt ELSTER nicht an.`);
  return ersetzt;
}
