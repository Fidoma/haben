import { z } from "zod";

/*
 * Model Context Protocol über Streamable HTTP, nur was Haben braucht: zustandslos, nur POST, Antwort als JSON statt
 * Stream, nur Werkzeuge (Spezifikation 2025-11-25, Basic › Transports und Server › Tools, modelcontextprotocol.io).
 * Statuscodes und Fehlertexte wie im TypeScript-SDK (@modelcontextprotocol/sdk, WebStandardStreamableHTTPServerTransport
 * mit enableJsonResponse), gegen dessen Client mcp-sdk.test.ts prüft. Bewusst anders: Ein Batch bekommt immer ein
 * Array zurück, ein leerer Batch und ein ungültiges JSON-RPC-Objekt sind -32600 (JSON-RPC 2.0, Abschnitte 5.1 und 6),
 * fehlende oder falsche Parameter -32602 statt -32603, ein unbekanntes Werkzeug ein Fehler im Protokoll statt eines
 * Ergebnisses mit isError (Server › Tools, Error Handling).
 */

export const LATEST_PROTOCOL_VERSION = "2025-11-25";
export const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
const MAX_BATCH_SIZE = 100;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface McpWerkzeug {
  name: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  annotations: Record<string, unknown>;
  /** Ergebnis als Text; ein Fehler als isError mit Text, wie ihn der Nutzer sehen soll */
  run: (args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
}

export interface McpServer {
  info: { name: string; title: string; version: string };
  instructions: string;
  werkzeuge: McpWerkzeug[];
}

type Id = string | number;
type Anfrage = { jsonrpc: "2.0"; id: Id; method: string; params?: Record<string, unknown> };

const id = z.union([z.string(), z.number().int()]);
const params = z.record(z.string(), z.unknown()).optional();
/** Anfrage, Benachrichtigung oder Antwort des Clients (JSON-RPC 2.0, Abschnitte 4 und 5) */
const nachricht = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id, method: z.string(), params }),
  // Benachrichtigung: ohne id; strikt, sonst ginge eine Anfrage mit "id": null als Benachrichtigung durch
  z.strictObject({ jsonrpc: z.literal("2.0"), method: z.string(), params }),
  z.object({ jsonrpc: z.literal("2.0"), id, result: z.record(z.string(), z.unknown()) }),
  z.object({ jsonrpc: z.literal("2.0"), id: id.nullable(), error: z.object({ code: z.number().int(), message: z.string() }) }),
]);
const initializeParams = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
  clientInfo: z.object({ name: z.string(), version: z.string() }),
});
const callParams = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() });

/** Ausgang einer Methode: Ergebnis oder JSON-RPC-Fehler, als Wert statt geworfen */
type Ausgang = { result: unknown } | { error: { code: number; message: string } };
const fehler = (code: number, message: string): Ausgang => ({ error: { code, message } });

const isAnfrage = (n: z.infer<typeof nachricht>): n is Anfrage => "id" in n && "method" in n;

export function jsonFehler(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Eingabe eines Werkzeugs als JSON Schema, wie es das SDK aus zod 4 erzeugt */
export const inputSchema = (input: z.ZodRawShape) => z.toJSONSchema(z.object(input), { target: "draft-7", io: "input" });

const fehlerText = (error: z.ZodError) =>
  error.issues.map((issue) => (issue.path.length ? `${issue.message} at ${issue.path.map(String).join(".")}` : issue.message)).join("\n");

async function werkzeugAufrufen(server: McpServer, roh: Record<string, unknown> | undefined): Promise<Ausgang> {
  const parsed = callParams.safeParse(roh);
  if (!parsed.success) return fehler(INVALID_PARAMS, `Invalid params: ${fehlerText(parsed.error)}`);
  const { name, arguments: args } = parsed.data;
  const werkzeug = server.werkzeuge.find((w) => w.name === name);
  if (!werkzeug) return fehler(INVALID_PARAMS, `Unknown tool: ${name}`);
  const eingabe = z.object(werkzeug.input).safeParse(args ?? {});
  if (!eingabe.success) {
    const text = `Input validation error: Invalid arguments for tool ${name}: ${fehlerText(eingabe.error)}`;
    return { result: { content: [{ type: "text", text }], isError: true } };
  }
  const { text, isError } = await werkzeug.run(eingabe.data);
  return { result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) } };
}

function initialisieren(server: McpServer, roh: Record<string, unknown> | undefined): Ausgang {
  const parsed = initializeParams.safeParse(roh);
  if (!parsed.success) return fehler(INVALID_PARAMS, `Invalid params: ${fehlerText(parsed.error)}`);
  const version = parsed.data.protocolVersion;
  return {
    result: {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(version) ? version : LATEST_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: server.info,
      instructions: server.instructions,
    },
  };
}

async function ausfuehren(server: McpServer, anfrage: Anfrage): Promise<Ausgang> {
  switch (anfrage.method) {
    case "initialize":
      return initialisieren(server, anfrage.params);
    case "ping":
      return { result: {} };
    case "tools/list":
      return {
        result: {
          tools: server.werkzeuge.map((w) => ({
            name: w.name,
            title: w.title,
            description: w.description,
            inputSchema: inputSchema(w.input),
            annotations: w.annotations,
          })),
        },
      };
    case "tools/call":
      return werkzeugAufrufen(server, anfrage.params);
    default:
      return fehler(METHOD_NOT_FOUND, "Method not found");
  }
}

async function beantworten(server: McpServer, anfrage: Anfrage) {
  try {
    return { jsonrpc: "2.0", id: anfrage.id, ...(await ausfuehren(server, anfrage)) };
  } catch (error) {
    console.error(error);
    return { jsonrpc: "2.0", id: anfrage.id, ...fehler(INTERNAL_ERROR, "Internal error") };
  }
}

/** Liest den Body; null, wenn er größer als erlaubt ist */
async function body(request: Request): Promise<string | null> {
  const laenge = Number(request.headers.get("content-length"));
  if (laenge > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.byteLength > MAX_BODY_BYTES ? null : new TextDecoder().decode(bytes);
}

/** Header, Body und Form der Nachrichten; eine Antwort, wenn etwas nicht passt, sonst die Nachrichten */
async function nachrichtenLesen(request: Request): Promise<Response | { batch: boolean; nachrichten: z.infer<typeof nachricht>[] }> {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream"))
    return jsonFehler(406, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream");
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? ""))
    return jsonFehler(415, -32000, "Unsupported Media Type: Content-Type must be application/json");
  const text = await body(request);
  if (text === null) return jsonFehler(413, -32000, `Payload Too Large: Request body must not exceed ${MAX_BODY_BYTES} bytes`);
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return jsonFehler(400, PARSE_ERROR, "Parse error: Invalid JSON");
  }
  const liste: unknown[] = Array.isArray(roh) ? roh : [roh];
  if (liste.length === 0) return jsonFehler(400, INVALID_REQUEST, "Invalid Request: Batch must not be empty");
  if (liste.length > MAX_BATCH_SIZE) return jsonFehler(400, INVALID_REQUEST, `Invalid Request: Batch must not exceed ${MAX_BATCH_SIZE} messages`);
  const nachrichten = z.array(nachricht).safeParse(liste);
  if (!nachrichten.success) return jsonFehler(400, INVALID_REQUEST, "Invalid Request: Invalid JSON-RPC message");
  return { batch: Array.isArray(roh), nachrichten: nachrichten.data };
}

/** Beantwortet eine POST-Anfrage an den MCP-Endpunkt; Anmeldung und Rate prüft der Aufrufer vorher */
export async function mcpAntwort(request: Request, server: McpServer): Promise<Response> {
  const gelesen = await nachrichtenLesen(request);
  if (gelesen instanceof Response) return gelesen;
  const { batch, nachrichten } = gelesen;
  const anfragen = nachrichten.filter(isAnfrage);
  const init = anfragen.some((a) => a.method === "initialize");
  if (init && nachrichten.length > 1) return jsonFehler(400, INVALID_REQUEST, "Invalid Request: Only one initialization request is allowed");
  const version = request.headers.get("mcp-protocol-version");
  if (!init && version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version))
    return jsonFehler(400, -32000, `Bad Request: Unsupported protocol version: ${version} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`);
  // Nur Benachrichtigungen oder Antworten: nichts zu beantworten (Transports, „Sending Messages to the Server“)
  if (anfragen.length === 0) return new Response(null, { status: 202 });
  const antworten = [];
  for (const anfrage of anfragen) antworten.push(await beantworten(server, anfrage));
  return new Response(JSON.stringify(batch ? antworten : antworten[0]), { status: 200, headers: { "Content-Type": "application/json" } });
}
