import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { BankError, recordRefusedBatch, storeBatch } from "../bank/index.ts";
import type { Lieferung } from "./adapter.ts";
import { abrufFaellig, type Rhythmus } from "./regeln.ts";
import { alleVerbindungen, kontoDerVerbindung, ladeVerbindung, type Verbindung, ZahlungsdienstleisterError } from "./verbindungen.ts";

/*
 * Gemeinsamer Abruf der Zahlungsdienstleister (#1729): holt über den Adapter die Bewegungen seit dem letzten Anlauf und übernimmt
 * sie ins Konto der Verbindung.
 *
 * - Wie weit der Abruf zurückgreift und wo der nächste beginnt, sagt der Adapter; schon übernommene Bewegungen erkennt Haben an
 *   ihrer Kennung.
 * - Gespeichert wird über `storeBatch` mit der Kontokennung beim Anbieter als Quelle (Konto der Art „psp“). Umsätze, die vor der
 *   Quellenbindung aus dem CSV-Export kamen, verbindet `storeBatch` über den Dubletten-Hash mit ihrer Kennung, statt sie neu
 *   anzulegen; eine Lieferung, die der Vertrag ablehnt, speichert nichts und steht mit Grund im Importprotokoll.
 * - Ein Fehler landet an der Verbindung (lastError) und im Ergebnis; der nächste Lauf versucht es erneut.
 * - Ohne Konto in Haben ist nichts gespeichert: Der Startpunkt bleibt, sonst holte kein späterer Abruf diese Umsätze mehr.
 */

/** Urheber im Protokoll für den automatischen Abruf, je Anbieter wie vor #1729 */
export const syncActor = (provider: string) => `system:${provider}abruf`;

export interface AbrufErgebnis {
  /** Bewegungen aus dem Abruf */
  entries: number;
  /** Neu angelegte Umsätze im Konto des Dienstleisters */
  added: number;
  /** null: kein Konto des Dienstleisters vorhanden */
  accountName: string | null;
  messages: string[];
  error: string | null;
}

const laufend = new Map<string, Promise<AbrufErgebnis>>();

/**
 * Ein Abruf je Verbindung zur Zeit: Zeitplan und „Jetzt abrufen“ können zusammenfallen. Läuft schon einer, bekommt der zweite
 * dessen Ergebnis, statt dieselben Umsätze gleichzeitig anzulegen.
 */
export function abrufen(actor: string, id: string, now = new Date()): Promise<AbrufErgebnis> {
  const schon = laufend.get(id);
  if (schon) return schon;
  const lauf = abrufenEinmal(actor, id, now).finally(() => laufend.delete(id));
  laufend.set(id, lauf);
  return lauf;
}

function update(actor: string, id: string, values: Partial<typeof schema.pspConnections.$inferInsert>) {
  return withActor(actor, (tx) => tx.update(schema.pspConnections).set(values).where(eq(schema.pspConnections.id, id)));
}

async function abrufenEinmal(actor: string, id: string, now: Date): Promise<AbrufErgebnis> {
  const verbindung = await ladeVerbindung(id);
  if (!verbindung) throw new ZahlungsdienstleisterError("Die Verbindung ist nicht eingerichtet (Bank › Konto verbinden).");
  const { row, adapter } = verbindung;
  const result: AbrufErgebnis = { entries: 0, added: 0, accountName: null, messages: [], error: null };
  const fenster = adapter.fenster(row.fetchFrom, now);
  let neuerStart = adapter.standNachFehler === "bisher" ? row.fetchFrom : fenster.dateFrom;
  try {
    const lieferung = await adapter.holen(verbindung.zugang, verbindung.config, { ...fenster, accountId: row.accountId, now });
    result.entries = lieferung.eintraege;
    result.messages.push(...lieferung.hinweise);
    const konto = await kontoDerVerbindung(actor, row);
    if (!konto) {
      result.messages.push(
        `Für ${adapter.name} gibt es noch kein Konto. Lege unter Bank ein Konto der Art Zahlungsdienstleister mit Anbieter ${adapter.name} an; dann übernimmt Haben die Umsätze.`,
      );
    } else {
      result.accountName = konto.name;
      result.messages.push(...lieferung.meldungen);
      if (!lieferung.leer) await speichern(actor, verbindung, konto.id, lieferung, now, result);
      neuerStart = adapter.naechsterStart({ ...fenster, fetchFrom: row.fetchFrom }, now, lieferung);
    }
    await update(actor, id, { lastSyncAt: now, lastError: null, fetchFrom: neuerStart });
  } catch (error) {
    const meldung = `Abruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`;
    await update(actor, id, { lastError: meldung, fetchFrom: neuerStart });
    result.error = meldung;
  }
  return result;
}

/** Die Lieferung ins Konto übernehmen; abgelehnt steht sie mit Grund im Importprotokoll */
async function speichern(actor: string, { row }: Verbindung, kontoId: string, lieferung: Lieferung, now: Date, result: AbrufErgebnis) {
  const sha256 = createHash("sha256")
    .update(new TextEncoder().encode(JSON.stringify(lieferung.inhalt)))
    .digest("hex");
  const input = {
    ...lieferung.input,
    binding: { provider: row.provider, externalAccountId: row.accountId, accountKind: "psp" as const },
    source: { filename: `${row.provider}-abruf-${now.toISOString().slice(0, 10)}.json`, sha256 },
  };
  let imported: Awaited<ReturnType<typeof storeBatch>>;
  try {
    imported = await withActor(actor, (tx) => storeBatch(tx, input, kontoId));
  } catch (error) {
    // Abgelehnt (Vertrag oder Konflikt): gespeichert ist nichts, der Grund steht wie bei Enable Banking im Importprotokoll
    if (error instanceof BankError) await withActor(actor, (tx) => recordRefusedBatch(tx, kontoId, input, error));
    throw error;
  }
  result.added = imported.added;
  result.messages.push(...imported.warnings);
  if (imported.quelle) result.messages.push(imported.quelle);
  if (imported.gap) result.messages.push(imported.gap);
}

export interface Zeitplanergebnis {
  synced: number;
  added: number;
  messages: string[];
  errors: string[];
}

/** Automatischer Abruf aller Verbindungen: jede, deren letzter Anlauf lange genug her ist */
export async function runDuePspSyncs(now = new Date()): Promise<Zeitplanergebnis> {
  const summary: Zeitplanergebnis = { synced: 0, added: 0, messages: [], errors: [] };
  for (const row of await alleVerbindungen()) {
    const letzter = row.lastSyncAt ? { zeit: row.lastSyncAt, fehlgeschlagen: row.lastError !== null } : null;
    if (!abrufFaellig(row.rhythmus as Rhythmus, letzter, now)) continue;
    const actor = syncActor(row.provider);
    try {
      const result = await abrufen(actor, row.id, now);
      summary.synced++;
      summary.added += result.added;
      summary.messages.push(...result.messages.map((m) => `${row.name}: ${m}`));
      if (result.error) {
        summary.errors.push(`${row.name}: ${result.error}`);
        // Fehlschlag zählt als Anlauf; der nächste Versuch kommt nach einem Tag (abrufFaellig)
        await update(actor, row.id, { lastSyncAt: now });
      }
    } catch (error) {
      summary.errors.push(`${row.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
