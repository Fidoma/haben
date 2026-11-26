/*
 * Zahlungsdienstleister: Abruf über die API ins Konto des Dienstleisters, gemeinsam für alle Anbieter mit Adapter (#1729;
 * Stripe #1280, PayPal #1512).
 *
 * Öffentliche Schnittstelle des Moduls: Andere Module, Server Functions und Routen importieren nur von hier
 * (Modulgrenzen, scripts/modulgrenzen/regel.ts).
 */
export { ANBIETER, adapterFuer } from "./anbieter.ts";
export { abrufen, type AbrufErgebnis, runDuePspSyncs, syncActor, type Zeitplanergebnis } from "./abruf.ts";
export { PayPalError, setPayPalClientFactory } from "./paypal.ts";
export { RHYTHMEN, type Rhythmus } from "./regeln.ts";
export { setStripeClientFactory, StripeError } from "./stripe.ts";
export {
  alleVerbindungen,
  entferneVerbindung,
  ladeVerbindung,
  speichereVerbindung,
  verbindungenUebersicht,
  verbindungSchema,
  ZahlungsdienstleisterError,
  zugangPruefen,
} from "./verbindungen.ts";
