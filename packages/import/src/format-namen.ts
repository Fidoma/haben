/* Ohne Abhängigkeiten, damit auch die Oberfläche es laden kann (Einstieg @haben/import/format-namen). */
import type { StatementFormat } from "./types.ts";

/**
 * Name der Quelle je Format, für Meldungen und die Kontenliste der Bankseite. Gleicher Name heißt gleiche Quelle beim Wechsel
 * (quellenHinweis in apps/web, modules/bank/quellen.ts). Als `Record<StatementFormat, …>` meldet tsc ein neues Format, das hier fehlt.
 */
export const FORMAT_NAMEN: Record<StatementFormat, string> = {
  "dkb-csv": "DKB",
  "dkb-csv-alt": "DKB",
  "n26-csv": "N26",
  "swan-csv": "Swan",
  "commerzbank-csv": "Commerzbank",
  "bw-bank-csv": "BW-Bank",
  "ing-csv": "ING",
  "c24-csv": "C24",
  "deutsche-bank-group-csv": "Deutsche Bank",
  "csv-zuordnung": "CSV mit eigener Zuordnung",
  camt053: "CAMT.053",
  enablebanking: "Bankabruf",
  fints: "FinTS-Abruf",
  "accountable-xlsx": "Accountable",
  "paypal-csv": "PayPal",
  "paypal-api": "PayPal (Abruf)",
  "stripe-csv": "Stripe",
  "stripe-api": "Stripe (Abruf)",
  "shopify-payments-csv": "Shopify",
  "ebay-csv": "eBay",
  "amazon-settlement": "Amazon",
  "etsy-csv": "Etsy",
  // Bewusst ein anderer Name als beim CSV-Import: Wer von der CSV auf den Abruf wechselt, wechselt die Quelle
  "etsy-ledger": "Etsy Payments (Abruf)",
  "googleplay-earnings": "Google Play",
  "appstore-finance": "App Store",
  "store-payout": "Store-Auszahlung",
  importvertrag: "REST-Import",
  "importvertrag-psp": "REST-Import",
};
