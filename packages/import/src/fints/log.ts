/*
 * lib-fints 1.5.3 schreibt eine Antwort der Bank, die es nicht dekodieren kann, mit console.error ganz ins Log, auch mit
 * debugEnabled = false (dist/httpClient.js, sendMessage: „Response Message Content:“). Darin stehen Umsätze, Namen, IBANs,
 * BPD und UPD; ein Log landet schnell in einem Issue oder bei einem Log-Dienst. Haben lässt den Inhalt weg und behält
 * die Zeile davor mit dem Fehler von lib-fints. Der Logger der App (apps/web/src/server/log.ts) wendet die Funktion auf
 * jede Ausgabe von console.* an. Die Datei fällt weg, sobald lib-fints das nur noch im Debug-Log schreibt.
 */

/** Erstes Argument, mit dem lib-fints den Inhalt der Antwort ins Log schreibt */
const ANTWORT_IM_LOG = "Response Message Content:\n";

/** Argumente eines console-Aufrufs ohne den Inhalt unlesbarer Antworten der Bank */
export function ohneBankdaten(args: unknown[]): unknown[] {
  return args[0] === ANTWORT_IM_LOG ? ["FinTS: Inhalt der unlesbaren Antwort der Bank nicht ins Log geschrieben (Bankdaten)."] : args;
}
