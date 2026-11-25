import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type McpServer, mcpAntwort } from "./protokoll.ts";

/*
 * Der eigene MCP-Server (protokoll.ts) gegen den Client des offiziellen TypeScript-SDK, das nur noch hier gebraucht
 * wird. Ändert ein Update des SDK das Protokoll, schlägt dieser Test an. Andere Methoden als POST beantwortet der
 * Endpunkt mit 405 wie handleMcpRequest in server.ts; der Client versucht nach dem Start einen GET für Nachrichten
 * des Servers und nimmt 405 als „gibt es nicht“.
 */

const server: McpServer = {
  info: { name: "haben", title: "Haben", version: "1.0.0" },
  instructions: "Nur lesen.",
  werkzeuge: [
    {
      name: "summe",
      title: "Summe",
      description: "Addiert zwei Beträge",
      input: { a: z.number(), b: z.number().default(0) },
      annotations: { title: "Summe", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async ({ a, b }) => ({ text: JSON.stringify({ summe: Number(a) + Number(b) }) }),
    },
  ],
};

const endpunkt = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  return mcpAntwort(request, server);
};

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function verbinden() {
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), { fetch: endpunkt }));
  return client;
}

describe("MCP-Server mit dem Client des SDK", () => {
  it("verbindet sich und kennt Name, Anweisungen und Werkzeuge", async () => {
    const c = await verbinden();
    expect(c.getServerVersion()).toEqual(server.info);
    expect(c.getInstructions()).toBe("Nur lesen.");
    expect(c.getServerCapabilities()).toEqual({ tools: {} });
    const { tools } = await c.listTools();
    expect(tools).toEqual([
      expect.objectContaining({
        name: "summe",
        title: "Summe",
        annotations: expect.objectContaining({ readOnlyHint: true }),
        inputSchema: expect.objectContaining({ type: "object", required: ["a"] }),
      }),
    ]);
    await expect(c.ping()).resolves.toEqual({});
  });

  it("ruft Werkzeuge auf, bekommt Eingabefehler als Ergebnis mit isError und ein unbekanntes Werkzeug als Fehler", async () => {
    const c = await verbinden();
    expect(await c.callTool({ name: "summe", arguments: { a: 1.5, b: 2 } })).toEqual({ content: [{ type: "text", text: '{"summe":3.5}' }] });
    const falsch = await c.callTool({ name: "summe", arguments: { a: "eins" } });
    expect(falsch.isError).toBe(true);
    await expect(c.callTool({ name: "gibtsnicht", arguments: {} })).rejects.toThrow(/Unknown tool: gibtsnicht/);
  });

  it("meldet eine unbekannte Methode als Fehler des Protokolls", async () => {
    const c = await verbinden();
    await expect(c.listResources()).rejects.toThrow(/Method not found/);
  });
});
