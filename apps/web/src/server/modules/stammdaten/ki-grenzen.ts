import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { loadCompany } from "./company.ts";

/*
 * Einstellungen der Warteschlange der KI-Auslesung (#1735) in den Firmendaten: angehalten oder nicht und die Grenzen des
 * Dienstes. Die Warteschlange selbst steht im Modul belege.
 */

const grenze = z.number().int().min(1).max(100_000_000).nullable();

export const extractionLimitsSchema = z.object({
  maxTokensPerRequest: grenze,
  requestsPerMinute: grenze,
  tokensPerMinute: grenze,
  /** Höchstens so viele Belege gleichzeitig */
  maxParallel: z.number().int().min(1).max(20),
});

export type ExtractionLimitsInput = z.infer<typeof extractionLimitsSchema>;

export async function saveExtractionLimits(actor: string, input: ExtractionLimitsInput): Promise<void> {
  const limits = extractionLimitsSchema.parse(input);
  await loadCompany();
  await withActor(actor, (tx) =>
    tx
      .update(schema.company)
      .set({
        extractionMaxTokensPerRequest: limits.maxTokensPerRequest,
        extractionRequestsPerMinute: limits.requestsPerMinute,
        extractionTokensPerMinute: limits.tokensPerMinute,
        extractionMaxParallel: limits.maxParallel,
        updatedAt: new Date(),
      })
      .where(eq(schema.company.id, 1)),
  );
}

export async function setExtractionPaused(actor: string, paused: boolean): Promise<void> {
  await loadCompany();
  await withActor(actor, (tx) => tx.update(schema.company).set({ extractionPaused: paused, updatedAt: new Date() }).where(eq(schema.company.id, 1)));
}
