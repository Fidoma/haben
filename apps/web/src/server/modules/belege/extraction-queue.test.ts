import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { completion, startTestService, type RecordedRequest, type TestService } from "./test-ki-dienst.ts";

/*
 * Warteschlange der KI-Auslesung (#1735) gegen einen OpenAI-kompatiblen Testdienst: Reihenfolge, Anhalten, Grenzen und
 * „ausgelastet“. Die Wartezeiten der Grenzen pro Minute prüft extraction-limits.test.ts mit einer gestellten Uhr.
 */

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3];
const jpeg = (marker: number) => ({ bytes: new Uint8Array([...JPEG, marker]), filename: `beleg-${marker}.jpg` });

const ANSWER = {
  lieferant: "Telekom Deutschland GmbH",
  lieferantUstId: "DE123475223",
  empfaenger: null,
  empfaengerUstId: null,
  rechnungsnummer: "MF-2026-09",
  belegdatum: "2026-09-29",
  faelligAm: null,
  waehrung: "EUR",
  istGutschrift: false,
  betraege: [{ steuersatz: "19", netto: "38.57", steuer: "7.33" }],
  brutto: "45.90",
  kategorie: "telefon",
  hinweis: null,
};

/** Das letzte Byte des Fotos in der Anfrage: welcher Beleg gerade ausgelesen wird */
function markerOf(request: RecordedRequest): number {
  const messages = request.body.messages as { content: string | { type: string; image_url?: { url: string } }[] }[];
  const parts = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  const url = parts.find((p) => p.type === "image_url")!.image_url!.url;
  const bytes = Buffer.from(url.split(",")[1]!, "base64");
  return bytes[bytes.length - 1]!;
}

describe.skipIf(!testDatabaseUrl)("Warteschlange der KI-Auslesung (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let queue: typeof import("./extraction-queue.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let service: TestService;
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    service = await startTestService(() => ({ body: completion(JSON.stringify(ANSWER)) }));
    Object.assign(process.env, { EXTRACTION_BASE_URL: service.baseUrl, EXTRACTION_MODEL: "qwen2.5vl:7b", EXTRACTION_TIMEOUT_SECONDS: "10" });
    documents = await import("./documents.ts");
    queue = await import("./extraction-queue.ts");
    stammdaten = await import("../stammdaten/index.ts");
  }, 30_000);

  afterAll(async () => {
    await service?.close();
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, company cascade`;
    // Ein Arbeiter: Die Reihenfolge der Anfragen ist dann die der Warteschlange; mehrere prüft ein eigener Test
    await sql`insert into company (id, name, kontenrahmen, extraction_max_parallel) values (1, 'Testfirma', 'SKR03', 1)`;
    service.requests.length = 0;
    service.reply(() => ({ body: completion(JSON.stringify(ANSWER)) }));
  });

  /** Angehalten hochladen: Die Belege bleiben auf „wartet“, bis fortgesetzt wird */
  async function uploadPaused(...markers: number[]): Promise<string[]> {
    await stammdaten.setExtractionPaused(actor, true);
    const ids: string[] = [];
    for (const marker of markers) ids.push((await documents.uploadDocument(actor, jpeg(marker))).id);
    return ids;
  }

  async function resume(): Promise<void> {
    await stammdaten.setExtractionPaused(actor, false);
    await documents.resumeExtractionQueue();
  }

  const statusOf = async (id: string) => (await documents.getDocument(id))!.document;

  it("hochgeladen wartet jeder Beleg, der neueste oben in der Liste; ausgelesen wird von oben nach unten", async () => {
    const ids = await uploadPaused(1, 2, 3);
    expect(service.requests).toHaveLength(0);
    const list = await documents.listDocuments();
    expect(list.map((d) => [d.id, d.extractionStatus])).toEqual([...ids].reverse().map((id) => [id, "wartet"]));
    expect(await queue.queueOverview()).toEqual({ waiting: 3, running: 0, failed: 0, paused: true });

    await resume();
    expect(service.requests.map(markerOf)).toEqual([3, 2, 1]);
    // Ausgelesen bleibt jede Zeile, wo sie war
    expect((await documents.listDocuments()).map((d) => d.id)).toEqual([...ids].reverse());
    for (const id of ids)
      expect(await statusOf(id)).toMatchObject({ extractionStatus: "fertig", extractionQueuePosition: null, supplierName: "Telekom Deutschland GmbH" });
    expect(await queue.queueOverview()).toEqual({ waiting: 0, running: 0, failed: 0, paused: false });
  });

  it("neu auslesen in der Reihenfolge des Klicks; wartende behalten ihren Platz, ein einzelner Beleg kommt zuerst", async () => {
    const [a, b, c, d] = await uploadPaused(1, 2, 3, 4);
    await resume();
    service.requests.length = 0;
    await stammdaten.setExtractionPaused(actor, true);

    // Wie in der Liste mit „Datum absteigend“: d vor b
    expect((await documents.queueExtraction(actor, [d!, b!])).queued).toBe(2);
    // a dazu, d wartet schon und bleibt vor b
    expect((await documents.queueExtraction(actor, [a!, d!])).queued).toBe(1);
    // „Mit KI neu auslesen“ an c: vor allen Wartenden; an b: b rückt ganz nach vorn, ohne doppelt dranzukommen
    await documents.queueExtraction(actor, [c!], { first: true });
    await documents.queueExtraction(actor, [b!], { first: true });

    await resume();
    expect(service.requests.map(markerOf)).toEqual([2, 3, 4, 1]);
  });

  it("gebuchte und unbekannte Belege und E-Rechnungs-XML reiht neu auslesen nicht ein; ein XML-Fehler zählt nicht als fehlgeschlagen", async () => {
    const [booked, xml] = await uploadPaused(1, 2);
    await resume();
    await sql`update documents set locked_at = now() where id = ${booked!}`;
    await sql`update documents set mime_type = 'application/xml', extraction_status = 'fehler' where id = ${xml!}`;
    expect((await documents.queueExtraction(actor, [booked!, xml!, "00000000-0000-4000-8000-000000000000"])).queued).toBe(0);
    expect((await statusOf(booked!)).extractionStatus).toBe("fertig");
    expect((await queue.queueOverview()).failed).toBe(0);
  });

  it("größer als die Grenze je Anfrage: nicht gesendet, der Grund steht am Beleg", async () => {
    await stammdaten.saveExtractionLimits(actor, { maxTokensPerRequest: 100, requestsPerMinute: null, tokensPerMinute: null, maxParallel: 1 });
    const { id } = await documents.uploadDocument(actor, jpeg(7));
    expect(service.requests).toHaveLength(0);
    const doc = await statusOf(id);
    expect(doc.extractionStatus).toBe("fehler");
    expect(doc.extractionError).toMatch(/100 Tokens je Anfrage.*nicht gesendet/);
    expect(doc.extractionQueuePosition).toBeNull();
    expect(await queue.loadExtractionLimits()).toEqual({ maxTokensPerRequest: 100, requestsPerMinute: null, tokensPerMinute: null, maxParallel: 1 });
  });

  it("„ausgelastet“ (HTTP 429): Fehler am Beleg, keine weitere Anfrage für ihn; die übrigen laufen weiter", async () => {
    const [next, busy] = await uploadPaused(1, 2);
    service.reply((request) =>
      markerOf(request) === 2 ? { status: 429, body: { error: { message: "Rate limit" } } } : { body: completion(JSON.stringify(ANSWER)) },
    );
    await resume();
    expect(service.requests.map(markerOf)).toEqual([2, 1]);
    expect(await statusOf(busy!)).toMatchObject({ extractionStatus: "fehler", extractionError: expect.stringMatching(/ausgelastet/) });
    expect(await statusOf(next!)).toMatchObject({ extractionStatus: "fertig" });
    expect(await queue.queueOverview()).toMatchObject({ waiting: 0, failed: 1 });
  });

  it("ein Neustart während der Auslesung reiht den Beleg an seinem Platz wieder ein", async () => {
    const [a, b] = await uploadPaused(1, 2);
    // Wie nach einem Absturz: b (oben) stand auf „läuft“, kein Prozess liest ihn mehr aus
    await sql`update documents set extraction_status = 'laeuft' where id = ${b!}`;
    await resume();
    expect(service.requests.map(markerOf)).toEqual([2, 1]);
    expect((await statusOf(a!)).extractionStatus).toBe("fertig");
  });

  it("liest höchstens so viele Belege gleichzeitig aus, wie eingestellt sind", async () => {
    const ids = await uploadPaused(1, 2, 3, 4, 5);
    await sql`update company set extraction_max_parallel = 2, extraction_paused = false`;
    let now = 0;
    let most = 0;
    // Statt des Dienstes: zählt, wie viele gleichzeitig dran sind, und schreibt den Beleg fertig
    await queue.kick(async (id) => {
      most = Math.max(most, ++now);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await sql`update documents set extraction_status = 'fertig', extraction_queue_position = null where id = ${id}`;
      now--;
    });
    expect(most).toBe(2);
    for (const id of ids) expect((await statusOf(id)).extractionStatus).toBe("fertig");
  });
});
