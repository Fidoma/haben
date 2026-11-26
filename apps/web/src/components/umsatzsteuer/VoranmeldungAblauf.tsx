import { formatEuro } from "@haben/core";
import { formatDate } from "../../lib/format.ts";
import { Icon } from "../Icon.tsx";

const SCHRITTE = ["Zahlen prüfen", "Abgeben", "Zahlen"] as const;

type Schritt = 1 | 2 | 3;

/**
 * Der Satz über den Kennzahlen: was die Kennzahl 83 für dich heißt, immer ohne Vorzeichen. Eine Frist, die vorbei ist, steht nicht
 * mehr als „bis“ da, sondern als fällig gewesen. Bei Erstattung keine Frist, wie in `UstvaZahlung`. `heute` und `faellig` als ISO-Tag.
 */
export function ergebnisSatz(kz83: number, faellig: string, heute: string): string {
  if (kz83 > 0)
    return faellig < heute
      ? `Die Zahllast von ${formatEuro(kz83)} war am ${formatDate(faellig)} fällig.`
      : `Du zahlst ${formatEuro(kz83)} bis ${formatDate(faellig)}.`;
  if (kz83 < 0) return `Du bekommst ${formatEuro(Math.abs(kz83))} zurück, sobald das Finanzamt zustimmt.`;
  return "Diesmal ist nichts zu zahlen.";
}

/**
 * Wo die Voranmeldung im Ablauf steht, nur aus dem, was die Seite schon weiß: Zahlen prüfen, bis ein unveränderter Entwurf
 * gespeichert ist; dann abgeben; festgeschrieben bleibt das Zahlen, bis keine Zahllast mehr offen ist. Null: alles erledigt.
 */
export function ablaufSchritt({
  locked,
  gespeichert,
  geaendert,
  ausgeglichen,
}: {
  locked: boolean;
  gespeichert: boolean;
  /** Ungespeicherte Änderungen oder Buchungen, die sich seit dem Speichern geändert haben */
  geaendert: boolean;
  /** Die Posten dieser Anmeldung haben keine Zahllast mehr offen; eine offene Erstattung zählt nicht */
  ausgeglichen: boolean;
}): Schritt | null {
  if (locked) return ausgeglichen ? null : 3;
  return gespeichert && !geaendert ? 2 : 1;
}

/** Leiste „Zahlen prüfen · Abgeben · Zahlen“ mit dem Ergebnis darunter (#1253); erledigte Schritte tragen Haken und Wort, nicht nur Farbe */
export function VoranmeldungAblauf({ schritt, satz }: { schritt: Schritt | null; satz: string | null }) {
  return (
    <section className="card ablauf" aria-label="Ablauf der Voranmeldung">
      <ol className="ablauf-schritte">
        {SCHRITTE.map((name, index) => {
          const nummer = index + 1;
          const erledigt = schritt === null || nummer < schritt;
          return (
            <li key={name} aria-current={nummer === schritt ? "step" : undefined} className={erledigt ? "ablauf-erledigt" : undefined}>
              <span className="ablauf-marke" aria-hidden="true">
                {erledigt ? <Icon name="check" size={12} /> : nummer}
              </span>
              {name}
              {erledigt && <span className="visually-hidden"> (erledigt)</span>}
            </li>
          );
        })}
      </ol>
      {satz && <p className="ablauf-satz">{satz}</p>}
    </section>
  );
}
