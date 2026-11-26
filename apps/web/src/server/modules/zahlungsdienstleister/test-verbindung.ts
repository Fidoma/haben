/*
 * Für die Tests von Stripe und PayPal: die Aufrufe von vor #1729 (eine Verbindung je Anbieter) über der gemeinsamen Anbindung.
 * So prüfen die Tests aus modules/stripe und modules/paypal unverändert dasselbe Verhalten, nur über psp_connections.
 */

import { today } from "../../today.ts";

type Modul = typeof import("./index.ts");

async function verbindungVon(psp: Modul, provider: string) {
  const { verbindungen } = await psp.verbindungenUebersicht();
  return verbindungen.find((v) => v.provider === provider) ?? null;
}

async function idVon(psp: Modul, provider: string, name: string): Promise<string> {
  const v = await verbindungVon(psp, provider);
  if (!v) throw new Error(`Der ${name}-Zugang ist nicht eingerichtet (Bank › Konto verbinden).`);
  return v.id;
}

/** Stand ohne Zugang wie die frühere Zusammenfassung des Anbieters */
async function stand(psp: Modul, provider: string, heute: string) {
  const v = await verbindungVon(psp, provider);
  return {
    configured: v !== null,
    accountId: v?.accountId ?? "",
    keyHint: v?.keyHint ?? "",
    fetchFrom: v?.fetchFrom ?? heute,
    naechsterAbrufAb: v?.naechsterAbrufAb ?? null,
    rhythmus: v?.rhythmus ?? "taeglich",
    lastSyncAt: v?.lastSyncAt ?? null,
    lastError: v?.lastError ?? null,
    konflikte: v?.konflikte ?? [],
    config: v?.config ?? {},
  };
}

export function alsStripe(psp: Modul) {
  return {
    setStripeClientFactory: psp.setStripeClientFactory,
    async saveStripeConnection(actor: string, input: { apiKey?: string; fetchFrom: string; rhythmus?: "stuendlich" | "taeglich" | "woechentlich" }) {
      const id = (await verbindungVon(psp, "stripe"))?.id;
      return psp.speichereVerbindung(actor, {
        id,
        provider: "stripe",
        name: "Stripe",
        eingabe: input.apiKey ? { apiKey: input.apiKey } : {},
        fetchFrom: input.fetchFrom,
        rhythmus: input.rhythmus,
      });
    },
    stripeSummary: () => stand(psp, "stripe", today()),
    syncStripe: async (actor: string, now?: Date) => psp.abrufen(actor, await idVon(psp, "stripe", "Stripe"), now),
    runDueStripeSyncs: (now?: Date) => psp.runDuePspSyncs(now),
    deleteStripeConnection: async (actor: string) => psp.entferneVerbindung(actor, await idVon(psp, "stripe", "Stripe")),
  };
}

export function alsPayPal(psp: Modul) {
  return {
    setPayPalClientFactory: psp.setPayPalClientFactory,
    async savePayPalConnection(
      actor: string,
      input: {
        clientId?: string;
        clientSecret?: string;
        sandbox?: boolean;
        zeitzone?: string;
        fetchFrom: string;
        rhythmus?: "stuendlich" | "taeglich" | "woechentlich";
      },
    ) {
      const id = (await verbindungVon(psp, "paypal"))?.id;
      const eingabe: Record<string, string> = {};
      if (input.clientId) eingabe.clientId = input.clientId;
      if (input.clientSecret) eingabe.clientSecret = input.clientSecret;
      return psp.speichereVerbindung(actor, {
        id,
        provider: "paypal",
        name: "PayPal",
        eingabe,
        config: { sandbox: input.sandbox ?? false, zeitzone: input.zeitzone ?? "Europe/Berlin" },
        fetchFrom: input.fetchFrom,
        rhythmus: input.rhythmus,
      });
    },
    async paypalSummary() {
      const s = await stand(psp, "paypal", today());
      const config = s.config as { sandbox?: boolean; zeitzone?: string };
      return { ...s, sandbox: config.sandbox ?? false, zeitzone: config.zeitzone ?? "Europe/Berlin" };
    },
    syncPayPal: async (actor: string, now?: Date) => psp.abrufen(actor, await idVon(psp, "paypal", "PayPal"), now),
    runDuePayPalSyncs: (now?: Date) => psp.runDuePspSyncs(now),
    deletePayPalConnection: async (actor: string) => psp.entferneVerbindung(actor, await idVon(psp, "paypal", "PayPal")),
  };
}
