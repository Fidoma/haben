import { classify, PayPalApiError, PayPalClient, type PayPalClientOptions, paypalBatch, paypalEventOf, paypalStatement } from "@haben/import";
import { z } from "zod";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import { eventKey } from "../bank/index.ts";
import type { PspAdapter } from "./adapter.ts";
import { MAX_RUECKBLICK_TAGE, paypalFenster, paypalNaechsterStart } from "./paypal-regeln.ts";
import { minusDays } from "./regeln.ts";

/*
 * Adapter für die Transaction Search von PayPal (#1512, #1729).
 *
 * Der Betreiber legt im PayPal Developer Dashboard (Apps & Credentials) eine App an, schaltet für sie „Transaction Search“
 * ein und trägt Client-ID und Secret in Haben ein; die Sandbox hat eigene Zugangsdaten. Beim Speichern fragt Haben PayPal nach
 * dem Saldo des Kontos (`GET /v1/reporting/balances`): Das prüft die Zugangsdaten und das Recht und liefert die Kennung des
 * Händlerkontos, unter der die Quellenbindung läuft.
 *
 * Die Zeilen werden eingeordnet (`classify`), zum Kontoauszug (`paypalStatement`, derselbe Parser wie beim Aktivitätenexport)
 * und zugleich zur Lieferung des Importvertrags (`paypalBatch`, #306). Haben erkennt jede Bewegung an der Transaktions-ID, die
 * Gebühr daran mit dem Zusatz „#fee“.
 */

export class PayPalError extends UserError {}

/** Fehler an den Zugangsdaten: die Einrichtung zeigt ihn am ersten Feld, der Client-ID */
const AM_ZUGANG = { felder: ["clientId"] };

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: PayPalClientOptions): PayPalClient => new PayPalClient(options);

export function setPayPalClientFactory(factory: (options: PayPalClientOptions) => PayPalClient) {
  clientFactory = factory;
}

const zugangSchema = z.object({ art: z.literal("client").default("client"), clientId: z.string().min(1), clientSecret: z.string().min(1) });
type PayPalZugang = z.infer<typeof zugangSchema>;

function istZeitzone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const configSchema = z.object({
  /** Zugangsdaten der Sandbox (api-m.sandbox.paypal.com): Testdaten, keine echten Umsätze */
  sandbox: z.boolean().default(false),
  /** Zeitzone des PayPal-Kontos (IANA-Name): In ihr schreibt der Aktivitätenexport das Datum, nach ihr bildet Haben den Buchungstag */
  zeitzone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .default("Europe/Berlin")
    .refine(istZeitzone, { error: (issue) => `„${String(issue.input)}“ ist keine Zeitzone (etwa Europe/Berlin).` }),
});
type PayPalConfig = z.infer<typeof configSchema>;

const clientFor = (zugang: PayPalZugang, config: PayPalConfig) =>
  clientFactory({
    clientId: zugang.clientId,
    clientSecret: zugang.clientSecret,
    environment: config.sandbox ? "sandbox" : "live",
    baseUrl: env().PAYPAL_API_URL,
  });

/** Meldungen zu dem, was nicht als Umsatz ankommt, nach Grund zusammengefasst, mit den ersten Kennungen */
function unsupportedMessages(list: { sourceEventId?: string; reason: string; final?: true }[]): string[] {
  const groups = new Map<string, { ids: string[]; final: boolean }>();
  for (const u of list) {
    const group = groups.get(u.reason) ?? { ids: [], final: u.final === true };
    if (u.sourceEventId) group.ids.push(u.sourceEventId);
    groups.set(u.reason, group);
  }
  return [...groups].map(([reason, { ids, final }]) => {
    const shown = ids.slice(0, 5).join(", ") + (ids.length > 5 ? ", …" : "");
    return `${ids.length} Zeile${ids.length === 1 ? "" : "n"} nicht übernommen: ${reason} (${shown}).${final ? "" : " Der Zeitraum gilt nicht als vollständig abgerufen."}`;
  });
}

export const paypalAdapter: PspAdapter<PayPalZugang, PayPalConfig> = {
  provider: "paypal",
  name: "PayPal",
  beschreibung:
    "Haben holt die Umsätze des PayPal-Kontos (Zahlungen mit Gebühr, Erstattungen, Rückbuchungen und Abbuchungen auf die Bank). Dafür braucht es dort eine App mit dem Recht „Transaction Search“; Client-ID und Secret trägst du hier ein. Der Aktivitätenexport (CSV) bleibt der Weg für Zeiträume vor dem ersten Abruf.",
  link: { url: "https://developer.paypal.com/dashboard/applications/live", text: "PayPal Developer Dashboard" },
  zugangName: "Client-ID",
  felder: [
    { name: "clientId", label: "Client-ID", art: "geheim", hint: "Aus der PayPal-App; sie liegt zusammen mit dem Secret verschlüsselt in der Datenbank." },
    { name: "clientSecret", label: "Secret", art: "geheim" },
    {
      name: "sandbox",
      label: "Umgebung",
      art: "auswahl",
      config: true,
      standard: false,
      hint: "Live und Sandbox haben eigene Zugangsdaten; beim Wechsel trägst du beide neu ein",
      optionen: [
        { wert: false, label: "Live" },
        { wert: true, label: "Sandbox (Testdaten)" },
      ],
    },
    {
      name: "zeitzone",
      label: "Zeitzone des PayPal-Kontos",
      art: "text",
      config: true,
      standard: "Europe/Berlin",
      hint: "Wie im Aktivitätenexport (Spalte „Zeitzone“): Nach ihr bildet Haben den Buchungstag, etwa Europe/Berlin",
    },
  ],
  configHinweis: (config) => (config.sandbox ? "Die Zugangsdaten gehören zur Sandbox von PayPal: Haben holt Testdaten, keine echten Umsätze." : null),
  // Vor #1729 lag JSON ohne `art` in paypal_connections; die Migration hat es so übernommen
  zugangLesen: (text) => zugangSchema.parse(JSON.parse(text)),
  configSchema: configSchema as z.ZodType<PayPalConfig>,
  zugangAusEingabe(eingabe, config, bisher) {
    const clientId = eingabe.clientId?.trim();
    const clientSecret = eingabe.clientSecret?.trim();
    if (Boolean(clientId) !== Boolean(clientSecret)) throw new PayPalError("Client-ID und Secret gehören zusammen: Trage beide ein oder keines.", AM_ZUGANG);
    if (!clientId || !clientSecret) {
      if (!bisher) throw new PayPalError("Client-ID und Secret der PayPal-App fehlen.", AM_ZUGANG);
      if (bisher.config.sandbox !== config.sandbox) {
        throw new PayPalError("Live und Sandbox haben verschiedene Zugangsdaten: Trage die Client-ID und das Secret der gewählten Umgebung ein.", AM_ZUGANG);
      }
      return null;
    }
    return { art: "client", clientId, clientSecret };
  },
  async pruefen(zugang, config) {
    try {
      return { accountId: await clientFor(zugang, config).accountId(), keyHint: zugang.clientId.slice(-4) };
    } catch (error) {
      // Am Feld nur bei abgelehnter Anmeldung (401); das fehlende Recht der App (403) und Netzfehler liegen nicht an der Eingabe
      const amZugang = error instanceof PayPalApiError && error.status === 401;
      throw new PayPalError(`PayPal nimmt die Zugangsdaten nicht an: ${error instanceof Error ? error.message : String(error)}`, amZugang ? AM_ZUGANG : {});
    }
  },
  einstellungFehler({ fetchFrom }, heute) {
    if (fetchFrom < minusDays(heute, MAX_RUECKBLICK_TAGE)) {
      return "PayPal liefert Transaktionen nur für die letzten drei Jahre. Ältere Umsätze kommen über den Aktivitätenexport (CSV).";
    }
    return null;
  },
  fenster: paypalFenster,
  async holen(zugang, config, { accountId, dateFrom, dateTo, now }) {
    const transactions = await clientFor(zugang, config).transactions(dateFrom, dateTo);
    const classified = classify(transactions, { zone: config.zeitzone, dateFrom, dateTo });
    const statement = paypalStatement(classified.entries);
    const ausstehend = classified.unsupported.filter((u) => u.reason.startsWith("Status P")).map((u) => u.bookingDate!);
    const batch = paypalBatch({
      externalAccountId: accountId,
      classified,
      dateFrom,
      dateTo,
      fetchedAt: now.toISOString(),
      // Fenster und Zeitpunkt: zwei Abrufe zur selben Zeit mit anderem Fenster sind zwei Lieferungen, nicht eine mit anderem Inhalt
      fetchId: `paypal-${dateFrom}-${now.toISOString()}`,
    });
    return {
      input: { batch, statement, eventOf: paypalEventOf(new Set(batch.movements.map(eventKey))) },
      inhalt: statement.transactions,
      eintraege: transactions.length,
      hinweise: [],
      meldungen: [...statement.warnings, ...unsupportedMessages(classified.unsupported)],
      leer: statement.transactions.length === 0 && classified.unsupported.length === 0,
      offenSeit: ausstehend.sort()[0] ?? null,
    };
  },
  naechsterStart: ({ dateFrom }, now, lieferung) => paypalNaechsterStart(dateFrom, now, lieferung.offenSeit ?? null),
  standNachFehler: "fensterbeginn",
};
