import {
  type StripeBalanceTransaction,
  StripeClient,
  type StripeClientOptions,
  STRIPE_NICHT_UNTERSTUETZT,
  stripeBatch,
  stripeEventOf,
  stripeStatement,
} from "@haben/import";
import { z } from "zod";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import { eventKey } from "../bank/index.ts";
import type { Lieferung, PspAdapter } from "./adapter.ts";
import { utcDay } from "./regeln.ts";
import { stripeNaechsterStart } from "./stripe-regeln.ts";

/*
 * Adapter für die Balance Transactions von Stripe (#1280, #1729).
 *
 * Stripe kennt für den lesenden Zugriff einen API-Schlüssel, den der Betreiber im Dashboard anlegt (Entwickler › API-Schlüssel
 * › „Eingeschränkten Schlüssel erstellen“ mit Lesezugriff auf „Guthaben“ und „Konto“; ein geheimer Schlüssel geht auch,
 * gibt Haben aber mehr Rechte als nötig). Beim Speichern fragt Haben Stripe nach dem Konto (`GET /v1/account`): Das prüft
 * den Schlüssel und liefert die Kennung `acct_…`, unter der die Quellenbindung läuft.
 *
 * Die Balance Transactions werden zum Kontoauszug (`stripeStatement` in @haben/import, dieselbe Lesart wie beim CSV-Export
 * „Balance history“) und zugleich zur Lieferung des Importvertrags (`stripeBatch`, #306). Haben erkennt jede Bewegung an der
 * ID der Balance Transaction (`txn_…`), die Gebühr daran mit dem Zusatz „#fee“.
 */

export class StripeError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: StripeClientOptions): StripeClient => new StripeClient(options);

export function setStripeClientFactory(factory: (options: StripeClientOptions) => StripeClient) {
  clientFactory = factory;
}

const clientFor = (apiKey: string) => clientFactory({ apiKey, baseUrl: env().STRIPE_API_URL });

const zugangSchema = z.object({ art: z.literal("schluessel"), apiKey: z.string().min(1) });
type StripeZugang = z.infer<typeof zugangSchema>;

const KEY = /^(rk|sk)_live_[A-Za-z0-9]{8,}$/;

export const stripeAdapter: PspAdapter<StripeZugang, Record<string, never>> = {
  provider: "stripe",
  name: "Stripe",
  beschreibung:
    "Haben holt die Umsätze des Stripe-Kontos (Zahlungen, Erstattungen, Streitfälle, Gebühren und Auszahlungen). Dafür braucht es dort einen eingeschränkten Schlüssel (rk_live_…) nur mit Lesezugriff auf „Guthaben“ und „Konto“. Der CSV-Export „Balance history“ bleibt der Weg für Zeiträume vor dem ersten Abruf.",
  link: { url: "https://dashboard.stripe.com/apikeys", text: "Stripe-Dashboard" },
  zugangName: "Schlüssel",
  felder: [
    {
      name: "apiKey",
      label: "API-Schlüssel",
      art: "geheim",
      hint: "Beginnt mit rk_live_ oder sk_live_; er liegt verschlüsselt in der Datenbank. Der öffentliche Schlüssel pk_ reicht nicht.",
    },
  ],
  // Vor #1729 lag der Schlüssel als Text in stripe_connections; die Migration hat ihn so übernommen
  zugangLesen: (text) => (text.startsWith("{") ? zugangSchema.parse(JSON.parse(text)) : { art: "schluessel", apiKey: text }),
  configSchema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  zugangAusEingabe(eingabe, _config, bisher) {
    const apiKey = eingabe.apiKey?.trim();
    if (!apiKey) {
      if (!bisher) throw new StripeError("Der API-Schlüssel von Stripe fehlt.");
      return null;
    }
    // Testdaten kämen sonst ins Konto des Zahlungsdienstleisters und in den Bankabgleich (Entscheidung des Maintainers in #1237)
    if (/^(rk|sk)_test_/.test(apiKey)) throw new StripeError("Haben ruft nur Live-Umsätze ab; bitte einen Live-Schlüssel mit Leserechten eintragen.");
    if (!KEY.test(apiKey)) {
      throw new StripeError("Das ist kein API-Schlüssel von Stripe (er beginnt mit rk_live_ oder sk_live_). Der öffentliche Schlüssel pk_ reicht nicht.");
    }
    return { art: "schluessel", apiKey };
  },
  async pruefen(zugang) {
    try {
      return { accountId: await clientFor(zugang.apiKey).accountId(), keyHint: zugang.apiKey.slice(-4) };
    } catch (error) {
      throw new StripeError(`Stripe nimmt den Schlüssel nicht an: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  // Der gewählte Start ist ein Tag in Deutschland, das Fenster läuft in UTC: Zwischen 0 und 2 Uhr deutscher Zeit liegt der
  // Start „heute“ hinter dem Ende des Fensters, und der Importvertrag lehnte die Lieferung ab
  fenster(fetchFrom, now) {
    const dateTo = utcDay(now);
    return { dateFrom: [fetchFrom, dateTo].sort()[0]!, dateTo };
  },
  async holen(zugang, _config, { accountId, dateFrom, dateTo, now }) {
    const client = clientFor(zugang.apiKey);
    const transactions = await client.balanceTransactions(dateFrom, dateTo);
    const hinweise = client.ohneZahlungsdetails
      ? [
          "Der Schlüssel erlaubt Stripe nicht, Zahlungen aufzuklappen: Name des Kunden und Bezug von Erstattungen fehlen. Die Umsätze sind vollständig; mit zusätzlichem Lesezugriff (etwa auf Zahlungen und Erstattungen) kommen die Angaben dazu.",
        ]
      : [];
    return lieferung(transactions, { accountId, dateFrom, dateTo, now }, hinweise);
  },
  naechsterStart: ({ fetchFrom }, now) => stripeNaechsterStart(fetchFrom, now),
  standNachFehler: "bisher",
};

function lieferung(
  transactions: StripeBalanceTransaction[],
  { accountId, dateFrom, dateTo, now }: { accountId: string; dateFrom: string; dateTo: string; now: Date },
  hinweise: string[],
): Lieferung {
  const statement = stripeStatement(transactions);
  const batch = stripeBatch({
    externalAccountId: accountId,
    transactions,
    dateFrom,
    dateTo,
    fetchedAt: now.toISOString(),
    // Fenster und Zeitpunkt: zwei Abrufe zur selben Zeit mit anderem Fenster sind zwei Lieferungen, nicht eine mit anderem Inhalt
    fetchId: `stripe-${dateFrom}-${now.toISOString()}`,
  });
  const meldungen = [...statement.warnings];
  if (batch.unsupported.length > 0) {
    meldungen.push(
      `${batch.unsupported.length} Bewegung${batch.unsupported.length === 1 ? "" : "en"}: ${STRIPE_NICHT_UNTERSTUETZT} (${batch.unsupported.map((u) => u.sourceEventId).join(", ")}). Haben übernimmt sie als Umsatz; der Zeitraum gilt nicht als vollständig abgerufen.`,
    );
  }
  return {
    input: { batch, statement, eventOf: stripeEventOf(new Set(batch.movements.map(eventKey))) },
    inhalt: statement.transactions,
    eintraege: transactions.length,
    hinweise,
    meldungen,
    leer: statement.transactions.length === 0,
  };
}
