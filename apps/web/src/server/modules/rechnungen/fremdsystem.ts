import { z } from "zod";

/** Herkunft der aus einem Fremdsystem übernommenen Rechnungen und Stornos in der externen Referenz (zusammen mit der Nummer eindeutig) */
export const FREMDSYSTEM = "fremdsystem";

/** Das Original muss ein PDF sein; die Kennung steht in den ersten Bytes */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");
}

/** Nummer aus dem Fremdsystem; sie bleibt unverändert und wird Teil von Dateinamen und Buchungstexten */
export const fremdNummerSchema = z
  .string()
  .trim()
  .min(1, "Rechnungsnummer fehlt")
  .max(100)
  .regex(/^[^\p{Cc}/\x5c]+$/u, "Rechnungsnummer ohne Steuerzeichen, Schrägstrich und Rückstrich");
