import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { DocumentKind } from "../../storage.ts";
import type { ExtractionConfig } from "./extraction-config.ts";
import { estimateTokens, openGate, type RequestGate } from "./extraction-limits.ts";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_REQUEST, ExtractionError, extractionSchema, readableKind, type ProviderResult } from "./extraction-schema.ts";
import { pdfPageTexts } from "./pdf-seitentext.ts";

type AnthropicConfig = Extract<ExtractionConfig, { provider: "anthropic" }>;

let client: Anthropic | undefined;

function getClient(apiKey: string): Anthropic {
  // Der Schlüssel kommt aus der Umgebung und ändert sich zur Laufzeit nicht. Ohne Wiederholungen des SDK: Jede Anfrage
  // geht durch das Tor der Grenzen (#1735), und bei „ausgelastet“ fragt Haben nicht von selbst erneut
  client ??= new Anthropic({ apiKey, maxRetries: 0 });
  return client;
}

/** Liest einen Beleg (PDF oder Bild) mit Claude aus; PDFs nimmt die API direkt. */
export async function extractWithAnthropic(
  config: AnthropicConfig,
  bytes: Uint8Array,
  kind: DocumentKind,
  gate: RequestGate = openGate,
): Promise<ProviderResult> {
  const readable = readableKind(kind);
  const format = betaZodOutputFormat(extractionSchema);
  await gate(await requestTokens(bytes, readable === "pdf", JSON.stringify(format).length));
  const data = Buffer.from(bytes).toString("base64");
  const source: Anthropic.Beta.BetaContentBlockParam =
    readable === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: `image/${readable}`, data } };

  const response = await getClient(config.apiKey).beta.messages.parse({
    model: config.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    // Bei einer Ablehnung beantwortet ein passendes Ersatzmodell dieselbe Anfrage (bei Anthropic, kein anderer Anbieter).
    fallbacks: "default",
    output_config: { effort: "medium", format },
    system: EXTRACTION_INSTRUCTIONS,
    messages: [{ role: "user", content: [source, { type: "text", text: EXTRACTION_REQUEST }] }],
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("Die KI hat die Auslesung abgelehnt. Bitte die Felder von Hand ausfüllen.", "abgelehnt");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new ExtractionError("Die KI-Antwort war unvollständig. Bitte erneut versuchen oder von Hand ausfüllen.", "unvollstaendig");
  }
  return { extraction: response.parsed_output, warnings: [] };
}

/** Höchstens so viele Seiten nimmt die API je PDF (https://docs.claude.com/en/docs/build-with-claude/pdf-support) */
const MAX_PDF_PAGES = 100;

/**
 * Geschätzte Tokens: Die API liest jede Seite eines PDFs als Text und als Bild. Ohne pdftotext oder bei einem Scan gilt
 * eine Seite ohne Text.
 */
async function requestTokens(bytes: Uint8Array, pdf: boolean, schemaChars: number): Promise<number> {
  const fixedChars = EXTRACTION_INSTRUCTIONS.length + EXTRACTION_REQUEST.length + schemaChars;
  if (!pdf) return estimateTokens({ textChars: fixedChars, images: 1 });
  const texts = await pdfPageTexts(bytes, MAX_PDF_PAGES);
  const pages = Math.max(1, texts?.pages.length ?? 1);
  const textChars = texts?.pages.reduce((sum, page) => sum + page.length, 0) ?? 0;
  return estimateTokens({ textChars: fixedChars + textChars, images: pages });
}

/** Meldung für Fehler des Anthropic-SDK; null, wenn es keiner ist */
export function describeAnthropicError(error: unknown): string | null {
  if (error instanceof Anthropic.AuthenticationError) return "Der Anthropic-API-Schlüssel ist ungültig.";
  if (error instanceof Anthropic.RateLimitError) return "Die KI ist gerade ausgelastet. Bitte später erneut auslesen.";
  if (error instanceof Anthropic.BadRequestError) return `Die KI konnte den Beleg nicht verarbeiten: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Keine Verbindung zur KI. Bitte später erneut versuchen.";
  if (error instanceof Anthropic.APIError) return `Fehler der KI-Schnittstelle (${error.status ?? "?"}).`;
  return null;
}
