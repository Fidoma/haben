import type { Seller } from "@haben/einvoice";
import type { Db, Tx } from "../../db/index.ts";
import { bankverbindungNachIban, bankverbindungProblem, kontaktBankverbindung } from "../stammdaten/index.ts";

/**
 * Zahlungskonto eines Rechnungs- oder Angebotsentwurfs beim Speichern (#1887). Gewählt (auch null = Standard) gilt die
 * Wahl. Ohne Angabe, etwa über die API, bei Abo-Rechnungen oder Zeiteinträgen, bleibt das bisherige; ein neuer Entwurf
 * oder ein anderer Kunde bekommt das bevorzugte Zahlungskonto des Kontakts.
 */
export async function bankverbindungFuerEntwurf(
  tx: Tx,
  gewaehlt: string | null | undefined,
  contactId: string | null,
  bisher: { bankverbindungId: string | null; contactId: string | null } | null,
  fehler: (meldung: string) => Error,
): Promise<string | null> {
  if (gewaehlt !== undefined) {
    const problem = await bankverbindungProblem(tx, gewaehlt);
    if (problem) throw fehler(problem);
    return gewaehlt;
  }
  if (bisher && bisher.contactId === contactId) return bisher.bankverbindungId;
  return kontaktBankverbindung(tx, contactId);
}

/**
 * Zahlungskonto, das eine Kopie oder die Rechnung aus einem Angebot vom Original übernimmt. Ein Entwurf nennt es
 * selbst; ein festgeschriebener Beleg nur noch als Kopie im Verkäufer, gefunden über die IBAN. Gibt es das Konto nicht
 * mehr: undefined, dann gilt das bevorzugte Zahlungskonto des Kontakts.
 */
export async function uebernommeneBankverbindung(
  q: Db | Tx,
  original: { status: string; bankverbindungId: string | null; seller: Pick<Seller, "iban"> | null },
): Promise<string | null | undefined> {
  if (original.status !== "draft") return bankverbindungNachIban(q, original.seller?.iban);
  if (original.bankverbindungId === null) return null;
  return (await bankverbindungProblem(q, original.bankverbindungId)) === null ? original.bankverbindungId : undefined;
}
