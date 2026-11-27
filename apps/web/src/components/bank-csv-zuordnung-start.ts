import { type BankCsvFile, type BankCsvMapping, findSavedHeader, initialMapping } from "@haben/import/bank-zuordnung";

export type ZuordnungStart = { headerRow: number; mapping: BankCsvMapping; saved: boolean };

/**
 * Start-Zuordnung für den Dialog `BankCsvZuordnung`: Übernimmt ein nachträglich geladenes `csvMapping` am Konto
 * (etwa nach `router.invalidate()` direkt nach dem ersten Import), solange der Nutzer im Dialog noch nichts von Hand
 * geändert hat.
 */
export function zuordnungNachladen(
  bisher: ZuordnungStart | null,
  records: BankCsvFile["records"],
  stored: BankCsvMapping | null,
  bearbeitet: boolean,
): ZuordnungStart {
  if (bearbeitet && bisher) return bisher;
  if (bisher && (!stored || findSavedHeader(records, stored.header) < 0)) return bisher;
  return initialMapping(records, stored);
}
