/* Quelle eines Konflikts im Abruf (#306) und ihre Texte in der Klärung; ohne Serverfunktionen, damit Tests sie laden können */
import { PAYMENT_PROVIDERS, type PaymentProvider } from "@haben/core";
import { isInternalProvider } from "@haben/import/anbieter";

type QuelleTexte = { wer: string; von: string; angaben: string; abruf: string };

/** Wer liefert: der Bankabruf (Bank › Automatischer Abruf), der Abruf von Etsy oder eines Zahlungsdienstleisters, oder ein Dienst über den REST-Import */
const QUELLEN = {
  bank: { wer: "Die Bank", von: "von der Bank", angaben: "der Bank", abruf: "aus dem Abruf dieses Kontos" },
  etsy: { wer: "Etsy", von: "von Etsy", angaben: "von Etsy", abruf: "aus dem Etsy-Abruf" },
  extern: { wer: "Der Dienst", von: "vom Dienst", angaben: "des Dienstes", abruf: "aus dieser Quelle" },
} as const satisfies Record<string, QuelleTexte>;

export type Quelle = keyof typeof QUELLEN | PaymentProvider;

/** Texte zur Quelle; ein Zahlungsdienstleister mit Abruf heißt wie in PAYMENT_PROVIDERS, ohne eigenen Eintrag hier */
export function quelleTexte(quelle: Quelle): QuelleTexte {
  if (quelle === "bank" || quelle === "etsy" || quelle === "extern") return QUELLEN[quelle];
  const name = PAYMENT_PROVIDERS[quelle].label;
  return { wer: name, von: `von ${name}`, angaben: `von ${name}`, abruf: `aus dem ${name}-Abruf` };
}

/** Quelle zum Anbieter einer Quellenbindung (`import_sources.provider`): Etsy und die Zahlungsdienstleister mit eigenem Namen, übrige interne sind Bankabrufe */
export function quelleZuAnbieter(provider: string): Quelle {
  if (!isInternalProvider(provider)) return "extern";
  if (provider === "etsy") return "etsy";
  return Object.hasOwn(PAYMENT_PROVIDERS, provider) ? (provider as PaymentProvider) : "bank";
}
