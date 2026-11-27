import { describe, expect, it } from "vitest";
import { ANSWER_TOKENS, estimateTokens, isPaused, limitGate, NO_LIMITS, nextSlot, TOKENS_PER_IMAGE, type SentRequest } from "./extraction-limits.ts";

const limits = (overrides: Partial<typeof NO_LIMITS>) => ({ ...NO_LIMITS, ...overrides });

describe("nextSlot: Grenzen des KI-Dienstes (#1735)", () => {
  it("ohne Grenzen sofort, auch nach vielen Anfragen", () => {
    const sent = Array.from({ length: 100 }, (_, i) => ({ at: i, tokens: 50_000 }));
    expect(nextSlot(sent, 100, 50_000, NO_LIMITS)).toEqual({ kind: "jetzt" });
  });

  it("größer als die Grenze je Anfrage: nie, mit Grund", () => {
    const slot = nextSlot([], 0, 8_001, limits({ maxTokensPerRequest: 8_000 }));
    expect(slot.kind).toBe("nie");
    expect(slot.kind === "nie" && slot.message).toMatch(/8\.001 Tokens.*8\.000 Tokens je Anfrage/);
    expect(nextSlot([], 0, 8_000, limits({ maxTokensPerRequest: 8_000 }))).toEqual({ kind: "jetzt" });
  });

  it("größer als die Tokens pro Minute: nie, statt ewig zu warten", () => {
    expect(nextSlot([], 0, 20_001, limits({ tokensPerMinute: 20_000 })).kind).toBe("nie");
  });

  it("Anfragen pro Minute: wartet, bis die älteste zählende aus dem Fenster fällt", () => {
    const sent: SentRequest[] = [
      { at: 1_000, tokens: 1 },
      { at: 5_000, tokens: 1 },
      { at: 9_000, tokens: 1 },
    ];
    expect(nextSlot(sent, 10_000, 1, limits({ requestsPerMinute: 4 }))).toEqual({ kind: "jetzt" });
    // Drei im Fenster, zwei erlaubt: erst wenn die zweite (5 s) fällt, sind es weniger als zwei
    expect(nextSlot(sent, 10_000, 1, limits({ requestsPerMinute: 2 }))).toEqual({ kind: "warten", ms: 55_000 });
    expect(nextSlot(sent, 65_000, 1, limits({ requestsPerMinute: 2 }))).toEqual({ kind: "jetzt" });
  });

  it("Tokens pro Minute: wartet, bis genug Tokens aus dem Fenster gefallen sind", () => {
    const sent: SentRequest[] = [
      { at: 0, tokens: 8_000 },
      { at: 10_000, tokens: 8_000 },
    ];
    // 16.000 im Fenster, 20.000 erlaubt: 5.000 passen erst, wenn die erste fällt
    expect(nextSlot(sent, 20_000, 5_000, limits({ tokensPerMinute: 20_000 }))).toEqual({ kind: "warten", ms: 40_000 });
    expect(nextSlot(sent, 20_000, 4_000, limits({ tokensPerMinute: 20_000 }))).toEqual({ kind: "jetzt" });
    // 13.000 passen erst, wenn beide gefallen sind
    expect(nextSlot(sent, 20_000, 13_000, limits({ tokensPerMinute: 20_000 }))).toEqual({ kind: "warten", ms: 50_000 });
  });

  it("es gilt die strengste Grenze", () => {
    const sent: SentRequest[] = [{ at: 0, tokens: 1_000 }];
    const beide = limits({ requestsPerMinute: 1, tokensPerMinute: 100_000 });
    expect(nextSlot(sent, 30_000, 1_000, beide)).toEqual({ kind: "warten", ms: 30_000 });
  });
});

describe("estimateTokens", () => {
  it("Text in Dritteln, je Bild eine feste Zahl, dazu die Antwort", () => {
    expect(estimateTokens({ textChars: 3_000, images: 2 })).toBe(1_000 + 2 * TOKENS_PER_IMAGE + ANSWER_TOKENS);
    expect(estimateTokens({ textChars: 1, images: 0 })).toBe(1 + ANSWER_TOKENS);
  });
});

describe("limitGate", () => {
  /** Uhr, die nur beim Warten vorrückt */
  function fakeClock() {
    let now = 0;
    const slept: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        slept.push(ms);
        now += ms;
      },
      slept,
    };
  }

  it("hält die zweite Anfrage an, bis sie in die Minute passt, und merkt sich beide", async () => {
    const clock = fakeClock();
    const sent: SentRequest[] = [];
    const gate = limitGate({ limits: limits({ requestsPerMinute: 1 }), sent, ...clock, paused: async () => false });
    await gate(500);
    await gate(700);
    expect(clock.now()).toBe(60_000);
    // In Schritten von höchstens einer Sekunde, damit „Anhalten“ dazwischen wirkt
    expect(Math.max(...clock.slept)).toBe(1_000);
    expect(sent).toEqual([{ at: 60_000, tokens: 700 }]);
  });

  it("angehalten während des Wartens: Fehler mit dem Grund „angehalten“, die Anfrage zählt nicht", async () => {
    const clock = fakeClock();
    const sent: SentRequest[] = [{ at: 0, tokens: 1 }];
    let paused = false;
    const gate = limitGate({
      limits: limits({ requestsPerMinute: 1 }),
      sent,
      now: clock.now,
      sleep: async (ms) => {
        await clock.sleep(ms);
        paused = clock.now() >= 3_000;
      },
      paused: async () => paused,
    });
    const error = await gate(1).catch((e: unknown) => e);
    expect(isPaused(error)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("zu groß: Fehler am Beleg, ohne zu warten", async () => {
    const clock = fakeClock();
    const gate = limitGate({ limits: limits({ maxTokensPerRequest: 100 }), sent: [], ...clock, paused: async () => false });
    await expect(gate(101)).rejects.toThrow(/nicht gesendet/);
    expect(clock.slept).toEqual([]);
  });
});
