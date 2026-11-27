import { finanzamtsnummer } from "@haben/core";
import { VORAUSZAHLUNG_QUARTALE, vorauszahlungJahre, type VorauszahlungQuartal } from "./vorauszahlung-zeitraum.ts";
import { elsterZeichen, NACHRICHT_TEXT_MAX, steuerpflichtigerXml, type NachrichtAbsender, type NachrichtPerson } from "./nachricht.ts";
import { checkSteuernummer13, ElsterEingabeError, elsterXml, escapeXml, TESTMERKER } from "./xml.ts";

export { naechsterTermin, VORAUSZAHLUNG_QUARTALE, vorauszahlungJahre, type VorauszahlungQuartal } from "./vorauszahlung-zeitraum.ts";

/**
 * Antrag auf Anpassung der Vorauszahlungen (Verfahren ElsterNachricht, Datenart AnpassungVorauszahlung, Version 22,
 * Eing_Vorauszlg-22.xsd der ERiC-Dokumentation 44.3.6.0; Echtfälle ab ERiC 43.5, ERiC-Releasenotes.pdf der Dokumentation 44.3.6.0, Kap. 6.1.4). Haben stellt
 * ihn nur für die Einkommensteuer (Steuerart 0030). Beträge kennt die Datenart nicht, sie stehen in der Begründung.
 * Mit einer Steuerart greifen die Regeln zu mehreren Zeilen nicht (eEing_136, 136b, 141), die Kirchensteuer in Bayern
 * auch nicht (eEing_129); das Quartal ist bei 0030 Pflicht (eEing_127).
 */

export interface VorauszahlungXmlInput {
  steuernummer13: string;
  /** Kürzel des Bundeslands, z. B. "BW" */
  bundesland: string;
  absender: NachrichtAbsender;
  person?: NachrichtPerson;
  telefon?: string;
  /** Ab welchem Quartal, oder nVz für die nachträgliche Vorauszahlung */
  quartal: VorauszahlungQuartal;
  jahr: number;
  begruendung: string;
  /** Heute (JJJJ-MM-TT) für die erlaubten Jahre */
  heute: string;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

export function buildVorauszahlungXml(input: VorauszahlungXmlInput): string {
  checkSteuernummer13(input.steuernummer13);
  const begruendung = elsterZeichen(input.begruendung.trim(), "Begründung");
  if (!begruendung || begruendung.length > NACHRICHT_TEXT_MAX) throw new ElsterEingabeError(`Die Begründung braucht 1 bis ${NACHRICHT_TEXT_MAX} Zeichen.`);
  if (!VORAUSZAHLUNG_QUARTALE.includes(input.quartal)) throw new ElsterEingabeError("Das Quartal ist ungültig.");
  const jahre = vorauszahlungJahre(input.heute);
  if (!jahre.includes(input.jahr)) throw new ElsterEingabeError(`Das Jahr muss zwischen ${jahre.at(-1)} und ${jahre[0]} liegen.`);
  const steuerpflichtiger = steuerpflichtigerXml(input.absender, input.person, input.telefon);
  return elsterXml(
    {
      verfahren: "ElsterNachricht",
      datenArt: "AnpassungVorauszahlung",
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
          `<Vorauszahlung xmlns="http://finkonsens.de/elster/elsternachricht/anpassungvorauszahlung/v22" version="22">`,
          `<Steuernummer>${input.steuernummer13}</Steuernummer>`,
          `<Begruendung>${escapeXml(begruendung)}</Begruendung>`,
          ...steuerpflichtiger,
          `<AntragFuerSteuerartZeitraum>`,
          `<Steuerart>0030</Steuerart>`,
          `<Quartal>${input.quartal}</Quartal>`,
          `<Jahr>${input.jahr}</Jahr>`,
          `</AntragFuerSteuerartZeitraum>`,
          `</Vorauszahlung>`,
        ],
      },
    ],
  );
}
