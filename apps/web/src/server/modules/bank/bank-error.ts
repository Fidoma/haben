import { UserError } from "../../errors.ts";

/** Fehler des Bankmoduls, die die Person lesen soll; eigene Datei, damit kleine Teile ohne Datenbank sie nutzen können */
export class BankError extends UserError {}

/** Die Datei nennt kein Konto, das Haben selbst findet (keine IBAN, Export eines Dienstleisters, Amazon): die Person wählt es */
export class KontoWaehlenError extends BankError {}
