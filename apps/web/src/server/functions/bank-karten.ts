import { ACCOUNT_PURPOSES, PAYMENT_PROVIDERS, paymentProviderAccount } from "@haben/core";
import { anbieterZugaenge } from "../../lib/kontenkarten-zugaenge.ts";
import { type KontoEingabe, type KontoZugang, kontenkarten } from "../../lib/kontenkarten.ts";
import {
  callbackUrl,
  cutoverDates,
  enableBankingConfigured,
  fintsConfigured,
  listConnections,
  listFintsConnections,
  openConflicts,
  RENEW_WARNING_DAYS,
} from "../modules/bank/index.ts";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { verbindungenUebersicht } from "../modules/zahlungsdienstleister/index.ts";

/*
 * Zugänge der Kartenleiste auf der Bankseite (#1951) aus den Tabellen je Weg: Enable Banking, FinTS und die
 * Zahlungsdienstleister mit Adapter (psp_connections, #1729), deren Verbindung ihr Konto selbst nennt.
 */

type Konto = KontoEingabe & { provider: string | null; createdAt: Date | string };

/** Zugänge der Banken: Enable Banking und FinTS, je Konto der Verbindung einer */
function bankZugaenge(connections: Awaited<ReturnType<typeof listConnections>>, fints: Awaited<ReturnType<typeof listFintsConnections>>): KontoZugang[] {
  // Enable Banking schreibt auch Konflikte in lastError; ein Fehlschlag ist nur der Status „fehler“
  const abruf = connections.flatMap((c) =>
    c.accounts.map((a) => ({
      bankAccountId: a.bankAccountId,
      art: "enablebanking" as const,
      verbindungId: c.id,
      weg: "Abruf",
      lastSyncAt: c.lastSyncAt,
      fehler: c.status === "fehler" ? (c.lastError ?? "Fehler") : null,
      abgelaufen: c.status === "abgelaufen",
      laeuftAbAm: c.renewSoon ? c.validUntil : null,
    })),
  );
  const perFints = fints.flatMap((c) =>
    c.accounts.map((a) => ({
      bankAccountId: a.bankAccountId,
      art: "fints" as const,
      verbindungId: c.id,
      weg: "FinTS",
      lastSyncAt: c.lastSyncAt,
      fehler: c.status === "fehler" ? (c.lastError ?? "Fehler") : null,
      freigabe: c.status === "tan",
    })),
  );
  return [...abruf, ...perFints];
}

/** Stand des Kontoabrufs für die Bankseite und daraus die Karten aller Konten */
export async function abrufUndKarten(accounts: readonly Konto[]) {
  const [connections, fintsConnections, konflikte, zahlungsdienstleister] = await Promise.all([
    listConnections(),
    listFintsConnections(),
    openConflicts(),
    verbindungenUebersicht(),
  ]);
  const jetzt = new Date();
  const zugaenge = [...bankZugaenge(connections, fintsConnections), ...anbieterZugaenge(zahlungsdienstleister, jetzt, RENEW_WARNING_DAYS)];
  return {
    sync: {
      configured: await enableBankingConfigured(),
      callbackUrl: callbackUrl(),
      connections,
      /** Offene Konflikte im Abruf und Stichtag je Konto (#306) */
      konflikte,
      stichtage: await cutoverDates(),
    },
    fints: { configured: fintsConfigured(), connections: fintsConnections },
    /** Verbindungen zu Zahlungsdienstleistern mit Abruf (#1729), für die Aktionen am gewählten Konto und die Einrichtung */
    zahlungsdienstleister,
    karten: kontenkarten({ accounts, zugaenge, konflikte, jetzt }),
  };
}

/** Zwecke und Arten für „Name und Zweck“ und „Konto hinzufügen“, dazu das Sachkonto je Zahlungsdienstleister zur Anzeige */
export async function kontenAngaben(accounts: readonly { id: string; ledgerIndex: number | null }[]) {
  const { kontenrahmen } = await loadCompany();
  return {
    purposes: Object.entries(ACCOUNT_PURPOSES).map(([value, label]) => ({ value, label })),
    providers: Object.entries(PAYMENT_PROVIDERS).map(([value, p]) => ({ value, label: p.label })),
    ledgers: Object.fromEntries(
      accounts.filter((a) => a.ledgerIndex !== null).map((a) => [a.id, paymentProviderAccount(kontenrahmen, a.ledgerIndex!)] as const),
    ),
  };
}
