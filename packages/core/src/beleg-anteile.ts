import { splitPrivateShare, type Cents, type Prozent } from "./money.ts";

/*
 * Die Anteile eines Belegs an einer Stelle (#1975).
 *
 * Ob ein Betrag eines Belegs betrieblich ist oder zur Entnahme gehört, kam bisher an vielen Stellen aus derselben
 * Prozentrechnung auf `documents.private_share`, je Stelle als eigene Fassung: `splitPrivateShare(x, p).business`,
 * `geschaeftlich()` in vorsteuer-anteile.ts, `business()` in vorsteuer-belege.ts, `privatJeErwerbssatz()` in
 * alte-belegbuchung.ts. Hier steht die Rechnung einmal. Wer den Anteil eines Betrags am Beleg braucht, nimmt diese
 * Funktionen statt selbst zu rechnen.
 *
 * Gerundet wird der private Teil, der betriebliche ist die Differenz (splitPrivateShare in money.ts): Beide zusammen
 * ergeben centgenau den Ausgangsbetrag, und der gerundete Betrag ist der, dessen Prozentsatz in der Beschreibung steht.
 * Ein Privatanteil ist eine Entnahme (§ 4 Abs. 1 Satz 2, § 12 Nr. 1 EStG), keine Betriebsausgabe, und trägt keine
 * abziehbare Vorsteuer: § 15 Abs. 1 Satz 1 Nr. 1 UStG verlangt die betriebliche Verwendung.
 */

/** Betrieblicher und privater Teil eines Betrags am Beleg, wie beim Buchen gerundet */
export function belegAnteile(betrag: Cents, privateShare: Prozent): { business: Cents; private: Cents } {
  return splitPrivateShare(betrag, privateShare);
}

/** Der betriebliche Teil: Aufwand und, soweit abziehbar, Vorsteuer */
export function betrieblicherAnteil(betrag: Cents, privateShare: Prozent): Cents {
  return privateShare === 0 ? betrag : splitPrivateShare(betrag, privateShare).business;
}

/** Der private Teil: Entnahme, brutto auf das Entnahmekonto, ohne Vorsteuer */
export function privaterAnteil(betrag: Cents, privateShare: Prozent): Cents {
  return privateShare === 0 ? 0 : splitPrivateShare(betrag, privateShare).private;
}

/**
 * Ob der Beleg überhaupt einen privaten Anteil trägt; die Sperren (Skonto) fragen so danach.
 * Die Spalte ist auf 0 bis 100 begrenzt (`documents_private_share_range`), deshalb ist das dasselbe wie `> 0`.
 */
export function hatPrivatanteil(privateShare: Prozent | null | undefined): boolean {
  return (privateShare ?? 0) !== 0;
}
