import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";

/**
 * Trägt eine IBAN in einen Kontakt ein, der noch keine hat (#410: ausdrücklich bestätigte IBAN aus einer E-Rechnung).
 * Eine vorhandene IBAN überschreibt Haben nie; false, wenn der Kontakt inzwischen eine hat. In der Transaktion des
 * Aufrufers, damit Bestätigung und Kontakt zusammen gelten. Die Version erhöht wie bei jeder Änderung der Trigger.
 */
export async function setContactIbanIfEmpty(tx: Tx, id: string, iban: string): Promise<boolean> {
  const updated = await tx
    .update(schema.contacts)
    .set({ iban })
    .where(and(eq(schema.contacts.id, id), sql`coalesce(${schema.contacts.iban}, '') = ''`))
    .returning({ id: schema.contacts.id });
  return updated.length > 0;
}
