import { normalizeTelefon, parsePersonenkonto, telefonProblem } from "@haben/core";
import { fbPersonName } from "./map.ts";
import type { FbContact, FbCustomer } from "./types.ts";

/*
 * Weitere Angaben der Kunden (#1939): Telefon, Leitweg-ID und DATEV-Debitor aus customer.get, Ansprechpartner aus
 * contact.get (https://apidocs.fastbill.com/fastbill/de/customer.html, contact.html). Übernommen wird nur, was die Prüfung
 * des Kontaktformulars bestünde; der Rest steht in `problems`, damit der Abruf es nennt, statt es still zu verlieren.
 */

/** Wie im Kontaktformular (contactSchema): höchstens 46 Zeichen */
const MAX_LEITWEG_ID = 46;

const text = (value: string | number | null | undefined) => (value == null ? "" : String(value).trim());

/** Die erste gültige Nummer aus Telefon und Mobiltelefon; sonst leer und der Grund zur ersten angegebenen */
function telefon(c: { PHONE?: string | null; MOBILE?: string | null }): { telefon: string; problem: string | null } {
  const numbers = [text(c.PHONE), text(c.MOBILE)].filter(Boolean);
  const valid = numbers.find((n) => telefonProblem(n) === null);
  if (valid) return { telefon: normalizeTelefon(valid), problem: null };
  return { telefon: "", problem: numbers[0] ? telefonProblem(numbers[0]) : null };
}

export type FbCustomerDetailField = "telefon" | "leitwegId" | "debitorNr";

export interface FbCustomerDetails {
  telefon: string;
  leitwegId: string;
  debitorNr: number | null;
  /** Angaben, die Haben nicht übernimmt, mit Grund je Feld; der Abruf meldet sie nur, solange das Feld in Haben leer ist */
  problems: Partial<Record<FbCustomerDetailField, string>>;
}

export function mapFbCustomerDetails(c: FbCustomer): FbCustomerDetails {
  const problems: FbCustomerDetails["problems"] = {};
  const phone = telefon(c);
  if (phone.problem) problems.telefon = phone.problem;
  let leitwegId = text(c.BUYER_REFERENCE);
  if (leitwegId.length > MAX_LEITWEG_ID) {
    problems.leitwegId = `Leitweg-ID: höchstens ${MAX_LEITWEG_ID} Zeichen`;
    leitwegId = "";
  }
  // 0 heißt bei FastBill wie bei den IDs „keins“
  const account = text(c.CUSTOMER_ACCOUNT);
  const debitor = parsePersonenkonto("debitor", account === "0" ? "" : account);
  if (!debitor.ok) problems.debitorNr = debitor.error;
  return { telefon: phone.telefon, leitwegId, debitorNr: debitor.ok ? debitor.value : null, problems };
}

export interface FbContactPersonMapped {
  /** CUSTOMER_ID des Kunden, an dem die Person hängt */
  customerId: string;
  name: string;
  email: string;
  telefon: string;
  funktion: string;
}

/** Ansprechpartner; null ohne Kunden oder ohne Vor- und Nachnamen. Ein ungültiges Telefon bleibt weg. */
export function mapFbContactPerson(c: FbContact): FbContactPersonMapped | null {
  const customerId = text(c.CUSTOMER_ID);
  const name = fbPersonName(c.FIRST_NAME, c.LAST_NAME);
  if (!customerId || customerId === "0" || !name) return null;
  return { customerId, name, email: text(c.EMAIL), telefon: telefon(c).telefon, funktion: text(c.POSITION) };
}
