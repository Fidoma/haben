import { compactIban, isValidBic, isValidIban } from "@haben/core";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/*
 * Weitere Zahlungskonten für Rechnungen und Angebote (#1887). Das Standardkonto bleibt in den Firmendaten; diese hier
 * wählt man je Entwurf oder als bevorzugtes Zahlungskonto am Kontakt.
 */

export class BankverbindungError extends UserError {}

export type Bankverbindung = typeof schema.bankverbindungen.$inferSelect;

export const bankverbindungSchema = z.object({
  bezeichnung: z.string().trim().min(1, "Bezeichnung fehlt").max(60),
  iban: z.string().transform(compactIban).refine(isValidIban, "IBAN ist ungültig (Prüfziffer oder Länge)"),
  bic: z
    .string()
    .trim()
    .transform((bic) => bic.toUpperCase())
    .refine((bic) => bic === "" || isValidBic(bic), "BIC hat 8 oder 11 Zeichen"),
  bank: z.string().trim().max(100),
  /** GiroCode erlaubt 70 Zeichen für den Namen (EPC069-12) */
  kontoinhaber: z.string().trim().max(70),
});

export type BankverbindungInput = z.infer<typeof bankverbindungSchema>;

/** Alle nach Bezeichnung */
export function listBankverbindungen(q: Db | Tx = db): Promise<Bankverbindung[]> {
  return q.select().from(schema.bankverbindungen).orderBy(asc(schema.bankverbindungen.bezeichnung));
}

export async function loadBankverbindung(q: Db | Tx, id: string | null | undefined): Promise<Bankverbindung | null> {
  if (!id) return null;
  const [row] = await q.select().from(schema.bankverbindungen).where(eq(schema.bankverbindungen.id, id));
  return row ?? null;
}

/** Dieselbe IBAN zweimal wäre in der Auswahl nicht zu unterscheiden; das Standardkonto ist schon wählbar */
async function assertNeueIban(tx: Tx, iban: string, id: string | null): Promise<void> {
  const [company] = await tx.select({ iban: schema.company.iban }).from(schema.company);
  if (company && compactIban(company.iban) === iban) {
    throw new BankverbindungError("Diese IBAN ist schon das Standardkonto in den Firmendaten.", { felder: ["iban"] });
  }
  const [vorhanden] = await tx.select().from(schema.bankverbindungen).where(eq(schema.bankverbindungen.iban, iban));
  if (vorhanden && vorhanden.id !== id) {
    throw new BankverbindungError(`Diese IBAN steht schon unter „${vorhanden.bezeichnung}“.`, { felder: ["iban"] });
  }
}

export async function createBankverbindung(actor: string, input: BankverbindungInput): Promise<Bankverbindung> {
  return withActor(actor, async (tx) => {
    await assertNeueIban(tx, input.iban, null);
    const [created] = await tx.insert(schema.bankverbindungen).values(input).returning();
    return created!;
  });
}

/** Festgeschriebene Belege behalten ihren Stand (seller); Entwürfe und Kontakte zeigen ab jetzt die neuen Angaben */
export async function updateBankverbindung(actor: string, id: string, input: BankverbindungInput): Promise<void> {
  await withActor(actor, async (tx) => {
    await assertNeueIban(tx, input.iban, id);
    const [updated] = await tx
      .update(schema.bankverbindungen)
      .set(input)
      .where(eq(schema.bankverbindungen.id, id))
      .returning({ id: schema.bankverbindungen.id });
    if (!updated) throw new BankverbindungError("Zahlungskonto nicht gefunden.");
  });
}

/**
 * Löschen geht immer: Festgeschriebene Belege tragen eine Kopie der Kontodaten im Verkäufer und keinen Verweis.
 * Entwürfe und Kontakte, die das Konto gewählt haben, nehmen danach den Standard (ON DELETE SET NULL).
 */
export async function deleteBankverbindung(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [deleted] = await tx.delete(schema.bankverbindungen).where(eq(schema.bankverbindungen.id, id)).returning({ id: schema.bankverbindungen.id });
    if (!deleted) throw new BankverbindungError("Zahlungskonto nicht gefunden.");
  });
}

/** Ein gewähltes Zahlungskonto muss es geben; null ist der Standard */
export async function bankverbindungProblem(q: Db | Tx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await loadBankverbindung(q, id)) ? null : "Das gewählte Zahlungskonto gibt es nicht mehr.";
}

/** bankverbindungProblem als Fehler am Feld, für das Kontaktformular */
export async function assertBankverbindungWaehlbar(tx: Tx, id: string | null | undefined): Promise<void> {
  const problem = await bankverbindungProblem(tx, id);
  if (problem) throw new BankverbindungError(problem, { felder: ["bankverbindungId"] });
}

/** Vorgabe am Kontakt für neue Rechnungen und Angebote; null = Standard */
export async function kontaktBankverbindung(q: Db | Tx, contactId: string | null | undefined): Promise<string | null> {
  if (!contactId) return null;
  const [row] = await q.select({ id: schema.contacts.bankverbindungId }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  return row?.id ?? null;
}

/**
 * Zahlungskonto zu einer IBAN, etwa aus dem Verkäufer eines festgeschriebenen Belegs: null für die IBAN des Standards,
 * die Id des weiteren Kontos mit dieser IBAN, undefined, wenn es keins (mehr) gibt.
 */
export async function bankverbindungNachIban(q: Db | Tx, iban: string | null | undefined): Promise<string | null | undefined> {
  if (!iban) return undefined;
  const gesucht = compactIban(iban);
  const [company] = await q.select({ iban: schema.company.iban }).from(schema.company);
  if (company && compactIban(company.iban) === gesucht) return null;
  const [row] = await q.select({ id: schema.bankverbindungen.id }).from(schema.bankverbindungen).where(eq(schema.bankverbindungen.iban, gesucht));
  return row?.id;
}

/** Für die Auswahl am Kontakt: die weiteren Bankverbindungen und die IBAN des Standards aus den Firmendaten */
export async function bankverbindungAuswahl(q: Db | Tx = db) {
  const [liste, [company]] = await Promise.all([listBankverbindungen(q), q.select({ iban: schema.company.iban }).from(schema.company)]);
  return { liste: liste.map(({ id, bezeichnung, iban }) => ({ id, bezeichnung, iban })), standardIban: company?.iban ?? "" };
}
