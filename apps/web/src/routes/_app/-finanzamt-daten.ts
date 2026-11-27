import { formatEuro } from "@haben/core";
import type { VorauszahlungQuartal } from "@haben/elster/vorauszahlung-zeitraum";
import { formatZeitraumAbJahresanfang } from "../../lib/format.ts";
import type { getFinanzamt } from "../../server/functions/finanzamt.ts";

export type Data = Awaited<ReturnType<typeof getFinanzamt>> & { today: string };

/** Zahlen für die Herabsetzung; nur im Einzelunternehmen, eine GmbH oder UG hat keine Einkommensteuer-Vorauszahlungen */
export type Basis = NonNullable<Data["basis"]>;

export type Topic = "vorauszahlung" | "nachricht";

export type SendResult = { ok: boolean; code: number; message: string; transferTicket: string | null };

/** Status im Verlauf */
export const STATUS_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Gesendet" } as const;

export const TOPIC_LABEL = { vorauszahlung: "Herabsetzung der Vorauszahlungen", nachricht: "Nachricht", bankverbindung: "Bankverbindung ändern" } as const;

export const DATENART_LABEL: Record<string, string> = {
  ESB: "Steuerbescheid (Daten)",
  EPMitteilung: "Mitteilung",
  DivaBescheidESt: "Einkommensteuerbescheid",
  DivaBescheidUSt: "Umsatzsteuerbescheid",
  DivaBescheidGewSt: "Gewerbesteuer-Messbescheid",
  DivaBescheidKSt: "Körperschaftsteuerbescheid",
  DivaBescheidFEIN: "Feststellungsbescheid",
  DivaSonstigerVA: "Sonstiger Bescheid",
};

/**
 * Hinweis im Reiter „Vorauszahlungen herabsetzen“, wenn die Person angegeben hat, dass nichts festgesetzt ist (#1287).
 * Ein Herabsetzungsantrag setzt eine Festsetzung durch Vorauszahlungsbescheid voraus und ändert sie anschließend
 * (§ 37 Abs. 3 Satz 1 und 3 EStG, https://www.gesetze-im-internet.de/estg/__37.html); ohne Bescheid ist der Antrag
 * gegenstandslos.
 * Der Antrag bleibt verfügbar: Der Haken ist eine Angabe der Person, kein Bescheid. Wer ihn zu Unrecht gesetzt hat,
 * kommt so weiterhin zum Antrag; wer wirklich nichts festgesetzt hat, spart sich einen gegenstandslosen Brief.
 */
export function vorauszahlungHinweis(keineVorauszahlungen: boolean): string | null {
  if (!keineVorauszahlungen) return null;
  return (
    "Nach deinen Angaben sind keine Vorauszahlungen festgesetzt. Ein Herabsetzungsantrag ist dann gegenstandslos, " +
    "es sei denn, das Finanzamt hat inzwischen wieder etwas festgesetzt. Die Angabe steht unter Einstellungen › Persönliche Angaben."
  );
}

/** Fälligkeit je Quartal (§ 37 Abs. 1 EStG) */
const FAELLIG = { Q1: "10.3.", Q2: "10.6.", Q3: "10.9.", Q4: "10.12." } as const;

export const QUARTAL_LABEL: Record<VorauszahlungQuartal, string> = {
  Q1: `1. Quartal (fällig ${FAELLIG.Q1})`,
  Q2: `2. Quartal (fällig ${FAELLIG.Q2})`,
  Q3: `3. Quartal (fällig ${FAELLIG.Q3})`,
  Q4: `4. Quartal (fällig ${FAELLIG.Q4})`,
  nVz: "Nachträgliche Vorauszahlung",
};

/** Ab wann der Antrag gilt, als Teil des Satzes „die Vorauszahlungen … herabzusetzen“ */
function antragZeitraum(quartal: VorauszahlungQuartal, jahr: number): string {
  return quartal === "nVz"
    ? `die nachträgliche Vorauszahlung zur Einkommensteuer für ${jahr}`
    : `die Vorauszahlungen zur Einkommensteuer für ${jahr} ab dem ${quartal.slice(1)}. Quartal (fällig ${FAELLIG[quartal]}${jahr})`;
}

/** Begründung des Antrags nach § 37 Abs. 3 EStG mit den Zahlen aus der Buchhaltung */
export function prepaymentLetter(
  data: Data,
  b: Basis,
  zeitraum: { quartal: VorauszahlungQuartal; jahr: number },
  current: number | null,
  wanted: number | null,
  reason: string,
  usePrognose: boolean,
): string {
  const art = b.einkunftsart === "gewerbe" ? "Gewerbebetrieb" : "selbständiger Arbeit";
  const lines = [
    "Sehr geehrte Damen und Herren,",
    "",
    `hiermit beantrage ich, ${antragZeitraum(zeitraum.quartal, zeitraum.jahr)}` +
      (wanted !== null && zeitraum.quartal !== "nVz" ? ` auf ${formatEuro(wanted)} je Quartal` : "") +
      " herabzusetzen (§ 37 Abs. 3 EStG).",
    "",
    `Mein Gewinn aus ${art} beträgt nach meiner Buchführung für ${formatZeitraumAbJahresanfang(b.until)} ${formatEuro(b.profitSoFar)}. ` +
      `Auf das Jahr ${b.year} hochgerechnet erwarte ich einen Gewinn von rund ${formatEuro(b.profitForecast)} (${b.year - 1}: ${formatEuro(b.profitLastYear)}).` +
      (current !== null ? ` Die bisher festgesetzten Vorauszahlungen von ${formatEuro(current)} je Quartal sind deshalb zu hoch.` : ""),
    ...(usePrognose
      ? [
          "",
          `Nach meiner Berechnung ergibt sich daraus nach Abzug der Vorsorgeaufwendungen und Sonderausgaben eine voraussichtliche ` +
            `Einkommensteuer ${b.year} von ${formatEuro(b.prognose.einkommensteuer)}` +
            (b.prognose.soli || b.prognose.kirchensteuer
              ? ` zuzüglich ${[b.prognose.soli ? `${formatEuro(b.prognose.soli)} Solidaritätszuschlag` : "", b.prognose.kirchensteuer ? `${formatEuro(b.prognose.kirchensteuer)} Kirchensteuer` : ""].filter(Boolean).join(" und ")}`
              : "") +
            ".",
        ]
      : []),
    ...(reason.trim() ? ["", reason.trim()] : []),
    "",
    "Eine Gewinnermittlung für den bisherigen Zeitraum reiche ich auf Anforderung gerne nach.",
    "",
    "Mit freundlichen Grüßen",
    data.company.name,
  ];
  return lines.join("\n");
}
