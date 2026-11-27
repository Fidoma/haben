import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractWithAnthropic } from "./extraction-anthropic.ts";
import { limitGate, type SentRequest } from "./extraction-limits.ts";
import { startTestService, type TestService } from "./test-ki-dienst.ts";

/*
 * Anthropic gegen einen Testdienst (#1735): Jede Anfrage an den Dienst geht durch das Tor der Grenzen. Das SDK selbst
 * fragt nicht noch einmal nach, sonst zählten die Grenzen pro Minute die Wiederholungen nicht mit.
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);

describe("Anthropic: „ausgelastet“ (HTTP 429)", () => {
  let service: TestService;

  beforeAll(async () => {
    service = await startTestService(() => ({ status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "Rate limit" } } }));
    // Das SDK liest die Adresse beim Anlegen des Clients aus der Umgebung
    process.env.ANTHROPIC_BASE_URL = service.baseUrl.replace(/\/v1$/, "");
  });

  afterAll(async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    await service?.close();
  });

  it("schickt genau eine Anfrage, die das Tor gezählt hat, und fragt nicht von selbst erneut", async () => {
    const sent: SentRequest[] = [];
    const gate = limitGate({
      limits: { maxTokensPerRequest: null, requestsPerMinute: 1, tokensPerMinute: null },
      sent,
      now: Date.now,
      sleep: async () => {},
      paused: async () => false,
    });
    const error = await extractWithAnthropic({ provider: "anthropic", model: "claude-test", apiKey: "test" }, JPEG, "jpeg", gate).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(sent).toHaveLength(1);
    expect(service.requests).toHaveLength(1);
  }, 20_000);
});
