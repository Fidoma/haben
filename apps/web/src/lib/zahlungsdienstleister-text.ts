import { formatDate } from "./format.ts";

/* Texte der Karte Zahlungsdienstleister (#1729), ohne Serverfunktionen, damit Tests sie laden können */

const UND = new Intl.ListFormat("de-DE", { type: "conjunction" });

/** „Stripe und PayPal“, ab drei Anbietern „Stripe, PayPal und Mollie“ */
export const anbieterAufzaehlung = (namen: string[]) => UND.format(namen);

/** Ablauf des Zugangs als Tag in Deutschland; ein Zeitpunkt kurz vor Mitternacht UTC ist dort schon der nächste Tag */
export const zugangGueltigBisText = (bis: Date) => ` Der Zugang gilt bis ${formatDate(bis)}.`;
