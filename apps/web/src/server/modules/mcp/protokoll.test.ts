import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type McpServer, mcpAntwort } from "./protokoll.ts";

/* Das Protokoll ohne Anmeldung und Datenbank; Statuscodes und Texte wie im TypeScript-SDK, Abweichungen in protokoll.ts */

const aufrufe: Record<string, unknown>[] = [];
const server: McpServer = {
  info: { name: "haben", title: "Haben", version: "1.0.0" },
  instructions: "Nur lesen.",
  werkzeuge: [
    {
      name: "echo",
      title: "Echo",
      description: "Gibt den Text zurück",
      input: { text: z.string(), mal: z.number().int().min(1).default(1) },
      annotations: { readOnlyHint: true },
      run: async (args) => {
        aufrufe.push(args);
        return args.text === "kaputt" ? { text: "Geht nicht", isError: true } : { text: String(args.text).repeat(Number(args.mal)) };
      },
    },
  ],
};

/** Antwort im Test; ein Batch kommt als Array, die Tests prüfen ihn mit toEqual */
type RpcAntwort = {
  result?: { tools?: unknown[]; content?: { text: string }[]; protocolVersion?: string; isError?: boolean };
  error?: { code: number; message: string };
};
const ACCEPT = "application/json, text/event-stream";
async function senden(body: unknown, headers: Record<string, string> = {}) {
  const antwort = await mcpAntwort(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    server,
  );
  const text = await antwort.text();
  return { status: antwort.status, json: text ? (JSON.parse(text) as RpcAntwort) : null };
}
const anfrage = (method: string, params?: unknown, id: unknown = 1) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
const init = (protocolVersion: string) => anfrage("initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "t", version: "1" } });

describe("MCP-Protokoll", () => {
  it("handelt die Version aus: bekannte bleibt, unbekannte wird die neueste", async () => {
    const bekannt = await senden(init("2025-06-18"));
    expect(bekannt.json).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: server.info, instructions: "Nur lesen." },
    });
    expect((await senden(init("1999-01-01"))).json?.result?.protocolVersion).toBe("2025-11-25");
  });

  it("listet Werkzeuge mit JSON Schema der Eingabe wie das SDK", async () => {
    const { json } = await senden(anfrage("tools/list"));
    expect(json?.result?.tools).toEqual([
      {
        name: "echo",
        title: "Echo",
        description: "Gibt den Text zurück",
        annotations: { readOnlyHint: true },
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: { text: { type: "string" }, mal: { default: 1, type: "integer", minimum: 1, maximum: 9007199254740991 } },
          required: ["text"],
        },
      },
    ]);
  });

  it("ruft ein Werkzeug mit geprüften Argumenten samt Standardwerten auf", async () => {
    aufrufe.length = 0;
    const { json } = await senden(anfrage("tools/call", { name: "echo", arguments: { text: "ab", mal: 2, fremd: true } }));
    expect(json?.result).toEqual({ content: [{ type: "text", text: "abab" }] });
    expect((await senden(anfrage("tools/call", { name: "echo", arguments: { text: "x" } }))).json?.result?.content?.[0]?.text).toBe("x");
    expect(aufrufe).toEqual([
      { text: "ab", mal: 2 },
      { text: "x", mal: 1 },
    ]);
  });

  it("meldet Fehler des Werkzeugs und falsche Argumente als Ergebnis mit isError", async () => {
    const ergebnis = async (params: unknown) => (await senden(anfrage("tools/call", params))).json?.result;
    expect(await ergebnis({ name: "echo", arguments: { text: "kaputt" } })).toEqual({ content: [{ type: "text", text: "Geht nicht" }], isError: true });
    expect((await ergebnis({ name: "echo", arguments: { text: 1 } }))?.content?.[0]?.text).toBe(
      "Input validation error: Invalid arguments for tool echo: Invalid input: expected string, received number at text",
    );
  });

  it("antwortet auf Fehler im Protokoll mit JSON-RPC-Fehlern", async () => {
    expect((await senden(anfrage("resources/list"))).json?.error).toEqual({ code: -32601, message: "Method not found" });
    expect((await senden(anfrage("tools/call"))).json?.error?.code).toBe(-32602);
    // Server › Tools, Error Handling: ein unbekanntes Werkzeug ist ein Fehler im Protokoll, kein Ergebnis mit isError
    expect((await senden(anfrage("tools/call", { name: "gibtsnicht" }))).json).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "Unknown tool: gibtsnicht" },
    });
    expect((await senden(anfrage("initialize"))).json?.error?.code).toBe(-32602);
    expect(await senden(anfrage("ping", undefined, "a"))).toEqual({ status: 200, json: { jsonrpc: "2.0", id: "a", result: {} } });
  });

  it("meldet ein Werkzeug, das wirft, als Internal error ohne den Text der Ausnahme", async () => {
    const wirft: McpServer = {
      ...server,
      werkzeuge: [{ ...server.werkzeuge[0]!, run: () => Promise.reject(new Error("geheim")) }],
    };
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});
    const antwort = await mcpAntwort(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: ACCEPT },
        body: JSON.stringify(anfrage("tools/call", { name: "echo", arguments: { text: "x" } })),
      }),
      wirft,
    );
    expect(await antwort.json()).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "Internal error" } });
    expect(fehler).toHaveBeenCalledOnce();
    fehler.mockRestore();
  });

  it("beantwortet einen Batch als Array in der Reihenfolge der Anfragen, ohne Benachrichtigungen", async () => {
    const { status, json } = await senden([
      anfrage("ping", undefined, 2),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      anfrage("ping", undefined, 1),
    ]);
    expect(status).toBe(200);
    expect(json).toEqual([
      { jsonrpc: "2.0", id: 2, result: {} },
      { jsonrpc: "2.0", id: 1, result: {} },
    ]);
    expect((await senden([anfrage("ping")])).json).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
  });

  it("nimmt Benachrichtigungen und Antworten des Clients mit 202 ohne Inhalt an", async () => {
    expect(await senden({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({ status: 202, json: null });
    expect(await senden({ jsonrpc: "2.0", id: 9, result: {} })).toEqual({ status: 202, json: null });
  });

  it.each([
    ["kein JSON", "{kaputt", {}, 400, -32700],
    ["ohne jsonrpc", { id: 1, method: "ping" }, {}, 400, -32600],
    ["jsonrpc 1.0", { jsonrpc: "1.0", id: 1, method: "ping" }, {}, 400, -32600],
    ["id null", { jsonrpc: "2.0", id: null, method: "ping" }, {}, 400, -32600],
    // JSON-RPC 2.0, Abschnitt 6: ein leeres Array ist eine ungültige Anfrage
    ["leerer Batch", [], {}, 400, -32600],
    ["mehr als 100 im Batch", Array.from({ length: 101 }, (_, i) => anfrage("ping", undefined, i)), {}, 400, -32600],
    ["initialize mit weiteren Nachrichten", [init("2025-06-18"), anfrage("ping", undefined, 2)], {}, 400, -32600],
    ["unbekannte Version im Header", anfrage("ping"), { "mcp-protocol-version": "2030-01-01" }, 400, -32000],
    ["Accept ohne text/event-stream", anfrage("ping"), { Accept: "application/json" }, 406, -32000],
    ["Content-Type nicht JSON", anfrage("ping"), { "Content-Type": "text/plain" }, 415, -32000],
    ["über 4 MB", anfrage("ping", { x: "x".repeat(4_200_000) }), {}, 413, -32000],
  ])("lehnt ab: %s", async (_name, body, headers, status, code) => {
    const antwort = await senden(body, headers as Record<string, string>);
    expect(antwort.status).toBe(status);
    expect(antwort.json).toMatchObject({ jsonrpc: "2.0", id: null, error: { code } });
  });

  it("nimmt Content-Type mit charset und eine bekannte Version im Header", async () => {
    const { status } = await senden(anfrage("ping"), { "Content-Type": "application/json; charset=utf-8", "mcp-protocol-version": "2025-06-18" });
    expect(status).toBe(200);
  });
});
