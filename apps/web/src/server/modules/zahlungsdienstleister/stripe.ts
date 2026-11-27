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
import {
  STRIPE_MAX_SCHLUESSEL as MAX_SCHLUESSEL,
  STRIPE_MAX_SCHLUESSEL_LAENGE as MAX_SCHLUESSEL_LAENGE,
  stripeMetadatenSchluessel,
  stripeNaechsterStart,
} from "./stripe-regeln.ts";

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

/**
 * `metadataKeys`: Schlüssel der Metadaten für den Verwendungszweck (#1915), als Text mit Komma, weil config nur einfache Werte
 * nimmt. Gespeichert wird die bereinigte Liste. Verbindungen ohne die Angabe bleiben beim Zweck des Exports.
 */
const configSchema = z
  .object({
    metadataKeys: z
      .string()
      .transform((text, ctx) => {
        const keys = stripeMetadatenSchluessel(text);
        // Nach Zeichen, nicht nach UTF-16-Einheiten: Ein Emoji zählt einmal und wird nicht zerschnitten
        const lang = keys.map((key) => Array.from(key)).find((zeichen) => zeichen.length > MAX_SCHLUESSEL_LAENGE);
        if (keys.length > MAX_SCHLUESSEL) ctx.addIssue({ code: "custom", message: `Höchstens ${MAX_SCHLUESSEL} Schlüssel der Metadaten.` });
        if (lang) {
          ctx.addIssue({
            code: "custom",
            message: `Der Schlüssel „${lang.slice(0, MAX_SCHLUESSEL_LAENGE).join("")}…“ ist länger als ${MAX_SCHLUESSEL_LAENGE} Zeichen, so lang erlaubt Stripe keinen.`,
          });
        }
        return keys.join(", ");
      })
      .optional(),
  })
  .strict();
type StripeConfig = z.infer<typeof configSchema>;

const OHNE_LESERECHT =
  "Der Schlüssel darf Zahlungen nicht lesen: Die Umsätze kämen ohne die Metadaten an und bekämen sie nicht nachträglich. Gib ihm vor dem nächsten Abruf Lesezugriff auf Zahlungen und Erstattungen.";

/**
 * Vor dem ersten Abruf: Ohne das Recht kämen die Umsätze ohne Metadaten und bekämen sie nicht nachträglich (#1915). Scheitert
 * nur diese Frage (Netz, Grenze für Anfragen, Störung), hat Stripe den Schlüssel schon angenommen: Hinweis statt Ablehnung.
 */
async function leserechtHinweise(client: StripeClient): Promise<string[]> {
  try {
    return (await client.darfZahlungenLesen()) ? [] : [OHNE_LESERECHT];
  } catch (error) {
    const grund = error instanceof Error ? error.message : String(error);
    return [
      `Ob der Schlüssel Zahlungen lesen darf, ließ sich nicht prüfen (${grund}). Ohne das Recht kämen die Umsätze ohne die Metadaten an und bekämen sie nicht nachträglich: Prüfe den Zugang vor dem ersten Abruf noch einmal.`,
    ];
  }
}

export const stripeAdapter: PspAdapter<StripeZugang, StripeConfig> = {
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
    {
      name: "metadataKeys",
      label: "Metadaten im Verwendungszweck",
      art: "text",
      config: true,
      standard: "",
      hint: "Schlüssel durch Komma getrennt, etwa invoice_number; ihre Werte stehen in dieser Reihenfolge im Zweck neuer Umsätze. Leer: wie beim CSV-Export. Braucht zusätzlich Lesezugriff auf Zahlungen und Erstattungen.",
    },
  ],
  // Vor #1729 lag der Schlüssel als Text in stripe_connections; die Migration hat ihn so übernommen
  zugangLesen: (text) => (text.startsWith("{") ? zugangSchema.parse(JSON.parse(text)) : { art: "schluessel", apiKey: text }),
  configSchema,
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
  async pruefen(zugang, config) {
    try {
      const client = clientFor(zugang.apiKey);
      const accountId = await client.accountId();
      const hinweise = stripeMetadatenSchluessel(config.metadataKeys ?? "").length > 0 ? await leserechtHinweise(client) : [];
      return { accountId, keyHint: zugang.apiKey.slice(-4), ...(hinweise.length > 0 ? { hinweise } : {}) };
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
  async holen(zugang, config, { accountId, dateFrom, dateTo, now }) {
    const client = clientFor(zugang.apiKey);
    const transactions = await client.balanceTransactions(dateFrom, dateTo);
    const hinweise = client.ohneZahlungsdetails
      ? [
          "Der Schlüssel erlaubt Stripe nicht, Zahlungen aufzuklappen: Name des Kunden, Bezug von Erstattungen und die Metadaten fehlen. Die Umsätze sind vollständig; schon übernommene bekommen die Angaben nicht nachträglich. Mit zusätzlichem Lesezugriff (etwa auf Zahlungen und Erstattungen) kommen sie bei neuen dazu.",
        ]
      : [];
    const metadataKeys = stripeMetadatenSchluessel(config.metadataKeys ?? "");
    return lieferung(transactions, { accountId, dateFrom, dateTo, now, metadataKeys }, hinweise);
  },
  naechsterStart: ({ fetchFrom }, now) => stripeNaechsterStart(fetchFrom, now),
  standNachFehler: "bisher",
};

function lieferung(
  transactions: StripeBalanceTransaction[],
  { accountId, dateFrom, dateTo, now, metadataKeys }: { accountId: string; dateFrom: string; dateTo: string; now: Date; metadataKeys: string[] },
  hinweise: string[],
): Lieferung {
  const statement = stripeStatement(transactions, metadataKeys);
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
