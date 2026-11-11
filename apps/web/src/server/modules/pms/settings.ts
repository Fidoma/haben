import { eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

export class PmsSettingsError extends UserError {}

export const pmsSettingsInputSchema = z.object({
  defaultArticleId: z.uuid("Bitte einen gültigen Artikel auswählen.").nullable(),
});

export type PmsSettingsInput = z.input<typeof pmsSettingsInputSchema>;

export async function getPmsSettings(): Promise<z.output<typeof pmsSettingsInputSchema>> {
  const [settings] = await db.select({ defaultArticleId: schema.pmsSettings.defaultArticleId }).from(schema.pmsSettings).where(eq(schema.pmsSettings.id, 1));
  return settings ?? { defaultArticleId: null };
}

/** Speichert die installationsweit eindeutigen PMS-Einstellungen mit Audit-Akteur. */
export async function savePmsSettings(actor: string, input: PmsSettingsInput): Promise<z.output<typeof pmsSettingsInputSchema>> {
  const values = pmsSettingsInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    if (values.defaultArticleId) {
      const [article] = await tx
        .select({ archivedAt: schema.articles.archivedAt })
        .from(schema.articles)
        .where(eq(schema.articles.id, values.defaultArticleId));
      if (!article) throw new PmsSettingsError("Artikel nicht gefunden.");
      if (article.archivedAt) throw new PmsSettingsError("Der Artikel ist archiviert.");
    }

    const [settings] = await tx
      .insert(schema.pmsSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: schema.pmsSettings.id, set: { ...values, updatedAt: new Date() } })
      .returning({ defaultArticleId: schema.pmsSettings.defaultArticleId });
    return settings!;
  });
}
