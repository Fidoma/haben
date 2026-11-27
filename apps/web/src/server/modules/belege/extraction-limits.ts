import { ExtractionError } from "./extraction-schema.ts";

/*
 * Grenzen des KI-Dienstes (#1735): höchstens so viele Tokens je Anfrage, Anfragen und Tokens pro Minute, wie unter
 * Einstellungen › KI-Assistenten und API eingetragen. Jede Grenze ist optional; die nächste Anfrage geht erst raus, wenn
 * sie alle gesetzten einhält. Gezählt wird über die letzten 60 Sekunden, wie Azure OpenAI und LiteLLM ihre Kontingente
 * je Minute rechnen.
 */

export interface ExtractionLimits {
  maxTokensPerRequest: number | null;
  requestsPerMinute: number | null;
  tokensPerMinute: number | null;
}

export const NO_LIMITS: ExtractionLimits = { maxTokensPerRequest: null, requestsPerMinute: null, tokensPerMinute: null };

/** Eine gesendete Anfrage: wann und mit wie vielen geschätzten Tokens */
export interface SentRequest {
  at: number;
  tokens: number;
}

export const WINDOW_MS = 60_000;

/**
 * Tokens je Bild: Claude rechnet Breite × Höhe / 750 und verkleinert auf rund 1,15 Megapixel, also höchstens etwa 1.600
 * (https://docs.claude.com/en/docs/build-with-claude/vision); OpenAI bei „high“ für eine A4-Seite aus pdf-pages.ts
 * 85 + 6 × 170 = 1.105 (https://platform.openai.com/docs/guides/images-vision). Die größere Zahl gilt.
 */
export const TOKENS_PER_IMAGE = 1_600;
/** Ein Token hat im Deutschen eher drei als vier Zeichen; die Schätzung soll eher zu hoch als zu niedrig liegen */
const CHARS_PER_TOKEN = 3;
/** Die Antwort: die Belegfelder als JSON, auch bei vielen Steuersätzen deutlich unter 1.000 Tokens */
export const ANSWER_TOKENS = 1_000;

/** Geschätzte Tokens einer Anfrage aus ihrem Text und der Zahl der Bilder, samt Antwort */
export function estimateTokens({ textChars, images }: { textChars: number; images: number }): number {
  return Math.ceil(textChars / CHARS_PER_TOKEN) + images * TOKENS_PER_IMAGE + ANSWER_TOKENS;
}

export type Slot = { kind: "jetzt" } | { kind: "warten"; ms: number } | { kind: "nie"; message: string };

const tausender = (n: number) => n.toLocaleString("de-DE");

/**
 * Wann eine Anfrage mit `tokens` gesendet werden darf: jetzt, nach einer Wartezeit oder nie, weil sie allein schon
 * größer ist als eine Grenze. `sent` sind die bisherigen Anfragen, älteste zuerst.
 */
export function nextSlot(sent: readonly SentRequest[], now: number, tokens: number, limits: ExtractionLimits): Slot {
  if (limits.maxTokensPerRequest !== null && tokens > limits.maxTokensPerRequest) {
    return {
      kind: "nie",
      message: `Die Anfrage für diesen Beleg hätte geschätzt ${tausender(tokens)} Tokens, mehr als die eingestellte Grenze von ${tausender(limits.maxTokensPerRequest)} Tokens je Anfrage. Haben hat sie nicht gesendet; bitte die Grenze erhöhen oder von Hand ausfüllen.`,
    };
  }
  if (limits.tokensPerMinute !== null && tokens > limits.tokensPerMinute) {
    return {
      kind: "nie",
      message: `Die Anfrage für diesen Beleg hätte geschätzt ${tausender(tokens)} Tokens, mehr als die eingestellten ${tausender(limits.tokensPerMinute)} Tokens pro Minute. Haben hat sie nicht gesendet; bitte die Grenze erhöhen oder von Hand ausfüllen.`,
    };
  }
  const recent = sent.filter((r) => r.at > now - WINDOW_MS);
  const waits = [0];
  if (limits.requestsPerMinute !== null && recent.length >= limits.requestsPerMinute) {
    // Erst wenn so viele Anfragen aus dem Fenster gefallen sind, dass diese hineinpasst
    waits.push(recent[recent.length - limits.requestsPerMinute]!.at + WINDOW_MS - now);
  }
  if (limits.tokensPerMinute !== null) {
    let used = recent.reduce((sum, r) => sum + r.tokens, 0);
    for (const r of recent) {
      if (used + tokens <= limits.tokensPerMinute) break;
      used -= r.tokens;
      waits.push(r.at + WINDOW_MS - now);
    }
  }
  const ms = Math.max(...waits);
  return ms <= 0 ? { kind: "jetzt" } : { kind: "warten", ms };
}

/** Wird vor jeder Anfrage an den KI-Dienst mit den geschätzten Tokens aufgerufen; wartet, bis sie gesendet werden darf */
export type RequestGate = (tokens: number) => Promise<void>;

/** Ohne Grenzen: sofort */
export const openGate: RequestGate = async () => {};

/** Grund, wenn die Warteschlange angehalten wurde, während eine Anfrage auf ihren Platz wartete; der Beleg wartet weiter */
export const PAUSED_REASON = "angehalten";

export const isPaused = (error: unknown) => error instanceof ExtractionError && error.reason === PAUSED_REASON;

export interface GateDeps {
  limits: ExtractionLimits;
  /** Gesendete Anfragen, älteste zuerst; das Tor hängt jede neue an */
  sent: SentRequest[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Wird während des Wartens jede Sekunde gefragt, damit „Anhalten“ sofort wirkt */
  paused: () => Promise<boolean>;
}

/** Höchstens so lange am Stück warten, dann wieder nach „Anhalten“ fragen */
const POLL_MS = 1_000;

export function limitGate(deps: GateDeps): RequestGate {
  return async (tokens) => {
    for (;;) {
      const slot = nextSlot(deps.sent, deps.now(), tokens, deps.limits);
      if (slot.kind === "nie") throw new ExtractionError(slot.message, "grenze");
      if (slot.kind === "jetzt") break;
      if (await deps.paused()) throw new ExtractionError("Die Auslesung ist angehalten.", PAUSED_REASON);
      await deps.sleep(Math.min(slot.ms, POLL_MS));
    }
    const now = deps.now();
    // Was aus dem Fenster gefallen ist, braucht niemand mehr
    while (deps.sent.length > 0 && deps.sent[0]!.at <= now - WINDOW_MS) deps.sent.shift();
    deps.sent.push({ at: now, tokens });
  };
}
