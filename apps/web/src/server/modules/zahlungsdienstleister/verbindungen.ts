import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { PaymentProvider } from "@haben/core";
import { z } from "zod";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { keineExterneQuelle, openConflicts, providerKontoAnlegen } from "../bank/index.ts";
import { type PspAdapter, STANDARD_SCHRITTE } from "./adapter.ts";
import { ANBIETER, adapterFuer } from "./anbieter.ts";
import { RHYTHMEN, type Rhythmus } from "./regeln.ts";

/*
 * Verbindungen zu Zahlungsdienstleistern speichern, prüfen, lesen und entfernen (#1729; eingerichtet auf der Bankseite, #1951). Eine Zeile in
 * psp_connections je Verbindung; was beim Anbieter anders ist, entscheidet sein Adapter (anbieter.ts). Der Zugang liegt
 * AES-256-GCM-verschlüsselt in ciphertext, nie im Klartext in der Datenbank, im Protokoll oder in einer Meldung.
 */

export class ZahlungsdienstleisterError extends UserError {}

type Row = typeof schema.pspConnections.$inferSelect;

export interface Verbindung {
  row: Row;
  adapter: PspAdapter;
  zugang: unknown;
  config: unknown;
}

function adapterOderFehler(provider: string): PspAdapter {
  const adapter = adapterFuer(provider);
  if (!adapter) throw new ZahlungsdienstleisterError(`Für „${provider}“ gibt es keinen Abruf.`);
  return adapter;
}

/** Config des Adapters prüfen; die erste Meldung als UserError am Feld */
function configLesen(adapter: PspAdapter, roh: unknown): unknown {
  const parsed = adapter.configSchema.safeParse(roh ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  throw new ZahlungsdienstleisterError(issue.message, { felder: issue.path.map(String) });
}

function verbindungAus(row: Row): Verbindung {
  const adapter = adapterOderFehler(row.provider);
  return { row, adapter, zugang: adapter.zugangLesen(decrypt(row.ciphertext).toString("utf8")), config: configLesen(adapter, row.config) };
}

export async function ladeVerbindung(id: string): Promise<Verbindung | null> {
  const [row] = await db.select().from(schema.pspConnections).where(eq(schema.pspConnections.id, id));
  return row ? verbindungAus(row) : null;
}

export async function alleVerbindungen(): Promise<Row[]> {
  return db.select().from(schema.pspConnections).orderBy(asc(schema.pspConnections.createdAt), asc(schema.pspConnections.id));
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tag als JJJJ-MM-TT");

export const verbindungSchema = z.object({
  /** fehlt: neue Verbindung */
  id: z.uuid().optional(),
  provider: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1, "Name fehlt").max(100),
  /** Konto des Zahlungsdienstleisters in Haben; leer: das älteste noch freie Konto des Anbieters */
  bankAccountId: z.uuid().nullable().default(null),
  /** Geheime Felder des Adapters; leer: gespeicherte behalten */
  eingabe: z.record(z.string(), z.string().max(500)).default({}),
  /** Nicht geheime Einstellungen des Adapters */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Erster Tag, den der Abruf holt */
  fetchFrom: day,
  /** Wie oft der Zeitplan abruft */
  rhythmus: z.enum(RHYTHMEN).default("taeglich"),
});

/**
 * Das älteste Konto der Art Zahlungsdienstleister mit diesem Anbieter, das keine andere Verbindung nutzt. Dorthin schrieb der
 * Abruf schon vor #1729; eine Verbindung ohne gewähltes Konto nimmt es beim Speichern und beim ersten Abruf.
 */
export async function freiesKonto(tx: Tx | typeof db, provider: string, ausser: string | null, accountId: string) {
  const belegt = tx
    .select({ id: schema.pspConnections.bankAccountId })
    .from(schema.pspConnections)
    .where(and(sql`${schema.pspConnections.bankAccountId} is not null`, ausser ? ne(schema.pspConnections.id, ausser) : sql`true`));
  const [konto] = await tx
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
    .from(schema.bankAccounts)
    .where(
      and(
        eq(schema.bankAccounts.purpose, "zahlungsdienstleister"),
        sql`${schema.bankAccounts.provider} = ${provider}`,
        notInArray(schema.bankAccounts.id, belegt),
        notInArray(schema.bankAccounts.id, fremdeQuellen(tx, provider, accountId)),
      ),
    )
    .orderBy(asc(schema.bankAccounts.createdAt))
    .limit(1);
  return konto ?? null;
}

/**
 * Konten, an die die Quellenbindung (#306) ein anderes Konto beim selben Anbieter hält: Sie enthalten dessen Umsätze und bekommen
 * kein zweites (ein Konto, eine Quelle), auch nachdem die Verbindung dazu entfernt ist. Ein Konto mit externer Quelle lehnt
 * keineExterneQuelle ab.
 */
function fremdeQuellen(tx: Tx | typeof db, provider: string, accountId: string) {
  return tx
    .select({ id: schema.importSources.bankAccountId })
    .from(schema.importSources)
    .where(and(eq(schema.importSources.provider, provider), ne(schema.importSources.externalAccountId, accountId)));
}

/** Fehler, wenn das gewählte Konto schon die Umsätze eines anderen Kontos beim selben Anbieter bekommt */
async function ohneFremdeQuelle(adapter: PspAdapter, bankAccountId: string, accountId: string) {
  const [fremd] = await db
    .select()
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.id, bankAccountId), inArray(schema.bankAccounts.id, fremdeQuellen(db, adapter.provider, accountId))));
  if (fremd) {
    throw new ZahlungsdienstleisterError(
      `Das Konto ${fremd.name} bekommt schon die Umsätze eines anderen ${adapter.name}-Kontos; wähle ein anderes oder „Automatisch“.`,
      {
        felder: ["bankAccountId"],
      },
    );
  }
}

/** Das gewählte Konto muss eines des Anbieters sein und frei */
async function gewaehltesKonto(bankAccountId: string, provider: string, id: string | null) {
  const [konto] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, bankAccountId));
  if (konto?.purpose !== "zahlungsdienstleister" || konto.provider !== provider) {
    throw new ZahlungsdienstleisterError("Das Konto gehört nicht zu diesem Zahlungsdienstleister.", { felder: ["bankAccountId"] });
  }
  const [andere] = await db
    .select({ name: schema.pspConnections.name })
    .from(schema.pspConnections)
    .where(and(eq(schema.pspConnections.bankAccountId, bankAccountId), id ? ne(schema.pspConnections.id, id) : sql`true`));
  if (andere) throw new ZahlungsdienstleisterError(`Das Konto ${konto.name} nutzt schon die Verbindung „${andere.name}“.`, { felder: ["bankAccountId"] });
  return konto.id;
}

/** Die Verbindung, die dieses Konto beim Anbieter schon abruft, außer der mit der Kennung id; null, wenn es keine gibt */
async function verbindungZumKonto(adapter: PspAdapter, accountId: string, id: string | null) {
  const [andere] = await db
    .select({ id: schema.pspConnections.id, name: schema.pspConnections.name, bankAccountId: schema.pspConnections.bankAccountId })
    .from(schema.pspConnections)
    .where(
      and(
        eq(schema.pspConnections.provider, adapter.provider),
        eq(schema.pspConnections.accountId, accountId),
        id ? ne(schema.pspConnections.id, id) : sql`true`,
      ),
    );
  return andere ?? null;
}

const schonVerbundenText = (adapter: PspAdapter, name: string) => `Dieses ${adapter.name}-Konto ist schon als „${name}“ verbunden.`;

/** Fehler, wenn eine andere Verbindung schon dieses Konto beim Anbieter abruft */
async function kontoBeimAnbieterFrei(adapter: PspAdapter, accountId: string, id: string | null) {
  const andere = await verbindungZumKonto(adapter, accountId, id);
  if (andere) throw new ZahlungsdienstleisterError(schonVerbundenText(adapter, andere.name));
}

/**
 * Konto in Haben, an das die Quellenbindung (#306) das Konto beim Anbieter schon hält, auch nach dem Entfernen einer Verbindung:
 * Ein anderes Konto lehnte jeder Abruf ab (sourceFor in bank/import-batch.ts).
 */
async function gebundenesKonto(adapter: PspAdapter, accountId: string, id: string | null) {
  const [quelle] = await db
    .select({ id: schema.importSources.bankAccountId, name: schema.bankAccounts.name })
    .from(schema.importSources)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.importSources.bankAccountId))
    .where(and(eq(schema.importSources.provider, adapter.provider), eq(schema.importSources.externalAccountId, accountId)));
  if (!quelle) return null;
  // Nach dem Entfernen kann eine andere Verbindung das Konto übernommen haben; zwei je Konto hält psp_connections_konto ab
  const [andere] = await db
    .select({ name: schema.pspConnections.name })
    .from(schema.pspConnections)
    .where(and(eq(schema.pspConnections.bankAccountId, quelle.id), id ? ne(schema.pspConnections.id, id) : sql`true`));
  if (andere) {
    throw new ZahlungsdienstleisterError(
      `Dieses ${adapter.name}-Konto ist schon mit dem Konto ${quelle.name} verbunden, und das nutzt jetzt die Verbindung „${andere.name}“.`,
    );
  }
  return quelle;
}

/**
 * Speichert eine Verbindung. Ein neuer Zugang wird beim Anbieter geprüft und liefert die Kontokennung; gehört er zu einem
 * anderen Konto, beginnt der Abruf wieder am gewählten Tag, weil der Stand des alten Kontos nichts über das neue sagt.
 * Gibt die Kennung der Verbindung zurück.
 */
export async function speichereVerbindung(actor: string, input: z.input<typeof verbindungSchema>): Promise<string> {
  const data = verbindungSchema.parse(input);
  const adapter = adapterOderFehler(data.provider);
  if (data.fetchFrom > today()) throw new ZahlungsdienstleisterError("Der erste Tag des Abrufs liegt in der Zukunft.", { felder: ["fetchFrom"] });
  const config = configLesen(adapter, data.config);
  const fehler = adapter.einstellungFehler?.({ fetchFrom: data.fetchFrom, config }, today());
  if (fehler) throw new ZahlungsdienstleisterError(fehler, { felder: ["fetchFrom"] });
  const existing = data.id ? await ladeVerbindung(data.id) : null;
  if (data.id && !existing) throw new ZahlungsdienstleisterError("Die Verbindung gibt es nicht mehr.");
  if (existing && existing.row.provider !== adapter.provider) throw new ZahlungsdienstleisterError("Der Anbieter einer Verbindung lässt sich nicht ändern.");
  const id = existing?.row.id ?? null;
  const gewaehlt = data.bankAccountId ? await gewaehltesKonto(data.bankAccountId, adapter.provider, id) : null;
  const neuerZugang = adapter.zugangAusEingabe(data.eingabe, config, existing ? { zugang: existing.zugang, config: existing.config } : null);
  const zugang = neuerZugang ?? existing!.zugang;
  const pruefung = neuerZugang ? await adapter.pruefen(neuerZugang, config) : null;
  const accountId = pruefung?.accountId ?? existing!.row.accountId;
  await kontoBeimAnbieterFrei(adapter, accountId, id);
  // Schreibt der Abruf schon in ein Konto, bleibt es dabei: „Automatisch“ nimmt es, eine andere Wahl wird abgelehnt
  const gebunden = await gebundenesKonto(adapter, accountId, id);
  if (gebunden && gewaehlt && gewaehlt !== gebunden.id) {
    throw new ZahlungsdienstleisterError(
      `Dieses ${adapter.name}-Konto ist schon mit dem Konto ${gebunden.name} verbunden; der Abruf schreibt weiter dorthin.`,
      {
        felder: ["bankAccountId"],
      },
    );
  }
  if (gewaehlt && !gebunden) await ohneFremdeQuelle(adapter, gewaehlt, accountId);
  const anderesKonto = existing !== null && existing.row.accountId !== accountId;
  const bankAccountId =
    gewaehlt ?? gebunden?.id ?? (anderesKonto ? null : existing?.row.bankAccountId) ?? (await freiesKonto(db, adapter.provider, id, accountId))?.id ?? null;
  // Ein Konto, eine Quelle (#306): hat das Konto des Abrufs schon eine externe Quelle, keine Verbindung
  if (bankAccountId) await keineExterneQuelle(db, [bankAccountId]);
  const startGeaendert = existing?.row.abrufStart !== data.fetchFrom;
  const values = {
    provider: adapter.provider,
    name: data.name,
    bankAccountId,
    accountId,
    keyHint: pruefung?.keyHint ?? existing!.row.keyHint,
    config: config as Record<string, string | number | boolean | null>,
    ciphertext: encrypt(new TextEncoder().encode(JSON.stringify(zugang))),
    ...(pruefung ? { zugangGueltigBis: pruefung.gueltigBis ?? null } : {}),
    abrufStart: data.fetchFrom,
    rhythmus: data.rhythmus,
    // Ein anderer Start oder ein anderes Konto beginnt wieder am gewählten Tag
    fetchFrom: anderesKonto || startGeaendert || !existing ? data.fetchFrom : existing.row.fetchFrom,
    ...(anderesKonto || neuerZugang ? { lastError: null } : {}),
    updatedAt: new Date(),
  };
  return withActor(actor, async (tx) => {
    // Ohne freies Konto legt die Verbindung ihr eigenes an, mit ihrem Namen; erst wenn alle neun Verrechnungskonten belegt sind, Fehler
    if (!values.bankAccountId) values.bankAccountId = (await providerKontoAnlegen(tx, { name: data.name, provider: adapter.provider as PaymentProvider })).id;
    if (id) {
      await tx.update(schema.pspConnections).set(values).where(eq(schema.pspConnections.id, id));
      return id;
    }
    const [neu] = await tx.insert(schema.pspConnections).values(values).returning({ id: schema.pspConnections.id });
    return neu!.id;
  });
}

/**
 * Prüft einen neuen Zugang beim Anbieter, ohne etwas zu speichern (Schritt „Zugang“ der Einrichtung, #1951): erkannte
 * Kontokennung, ob dieses Konto beim Anbieter schon als Verbindung besteht, und das Konto in Haben, das „Automatisch“
 * nähme. Hält die Quellenbindung (#306) das Konto beim Anbieter schon an einem Konto in Haben, ist es dieses (gebunden).
 */
export async function zugangPruefen(provider: string, eingabe: Record<string, string>, rohConfig: unknown) {
  const adapter = adapterOderFehler(provider);
  const config = configLesen(adapter, rohConfig);
  const zugang = adapter.zugangAusEingabe(eingabe, config, null);
  const pruefung = await adapter.pruefen(zugang, config);
  const verbunden = await verbindungZumKonto(adapter, pruefung.accountId, null);
  // Schon verbunden: Speichern lehnte ab, ein Konto in Haben gibt es dann nicht zu wählen
  const gebunden = verbunden ? null : await gebundenesKonto(adapter, pruefung.accountId, null);
  const frei = verbunden || gebunden ? null : await freiesKonto(db, adapter.provider, null, pruefung.accountId);
  return {
    accountId: pruefung.accountId,
    keyHint: pruefung.keyHint,
    gueltigBis: pruefung.gueltigBis ?? null,
    hinweise: pruefung.hinweise ?? [],
    schonVerbunden: verbunden && { ...verbunden, text: schonVerbundenText(adapter, verbunden.name) },
    /** Konto in Haben, das „Automatisch“ nimmt; null: Speichern legt eines mit dem Namen der Verbindung an */
    konto: gebunden ?? frei,
    gebunden: gebunden !== null,
  };
}

/** Entfernt die Verbindung ganz; übernommene Umsätze bleiben im Konto stehen */
export async function entferneVerbindung(actor: string, id: string): Promise<void> {
  await withActor(actor, (tx) => tx.delete(schema.pspConnections).where(eq(schema.pspConnections.id, id)));
}

/** Setzt das Konto einer Verbindung ohne gewähltes Konto auf das älteste freie des Anbieters; null, wenn es keins gibt */
export async function kontoDerVerbindung(actor: string, row: Row) {
  if (row.bankAccountId) {
    const [konto] = await db
      .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.id, row.bankAccountId));
    return konto ?? null;
  }
  const konto = await freiesKonto(db, row.provider, row.id, row.accountId);
  if (konto) {
    await withActor(actor, (tx) =>
      tx
        .update(schema.pspConnections)
        .set({ bankAccountId: konto.id })
        .where(and(eq(schema.pspConnections.id, row.id), isNull(schema.pspConnections.bankAccountId))),
    );
  }
  return konto;
}

/** Was die Oberfläche von einem Anbieter braucht, ohne Funktionen */
const anbieterFuerOberflaeche = (a: PspAdapter) => ({
  provider: a.provider,
  name: a.name,
  beschreibung: a.beschreibung,
  link: a.link,
  zugangName: a.zugangName,
  felder: a.felder,
  schritte: a.schritte ?? STANDARD_SCHRITTE,
});

/** Hinweis des Adapters zur gespeicherten config; eine ungültige zeigt keinen */
function configHinweis(row: Row): string | null {
  const adapter = adapterFuer(row.provider);
  const parsed = adapter?.configSchema.safeParse(row.config);
  return adapter && parsed?.success ? (adapter.configHinweis?.(parsed.data) ?? null) : null;
}

/** Für Bankseite und Einrichtung: alle Verbindungen ohne Zugang, die Anbieter mit ihren Feldern und die Konten zur Auswahl */
export async function verbindungenUebersicht() {
  const [rows, konten, konflikte] = await Promise.all([
    alleVerbindungen(),
    db
      .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name, provider: schema.bankAccounts.provider })
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.purpose, "zahlungsdienstleister"))
      .orderBy(asc(schema.bankAccounts.createdAt)),
    openConflicts(),
  ]);
  const kontoName = new Map(konten.map((k) => [k.id, k.name]));
  return {
    /** Vorschlag für „Abruf ab“ einer neuen Verbindung */
    heute: today(),
    anbieter: ANBIETER.map(anbieterFuerOberflaeche),
    konten: konten.filter((k) => ANBIETER.some((a) => a.provider === k.provider)),
    verbindungen: rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      name: row.name,
      bankAccountId: row.bankAccountId,
      kontoName: row.bankAccountId ? (kontoName.get(row.bankAccountId) ?? null) : null,
      accountId: row.accountId,
      keyHint: row.keyHint,
      config: row.config,
      hinweis: configHinweis(row),
      // Die Wahl aus den Einstellungen, nicht der vorrückende Stand des Abrufs (der steht in naechsterAbrufAb)
      fetchFrom: row.abrufStart,
      naechsterAbrufAb: row.fetchFrom,
      rhythmus: row.rhythmus as Rhythmus,
      lastSyncAt: row.lastSyncAt,
      lastError: row.lastError,
      zugangGueltigBis: row.zugangGueltigBis,
      updatedAt: row.updatedAt,
      /** Offene Konflikte des Abrufs (#306): Bis sie geklärt sind, übernimmt Haben aus diesem Abruf nichts */
      konflikte: konflikte.filter((k) => k.provider === row.provider && row.bankAccountId !== null && k.bankAccountId === row.bankAccountId),
    })),
  };
}
