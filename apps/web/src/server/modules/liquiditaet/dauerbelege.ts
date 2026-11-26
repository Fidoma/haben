import {
  abziehbarerAnteil,
  abziehbareSteuer,
  dauerbelegFaellig,
  dauerbelegSummen,
  folgeTermin,
  splitPrivateShare,
  type BasisPoints,
  type Cents,
  type DauerbelegBetrag,
  type LiquiditaetsPosten,
  type Prozent,
  VOLLER_ABZUG,
} from "@haben/core";
import { listDauerbelege } from "../belege/index.ts";
import type { Kontext } from "./kontext.ts";

/*
 * Künftige Dauerbelege: aktive Vorlagen mit Zahlung „Bank“, je Termin bis zum Ende des Horizonts der Bruttobetrag zur
 * Fälligkeit (Termin plus Zahlungsziel), erwartet. Pausierte und beendete Vorlagen und solche mit Zahlung „privat“ oder
 * „Kasse“ fehlen. Ab `nextDate`: frühere Termine hat der Lauf schon als Beleg angelegt, gebucht stehen sie unter den
 * offenen Verbindlichkeiten.
 */

/**
 * Die Vorsteuer, die die Buchung des Belegs abziehen wird. Ein Beleg aus dem Lauf hat keinen eigenen Anteil, es gilt
 * `anteil` aus den Firmendaten (abziehbarerAnteil) am Termin.
 * - Zollbescheid: der ganze Betrag ist Vorsteuer (Kz 62), buchbar nur mit vollem Abzug und ohne Privatanteil
 *   (einfuhrumsatzsteuerPosting); einen Steuerausweis hat ein Bescheid nicht.
 * - Sonst nur mit ausgewiesener Steuer (§ 15 Abs. 1 Satz 1 Nr. 1 UStG): je Satz der private Teil gerundet und der
 *   betriebliche als Rest, davon der abziehbare Anteil (documentRatePosting in packages/core/src/document-posting.ts).
 */
function erwarteteVorsteuer(vorlage: { category: string; amounts: DauerbelegBetrag[]; privateShare: Prozent; taxShown: boolean }, anteil: BasisPoints): Cents {
  if (vorlage.category === "einfuhrumsatzsteuer") {
    return anteil === VOLLER_ABZUG && vorlage.privateShare === 0 ? dauerbelegSummen(vorlage.amounts).gross : 0;
  }
  if (!vorlage.taxShown) return 0;
  return vorlage.amounts.reduce((sum, a) => sum + abziehbareSteuer(splitPrivateShare(a.tax, vorlage.privateShare).business, anteil), 0);
}

/** Höchstens so viele Termine je Vorlage; zwölf Monate mit monatlichem Intervall brauchen 13 */
const HOECHSTENS_TERMINE = 60;

export async function dauerbelegPosten(k: Kontext): Promise<LiquiditaetsPosten[]> {
  const posten: LiquiditaetsPosten[] = [];
  for (const { vorlage } of await listDauerbelege()) {
    if (vorlage.status !== "aktiv" || vorlage.payment !== "bank") continue;
    const { gross } = dauerbelegSummen(vorlage.amounts);
    if (gross <= 0) continue;
    let termin = vorlage.nextDate;
    for (let i = 0; i < HOECHSTENS_TERMINE && termin <= k.bis && (!vorlage.endDate || termin <= vorlage.endDate); i++) {
      // Nach Belegdatum: Kleinunternehmer am Termin ziehen keine Vorsteuer ab
      const anteil = abziehbarerAnteil({ kleinunternehmer: k.kleinunternehmer(termin), ohneVorsteuerabzug: k.ohneVorsteuerabzug }, null);
      const vorsteuer = erwarteteVorsteuer(vorlage, anteil);
      posten.push({
        datum: dauerbelegFaellig(termin, vorlage.dueDays),
        betrag: gross,
        richtung: "aus",
        text: [vorlage.name, vorlage.supplierName].filter(Boolean).join(" · "),
        quelle: { art: "dauerbeleg", id: vorlage.id },
        sicherheit: "erwartet",
        ...(vorsteuer !== 0 ? { steuer: { betrag: -vorsteuer, datum: termin } } : {}),
      });
      termin = folgeTermin(termin, vorlage);
    }
  }
  return posten;
}
