import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { limitGate, NO_LIMITS, type ExtractionLimits, type RequestGate, type SentRequest } from "./extraction-limits.ts";

/*
 * Warteschlange der KI-Auslesung (#1735): Belege warten mit `extraction_status = 'wartet'` und einem Platz in
 * `extraction_queue_position` und werden in diesem Prozess von höchstens so vielen Arbeitern gleichzeitig ausgelesen,
 * wie die Firmendaten erlauben (Vorgabe 4), so schnell es die Grenzen des Dienstes zulassen. Die Reihenfolge steht in der Datenbank und übersteht einen Neustart; angehalten wird über die
 * Firmendaten. Einen automatischen zweiten Versuch gibt es nicht: Weitere Anfragen verlängerten eine Überlastung nur.
 */

/** Dateien, die die KI lesen kann; E-Rechnungs-XML liest Haben selbst, HEIC nimmt kein Dienst an */
export const EXTRACTABLE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/** Liest einen Beleg aus, der schon auf „läuft“ steht; `gate` hält jede Anfrage bis zu ihrem Platz in den Grenzen an */
export type ExtractQueued = (id: string, gate: RequestGate) => Promise<void>;

interface QueueState {
  /** Laufende Arbeiter; jeder liest einen Beleg nach dem anderen aus */
  workers: Set<Promise<void>>;
  /** Arbeiter, die noch nicht beschlossen haben aufzuhören */
  active: number;
  /** Seit dem letzten Blick in die Warteschlange kam etwas dazu: Ein Arbeiter, der nichts fand, sieht noch einmal nach */
  dirty: boolean;
  /** Gesendete Anfragen der letzten Minute, für die Grenzen pro Minute; alle Arbeiter teilen sie */
  sent: SentRequest[];
  /** Auslesungen, die in diesem Prozess laufen; was sonst auf „läuft“ steht, hat ein Neustart abgebrochen */
  running: Set<string>;
}

/** Auf globalThis wie der Scheduler: Ein Neuladen im Entwicklungsserver startet keine zweiten Arbeiter */
function state(): QueueState {
  const g = globalThis as { __habenAuslesung?: QueueState };
  g.__habenAuslesung ??= { workers: new Set(), active: 0, dirty: false, sent: [], running: new Set() };
  return g.__habenAuslesung;
}

export const isRunning = (id: string) => state().running.has(id);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const DEFAULT_MAX_PARALLEL = 4;

interface QueueSettings {
  paused: boolean;
  maxParallel: number;
  limits: ExtractionLimits;
}

/** Angehalten, Arbeiter und Grenzen aus den Firmendaten; nur lesend, ohne die Zeile anzulegen wie loadCompany */
async function queueSettings(): Promise<QueueSettings> {
  const [row] = await db
    .select({
      paused: schema.company.extractionPaused,
      maxParallel: schema.company.extractionMaxParallel,
      maxTokensPerRequest: schema.company.extractionMaxTokensPerRequest,
      requestsPerMinute: schema.company.extractionRequestsPerMinute,
      tokensPerMinute: schema.company.extractionTokensPerMinute,
    })
    .from(schema.company)
    .where(eq(schema.company.id, 1));
  if (!row) return { paused: false, maxParallel: DEFAULT_MAX_PARALLEL, limits: NO_LIMITS };
  const { paused, maxParallel, ...limits } = row;
  return { paused, maxParallel, limits };
}

const isPausedNow = async () => (await queueSettings()).paused;

/** Für Einstellungen › KI-Assistenten und API */
export async function loadExtractionLimits(): Promise<ExtractionLimits & { maxParallel: number }> {
  const { limits, maxParallel } = await queueSettings();
  return { ...limits, maxParallel };
}

/**
 * Reiht Belege in dieser Reihenfolge ein, hinter allen Wartenden; mit `first` vor allen Wartenden (ein einzelner Beleg,
 * auf den jemand schaut). Gebuchte, laufende und Dateien, die die KI nicht lesen kann, bleiben draußen; ein schon
 * wartender Beleg behält seinen Platz, außer mit `first`. Gibt die Zahl der eingereihten Belege zurück.
 */
export async function enqueue(actor: string, ids: readonly string[], options: { first?: boolean } = {}): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  const skip: ("laeuft" | "wartet")[] = options.first ? ["laeuft"] : ["laeuft", "wartet"];
  return withActor(actor, async (tx) => {
    let count = 0;
    for (const id of unique) {
      // Je Beleg ein eigener Platz aus der Sequenz, in der Reihenfolge von `ids`
      const position = options.first ? sql`-nextval('documents_extraction_queue_seq')` : sql`nextval('documents_extraction_queue_seq')`;
      const updated = await tx
        .update(schema.documents)
        .set({ extractionStatus: "wartet", extractionError: null, extractionQueuePosition: position, updatedAt: new Date() })
        .where(
          and(
            eq(schema.documents.id, id),
            isNull(schema.documents.lockedAt),
            notInArray(schema.documents.extractionStatus, skip),
            inArray(schema.documents.mimeType, EXTRACTABLE_MIME_TYPES),
          ),
        )
        .returning({ id: schema.documents.id });
      count += updated.length;
    }
    return count;
  });
}

/** Der nächste wartende Beleg, den kein anderer Arbeiter gerade nimmt, oder null */
async function nextWaiting(taken: ReadonlySet<string>): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.extractionStatus, "wartet"),
        isNull(schema.documents.lockedAt),
        ...(taken.size > 0 ? [notInArray(schema.documents.id, [...taken])] : []),
      ),
    )
    .orderBy(asc(schema.documents.extractionQueuePosition), asc(schema.documents.uploadedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Setzt den Beleg auf „läuft“, falls er noch wartet; false, wenn ihn inzwischen jemand gebucht, gelöscht oder angefasst hat */
async function claim(id: string): Promise<boolean> {
  const rows = await withActor(SYSTEM_ACTOR, (tx) =>
    tx
      .update(schema.documents)
      .set({ extractionStatus: "laeuft", updatedAt: new Date() })
      .where(and(eq(schema.documents.id, id), eq(schema.documents.extractionStatus, "wartet"), isNull(schema.documents.lockedAt)))
      .returning({ id: schema.documents.id }),
  );
  return rows.length > 0;
}

/** Wer im Audit-Log die Auslesung im Hintergrund schreibt */
export const SYSTEM_ACTOR = "system:auslesung";

/**
 * Ein Arbeiter: liest Belege aus, bis keiner mehr wartet, die Warteschlange angehalten ist oder mehr Arbeiter laufen,
 * als erlaubt sind. Jeder schaut vor jedem Beleg neu in die Firmendaten, so wirken Anhalten und Grenzen sofort.
 */
async function worker(extract: ExtractQueued): Promise<void> {
  const s = state();
  try {
    await work(extract, s);
  } finally {
    s.active--;
  }
}

async function work(extract: ExtractQueued, s: QueueState): Promise<void> {
  for (;;) {
    const { paused, maxParallel, limits } = await queueSettings();
    // Zu viele: dieser hört auf; ohne await bis zum Abzählen in worker sehen die übrigen ihn schon nicht mehr
    if (paused || s.active > maxParallel) return;
    const id = await nextWaiting(s.running);
    if (!id) {
      if (!s.dirty) return;
      s.dirty = false;
      continue;
    }
    if (s.running.has(id)) continue;
    // Vor dem Umschalten auf „läuft“ eintragen, damit getDocument den Lauf nie für abgebrochen hält
    s.running.add(id);
    try {
      if (!(await claim(id))) continue;
      const gate = limitGate({ limits, sent: s.sent, now: Date.now, sleep, paused: isPausedNow });
      await extract(id, gate);
    } finally {
      s.running.delete(id);
    }
  }
}

function spawn(extract: ExtractQueued): void {
  const s = state();
  s.active++;
  const run: Promise<void> = worker(extract)
    .catch((error: unknown) => console.error("Warteschlange der Belegauslesung", error))
    .finally(() => s.workers.delete(run));
  s.workers.add(run);
}

/**
 * Stößt die Warteschlange an: startet so viele Arbeiter, wie erlaubt und noch nicht da sind, und gibt ein Versprechen
 * zurück, das sich erfüllt, wenn keiner mehr läuft. Fehler eines Belegs stehen am Beleg; was sonst schiefgeht, landet im
 * Log.
 */
export async function kick(extract: ExtractQueued): Promise<void> {
  const s = state();
  // Sofort, noch vor dem ersten await: Ein Arbeiter, der gerade nichts gefunden hat, schaut dann noch einmal nach
  s.dirty = true;
  const { paused, maxParallel } = await queueSettings();
  if (!paused) while (s.active < maxParallel) spawn(extract);
  while (s.workers.size > 0) await Promise.all([...s.workers]);
}

/** Übersicht für die Belegliste: wartende, laufende und fehlgeschlagene ungebuchte Belege, die die KI lesen kann */
export interface QueueOverview {
  waiting: number;
  running: number;
  failed: number;
  paused: boolean;
}

export async function queueOverview(): Promise<QueueOverview> {
  const [counts] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${schema.documents.extractionStatus} = 'wartet')::int`,
      running: sql<number>`count(*) filter (where ${schema.documents.extractionStatus} = 'laeuft')::int`,
      failed: sql<number>`count(*) filter (where ${schema.documents.extractionStatus} = 'fehler')::int`,
    })
    .from(schema.documents)
    // Eine E-Rechnung, deren XML nicht lesbar war, steht auch auf „fehler“, lässt sich aber nicht mit der KI neu auslesen
    .where(and(isNull(schema.documents.lockedAt), inArray(schema.documents.mimeType, EXTRACTABLE_MIME_TYPES)));
  return { waiting: counts?.waiting ?? 0, running: counts?.running ?? 0, failed: counts?.failed ?? 0, paused: await isPausedNow() };
}

/**
 * Nach einem Neustart: Was auf „läuft“ stand, hat der Neustart abgebrochen; es kommt an seinem alten Platz wieder dran.
 * Danach geht die Warteschlange weiter, wo sie war.
 */
export async function requeueInterrupted(): Promise<void> {
  await withActor(SYSTEM_ACTOR, (tx) =>
    tx
      .update(schema.documents)
      .set({ extractionStatus: "wartet", updatedAt: new Date() })
      .where(
        and(
          eq(schema.documents.extractionStatus, "laeuft"),
          isNull(schema.documents.lockedAt),
          sql`${schema.documents.extractionQueuePosition} is not null`,
          ...(state().running.size > 0 ? [notInArray(schema.documents.id, [...state().running])] : []),
        ),
      ),
  );
}
